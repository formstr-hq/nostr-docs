import type { JSONContent } from "@tiptap/core";
import type {
  OoxmlBlock,
  OoxmlDocument,
  OoxmlParagraph,
  OoxmlRun,
  OoxmlTable,
} from "./body";

const HEADING_STYLE = /^(heading\s*[1-9]|title|subtitle)$/i;

function colorFromNode(node: JSONContent): string | undefined {
  const color = node.marks?.find((mark) => mark.type === "textStyle")?.attrs
    ?.color;
  if (typeof color !== "string") return undefined;
  const match = color.match(/^#?([0-9a-f]{6})$/i);
  return match ? match[1].toUpperCase() : undefined;
}

function isBold(node: JSONContent): boolean {
  return !!node.marks?.some((mark) => mark.type === "bold");
}

function isItalic(node: JSONContent): boolean {
  return !!node.marks?.some((mark) => mark.type === "italic");
}

function runProperties(
  fallback: string | undefined,
  bold: boolean,
  italic: boolean,
  color: string | undefined,
): string | undefined {
  if (!bold && !italic && !color) return fallback;
  let rPr =
    fallback && fallback.startsWith("<w:rPr")
      ? fallback
      : "<w:rPr></w:rPr>";
  rPr = rPr
    .replace(/<w:b\b[^>]*\/>/g, "")
    .replace(/<w:i\b[^>]*\/>/g, "")
    .replace(/<w:color\b[^>]*\/>/g, "");
  const tags = [
    bold ? "<w:b/>" : "",
    italic ? "<w:i/>" : "",
    color ? `<w:color w:val="${color}"/>` : "",
  ].join("");
  return rPr.replace("</w:rPr>", `${tags}</w:rPr>`);
}

function inlineRuns(
  content: JSONContent[] | undefined,
  fallbackRPr: string | undefined,
): OoxmlRun[] {
  const runs: OoxmlRun[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "text") {
      runs.push({
        text: node.text ?? "",
        bold: isBold(node),
        italic: isItalic(node),
        color: colorFromNode(node),
        rPrXml: runProperties(
          fallbackRPr,
          isBold(node),
          isItalic(node),
          colorFromNode(node),
        ),
      });
      return;
    }
    if (node.type === "hardBreak") {
      runs.push({ text: "\n", rPrXml: fallbackRPr });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of content ?? []) visit(node);
  return runs;
}

function setParagraphStyle(
  paragraph: OoxmlParagraph,
  styleId: string | null,
): void {
  let xml = paragraph.pPrXml ?? "";
  const styleTag = /<w:pStyle\b[^>]*\/>/;
  if (styleId) {
    const tag = `<w:pStyle w:val="${styleId}"/>`;
    xml = styleTag.test(xml) ? xml.replace(styleTag, tag) : tag + xml;
  } else {
    xml = xml.replace(styleTag, "");
  }
  paragraph.pPrXml = xml || undefined;
}

function applyParagraph(paragraph: OoxmlParagraph, node: JSONContent): void {
  const fallbackRPr = paragraph.runs[0]?.rPrXml;
  paragraph.runs = inlineRuns(node.content, fallbackRPr);
  paragraph.dirty = true;
  if (node.type === "heading") {
    const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
    setParagraphStyle(paragraph, `Heading${level}`);
  } else if (HEADING_STYLE.test(paragraph.styleId ?? "")) {
    setParagraphStyle(paragraph, "Normal");
  }
}

function newParagraph(node: JSONContent): OoxmlParagraph {
  const level =
    node.type === "heading"
      ? Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      : null;
  const paragraph: OoxmlParagraph = {
    kind: "paragraph",
    originalXml: "",
    pPrXml: level ? `<w:pStyle w:val="Heading${level}"/>` : undefined,
    runs: inlineRuns(node.content, undefined),
    styleId: level ? `Heading${level}` : undefined,
    dirty: true,
  };
  return paragraph;
}

function applyTable(table: OoxmlTable, node: JSONContent): void {
  table.dirty = true;
  const rows = node.content ?? [];
  table.rows = rows.map((row, rowIndex) => {
    const originalRow = table.rows[rowIndex];
    const cells = (row.content ?? []).map((cell, cellIndex) => {
      const originalCell = originalRow?.cells[cellIndex];
      const paragraphs = (cell.content ?? [])
        .filter((block) => block.type === "paragraph" || block.type === "heading")
        .map((block, paragraphIndex) => {
          const original = originalCell?.paragraphs[paragraphIndex];
          if (original) {
            applyParagraph(original, block);
            return original;
          }
          return newParagraph(block);
        });
      const colspan = Number(cell.attrs?.colspan) || undefined;
      let tcPrXml = originalCell?.tcPrXml;
      if (colspan) {
        const span = `<w:gridSpan w:val="${colspan}"/>`;
        tcPrXml = /<w:gridSpan\b[^>]*\/>/.test(tcPrXml ?? "")
          ? (tcPrXml ?? "").replace(/<w:gridSpan\b[^>]*\/>/, span)
          : `${tcPrXml ?? ""}${span}`;
      } else if (tcPrXml) {
        tcPrXml = tcPrXml.replace(/<w:gridSpan\b[^>]*\/>/g, "");
      }
      return {
        tcPrXml,
        paragraphs:
          paragraphs.length > 0 ? paragraphs : [newParagraph({ type: "paragraph" })],
      };
    });
    return { trPrXml: originalRow?.trPrXml, cells };
  });
}

function newTable(node: JSONContent): OoxmlTable {
  const table: OoxmlTable = {
    kind: "table",
    originalXml: "",
    rows: [],
    dirty: true,
  };
  applyTable(table, node);
  return table;
}

function flattenListItems(node: JSONContent): JSONContent[] {
  return (node.content ?? []).flatMap((item) => item.content ?? []);
}

/**
 * Apply an edited rich document back onto the parsed OOXML body. Paragraphs and
 * tables are rebuilt; `ooxmlBlock` nodes re-emit their raw XML. Everything else
 * in the package (headers/footers, media, comments, footnotes, styles) is left
 * untouched.
 */
export function applyRichDocumentToOoxml(
  parsed: OoxmlDocument,
  rich: JSONContent,
): void {
  const paragraphQueue = parsed.blocks.filter(
    (block): block is OoxmlParagraph => block.kind === "paragraph",
  );
  const tableQueue = parsed.blocks.filter(
    (block): block is OoxmlTable => block.kind === "table",
  );
  const nextParagraph = () => paragraphQueue.shift();
  const nextTable = () => tableQueue.shift();
  const blocks: OoxmlBlock[] = [];

  const visit = (node: JSONContent) => {
    switch (node.type) {
      case "ooxmlBlock":
      case "ooxmlImage":
        blocks.push({ kind: "raw", xml: String(node.attrs?.xml ?? "") });
        return;
      case "heading":
      case "paragraph": {
        const paragraph = nextParagraph();
        if (paragraph) {
          applyParagraph(paragraph, node);
          blocks.push(paragraph);
        } else {
          blocks.push(newParagraph(node));
        }
        return;
      }
      case "bulletList":
      case "orderedList": {
        for (const item of flattenListItems(node)) {
          const paragraphNode =
            item.type === "paragraph" || item.type === "heading"
              ? item
              : { type: "paragraph", content: item.content };
          const paragraph = nextParagraph();
          if (paragraph) {
            applyParagraph(paragraph, paragraphNode);
            blocks.push(paragraph);
          } else {
            blocks.push(newParagraph(paragraphNode));
          }
        }
        return;
      }
      case "table": {
        const table = nextTable();
        if (table) {
          applyTable(table, node);
          blocks.push(table);
        } else {
          blocks.push(newTable(node));
        }
        return;
      }
      case "columns":
      case "column":
        for (const child of node.content ?? []) visit(child);
        return;
      case "blockquote":
        for (const child of node.content ?? []) visit(child);
        return;
      default:
        for (const child of node.content ?? []) visit(child);
    }
  };

  for (const node of rich.content ?? []) visit(node);
  parsed.blocks = blocks;
}
