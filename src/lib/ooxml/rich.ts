import type { JSONContent } from "@tiptap/core";
import type {
  OoxmlDocument,
  OoxmlParagraph,
  OoxmlRun,
  OoxmlTable,
} from "./body";

function headingLevel(styleId: string | undefined): number | null {
  if (!styleId) return null;
  const normalized = styleId.replace(/[\s_-]/g, "").toLowerCase();
  if (normalized === "title") return 1;
  if (normalized === "subtitle") return 2;
  const match = normalized.match(/^heading([1-4])$/);
  return match ? Number(match[1]) : null;
}

function marksForRun(run: OoxmlRun): JSONContent["marks"] | undefined {
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (run.bold) marks.push({ type: "bold" });
  if (run.italic) marks.push({ type: "italic" });
  if (run.color) {
    marks.push({ type: "textStyle", attrs: { color: `#${run.color}` } });
  }
  return marks.length > 0 ? marks : undefined;
}

function textFromRuns(runs: OoxmlRun[]): JSONContent[] {
  return runs
    .filter((run) => run.text.length > 0)
    .map((run) => ({
      type: "text" as const,
      text: run.text,
      ...(marksForRun(run) ? { marks: marksForRun(run) } : {}),
    }));
}

function paragraphNode(paragraph: OoxmlParagraph): JSONContent {
  const level = headingLevel(paragraph.styleId);
  const content = textFromRuns(paragraph.runs);
  return level
    ? { type: "heading", attrs: { level }, content }
    : { type: "paragraph", ...(content.length > 0 ? { content } : {}) };
}

function listNode(paragraphs: OoxmlParagraph[]): JSONContent {
  return {
    type: "bulletList",
    content: paragraphs.map((paragraph) => ({
      type: "listItem",
      content: [paragraphNode(paragraph)],
    })),
  };
}

function tableNode(table: OoxmlTable): JSONContent {
  return {
    type: "table",
    content: table.rows.map((row) => ({
      type: "tableRow",
      content: row.cells.map((cell) => {
        const content = cell.paragraphs.map(paragraphNode);
        return {
          type: "tableCell",
          ...(cell.colspan ? { attrs: { colspan: cell.colspan } } : {}),
          content: content.length > 0 ? content : [{ type: "paragraph" }],
        };
      }),
    })),
  };
}

function rawLabel(xml: string): string {
  if (
    /<w:drawing[\s>]|<w:pict[\s>]|<mc:AlternateContent[\s>]|v:shape[\s>]|wps:wsp[\s>]/.test(
      xml,
    )
  ) {
    return "image or drawing";
  }
  if (/<w:tbl[\s>]/.test(xml)) return "table";
  if (/<w:footnoteReference[\s>]/.test(xml)) return "footnote";
  if (/<w:commentReference[\s>]/.test(xml)) return "comment";
  if (/<w:ins[\s>]|<w:del[\s>]/.test(xml)) return "tracked change";
  if (/<w:sdt[\s>]/.test(xml)) return "content control";
  return "Word content";
}

/**
 * Map the OOXML body AST into the canonical rich model.
 *
 * Supported: paragraphs, headings, simple tables and numbered lists.
 * Unsupported blocks remain `ooxmlBlock` nodes carrying their raw XML, so they
 * are visible as placeholders and preserved for writing back.
 */
export function ooxmlToRichDocument(parsed: OoxmlDocument): JSONContent {
  const content: JSONContent[] = [];
  let index = 0;

  while (index < parsed.blocks.length) {
    const block = parsed.blocks[index];

    if (block.kind === "raw") {
      content.push({
        type: "ooxmlBlock",
        attrs: { xml: block.xml, label: rawLabel(block.xml) },
      });
      index += 1;
      continue;
    }

    if (block.kind === "image") {
      content.push({
        type: "ooxmlImage",
        attrs: {
          src: block.src,
          alt: "",
          width: block.width ?? null,
          height: block.height ?? null,
          xml: block.xml,
        },
      });
      index += 1;
      continue;
    }

    if (block.kind === "table") {
      content.push(tableNode(block));
      index += 1;
      continue;
    }

    if (block.numbered) {
      const list: OoxmlParagraph[] = [];
      while (index < parsed.blocks.length) {
        const next = parsed.blocks[index];
        if (next.kind !== "paragraph" || !next.numbered) break;
        list.push(next);
        index += 1;
      }
      content.push(listNode(list));
      continue;
    }

    content.push(paragraphNode(block));
    index += 1;
  }

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}
