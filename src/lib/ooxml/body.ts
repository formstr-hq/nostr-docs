import type { Document, Element } from "@xmldom/xmldom";
import {
  W_NS,
  XML_NS,
  firstElement,
  innerXml,
  isElement,
  outerXml,
  parseFragment,
  parseXml,
  serializeXml,
  wAttr,
} from "./xml";

export interface OoxmlRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  styleId?: string;
  /** Original run properties, preserved verbatim for dirty paragraphs. */
  rPrXml?: string;
}

export interface OoxmlParagraph {
  kind: "paragraph";
  /** Exact source XML. Re-emitted unchanged while the paragraph is not dirty. */
  originalXml: string;
  pPrXml?: string;
  runs: OoxmlRun[];
  /** Word paragraph style id (Title, Heading1, …). */
  styleId?: string;
  /** True when the paragraph carries Word list numbering. */
  numbered?: boolean;
  dirty: boolean;
}

export interface OoxmlTableCell {
  tcPrXml?: string;
  paragraphs: OoxmlParagraph[];
  /** Horizontal merge (w:gridSpan). Vertical merges stay raw for now. */
  colspan?: number;
}

export interface OoxmlTableRow {
  trPrXml?: string;
  cells: OoxmlTableCell[];
}

export interface OoxmlTable {
  kind: "table";
  /** Exact source XML. Re-emitted unchanged while the table is not dirty. */
  originalXml: string;
  tblPrXml?: string;
  tblGridXml?: string;
  rows: OoxmlTableRow[];
  dirty: boolean;
}

export interface OoxmlRawBlock {
  kind: "raw";
  xml: string;
}

export interface OoxmlImageBlock {
  kind: "image";
  /** Renderable data URL extracted from the package. */
  src: string;
  width?: number;
  height?: number;
  /** Original drawing XML, re-emitted on export. */
  xml: string;
}

export type OoxmlBlock =
  | OoxmlParagraph
  | OoxmlTable
  | OoxmlImageBlock
  | OoxmlRawBlock;

export interface OoxmlDocument {
  /** Source document DOM; root/body namespaces and attributes are preserved. */
  doc: Document;
  body: Element;
  blocks: OoxmlBlock[];
  /** Final body-level section properties, re-emitted after the blocks. */
  sectPrXml?: string;
}

const RUN_CHILDREN = new Set([
  "rPr",
  "t",
  "br",
  "tab",
  "cr",
]);

function boolProp(element: Element | null): boolean {
  if (!element) return false;
  const value = wAttr(element, "val");
  return value !== "0" && value !== "false" && value !== "off";
}

function parseRun(run: Element): OoxmlRun | null {
  const rPr = firstElement(run, "rPr");
  let text = "";
  for (let i = 0; i < run.childNodes.length; i += 1) {
    const child = run.childNodes.item(i);
    if (!child || !isElement(child)) continue;
    const localName = child.localName;
    if (!localName || !RUN_CHILDREN.has(localName)) return null;
    switch (localName) {
      case "t":
        text += child.textContent ?? "";
        break;
      case "br":
      case "cr":
        text += "\n";
        break;
      case "tab":
        text += "\t";
        break;
      default:
        break;
    }
  }

  const colorEl = rPr ? firstElement(rPr, "color") : null;
  const styleEl = rPr ? firstElement(rPr, "rStyle") : null;
  const color = colorEl ? wAttr(colorEl, "val") : null;

  return {
    text,
    bold: rPr ? boolProp(firstElement(rPr, "b")) : undefined,
    italic: rPr ? boolProp(firstElement(rPr, "i")) : undefined,
    underline: rPr
      ? (() => {
          const u = firstElement(rPr, "u");
          if (!u) return undefined;
          const value = wAttr(u, "val");
          return value !== "none";
        })()
      : undefined,
    color: color && /^[0-9a-f]{6}$/i.test(color) ? color : undefined,
    styleId: styleEl ? wAttr(styleEl, "val") ?? undefined : undefined,
    rPrXml: rPr ? innerXml(rPr) : undefined,
  };
}

function parseParagraph(paragraph: Element): OoxmlParagraph | null {
  const pPr = firstElement(paragraph, "pPr");
  const runs: OoxmlRun[] = [];

  for (let i = 0; i < paragraph.childNodes.length; i += 1) {
    const child = paragraph.childNodes.item(i);
    if (!child || !isElement(child)) continue;
    if (child.localName === "pPr") continue;
    if (child.localName !== "r") return null;
    const run = parseRun(child);
    if (!run) return null;
    if (run.text.length > 0 || run.rPrXml) runs.push(run);
  }

  return {
    kind: "paragraph",
    originalXml: outerXml(paragraph),
    pPrXml: pPr ? innerXml(pPr) : undefined,
    runs,
    styleId: pPr
      ? (() => {
          const style = firstElement(pPr, "pStyle");
          return style ? wAttr(style, "val") ?? undefined : undefined;
        })()
      : undefined,
    numbered: pPr ? !!firstElement(pPr, "numPr") : false,
    dirty: false,
  };
}

function parseTableCell(cell: Element): OoxmlTableCell | null {
  const tcPr = firstElement(cell, "tcPr");
  // Vertical merges need rowspan-aware stitching; keep them raw for now.
  if (tcPr && firstElement(tcPr, "vMerge")) return null;
  const gridSpan = tcPr ? firstElement(tcPr, "gridSpan") : null;
  const colspan = gridSpan ? Number(wAttr(gridSpan, "val")) : undefined;

  const paragraphs: OoxmlParagraph[] = [];
  for (let i = 0; i < cell.childNodes.length; i += 1) {
    const child = cell.childNodes.item(i);
    if (!child || !isElement(child)) continue;
    if (child.localName === "tcPr") continue;
    if (child.localName !== "p") return null;
    const paragraph = parseParagraph(child);
    if (!paragraph) return null;
    paragraphs.push(paragraph);
  }

  return {
    tcPrXml: tcPr ? innerXml(tcPr) : undefined,
    paragraphs,
    colspan: colspan && colspan > 1 ? colspan : undefined,
  };
}

function parseTableRow(row: Element): OoxmlTableRow | null {
  const trPr = firstElement(row, "trPr");
  const cells: OoxmlTableCell[] = [];
  for (let i = 0; i < row.childNodes.length; i += 1) {
    const child = row.childNodes.item(i);
    if (!child || !isElement(child)) continue;
    if (child.localName === "trPr") continue;
    if (child.localName !== "tc") return null;
    const cell = parseTableCell(child);
    if (!cell) return null;
    cells.push(cell);
  }
  return { trPrXml: trPr ? innerXml(trPr) : undefined, cells };
}

function parseTable(table: Element): OoxmlTable | null {
  const tblPr = firstElement(table, "tblPr");
  const tblGrid = firstElement(table, "tblGrid");
  const rows: OoxmlTableRow[] = [];

  for (let i = 0; i < table.childNodes.length; i += 1) {
    const child = table.childNodes.item(i);
    if (!child || !isElement(child)) continue;
    if (child.localName === "tblPr" || child.localName === "tblGrid") continue;
    if (child.localName !== "tr") return null;
    const row = parseTableRow(child);
    if (!row) return null;
    rows.push(row);
  }

  return {
    kind: "table",
    originalXml: outerXml(table),
    tblPrXml: tblPr ? innerXml(tblPr) : undefined,
    tblGridXml: tblGrid ? innerXml(tblGrid) : undefined,
    rows,
    dirty: false,
  };
}

/**
 * Parse `word/document.xml` into a body that is either an editable paragraph
 * (only pPr/r children) or an opaque raw block. This is what makes the adapter
 * lossless for constructs we have not modelled yet: tables, drawings,
 * hyperlinks, bookmarks, fields, content controls, etc. survive verbatim.
 */
export function parseDocumentXml(xml: string): OoxmlDocument {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (!root) throw new Error("DOCX document.xml has no root element");
  const body = firstElement(root, "body");
  if (!body) throw new Error("DOCX document.xml has no w:body");

  const blocks: OoxmlBlock[] = [];
  let sectPrXml: string | undefined;
  for (let i = 0; i < body.childNodes.length; i += 1) {
    const node = body.childNodes.item(i);
    if (!node || !isElement(node)) continue;
    if (node.localName === "sectPr") {
      sectPrXml = outerXml(node);
      continue;
    }
    if (node.localName === "p") {
      const paragraph = parseParagraph(node);
      if (paragraph) {
        blocks.push(paragraph);
        continue;
      }
    }
    if (node.localName === "tbl") {
      const table = parseTable(node);
      if (table) {
        blocks.push(table);
        continue;
      }
    }
    blocks.push({ kind: "raw", xml: outerXml(node) });
  }

  return { doc, body, blocks, sectPrXml };
}

function appendText(doc: Document, run: Element, text: string): void {
  const parts = text.split(/(\n|\t)/);
  for (const part of parts) {
    if (part === "") continue;
    if (part === "\n") {
      run.appendChild(doc.createElementNS(W_NS, "w:br"));
      continue;
    }
    if (part === "\t") {
      run.appendChild(doc.createElementNS(W_NS, "w:tab"));
      continue;
    }
    const t = doc.createElementNS(W_NS, "w:t");
    if (/^\s|\s$/.test(part) || /\s{2,}/.test(part)) {
      t.setAttributeNS(XML_NS, "xml:space", "preserve");
    }
    t.appendChild(doc.createTextNode(part));
    run.appendChild(t);
  }
}

function appendRaw(doc: Document, parent: Element, xml: string): void {
  for (const node of parseFragment(doc, xml)) {
    parent.appendChild(node);
  }
}

function appendRun(doc: Document, paragraph: Element, run: OoxmlRun): void {
  const r = doc.createElementNS(W_NS, "w:r");
  if (run.rPrXml) {
    const rPr = doc.createElementNS(W_NS, "w:rPr");
    appendRaw(doc, rPr, run.rPrXml);
    r.appendChild(rPr);
  }
  appendText(doc, r, run.text);
  paragraph.appendChild(r);
}

function appendParagraph(
  doc: Document,
  body: Element,
  paragraph: OoxmlParagraph,
): void {
  if (!paragraph.dirty) {
    appendRaw(doc, body, paragraph.originalXml);
    return;
  }

  const p = doc.createElementNS(W_NS, "w:p");
  if (paragraph.pPrXml) {
    const pPr = doc.createElementNS(W_NS, "w:pPr");
    appendRaw(doc, pPr, paragraph.pPrXml);
    p.appendChild(pPr);
  }
  for (const run of paragraph.runs) appendRun(doc, p, run);
  body.appendChild(p);
}

function appendTable(doc: Document, body: Element, table: OoxmlTable): void {
  if (!table.dirty) {
    appendRaw(doc, body, table.originalXml);
    return;
  }

  const tbl = doc.createElementNS(W_NS, "w:tbl");
  if (table.tblPrXml) {
    const tblPr = doc.createElementNS(W_NS, "w:tblPr");
    appendRaw(doc, tblPr, table.tblPrXml);
    tbl.appendChild(tblPr);
  }
  if (table.tblGridXml) {
    const tblGrid = doc.createElementNS(W_NS, "w:tblGrid");
    appendRaw(doc, tblGrid, table.tblGridXml);
    tbl.appendChild(tblGrid);
  }

  for (const row of table.rows) {
    const tr = doc.createElementNS(W_NS, "w:tr");
    if (row.trPrXml) {
      const trPr = doc.createElementNS(W_NS, "w:trPr");
      appendRaw(doc, trPr, row.trPrXml);
      tr.appendChild(trPr);
    }
    for (const cell of row.cells) {
      const tc = doc.createElementNS(W_NS, "w:tc");
      if (cell.tcPrXml) {
        const tcPr = doc.createElementNS(W_NS, "w:tcPr");
        appendRaw(doc, tcPr, cell.tcPrXml);
        tc.appendChild(tcPr);
      }
      for (const paragraph of cell.paragraphs) {
        appendParagraph(doc, tc, paragraph);
      }
      tr.appendChild(tc);
    }
    tbl.appendChild(tr);
  }

  body.appendChild(tbl);
}

/** Serialize the body back into the original document root. */
export function serializeDocumentXml(parsed: OoxmlDocument): string {
  const { doc, body, blocks, sectPrXml } = parsed;
  while (body.firstChild) body.removeChild(body.firstChild);

  for (const block of blocks) {
    if (block.kind === "raw") {
      appendRaw(doc, body, block.xml);
    } else if (block.kind === "image") {
      appendRaw(doc, body, block.xml);
    } else if (block.kind === "table") {
      appendTable(doc, body, block);
    } else {
      appendParagraph(doc, body, block);
    }
  }
  if (sectPrXml) appendRaw(doc, body, sectPrXml);

  return serializeXml(doc);
}

/** Replace the text of a paragraph, keeping its paragraph/run properties. */
export function setParagraphText(
  paragraph: OoxmlParagraph,
  text: string,
): void {
  if (paragraph.runs.length <= 1) {
    const first = paragraph.runs[0] ?? { text: "" };
    paragraph.runs = [{ ...first, text }];
  } else {
    paragraph.runs = [
      { ...paragraph.runs[0], text },
      ...paragraph.runs.slice(1).map((run) => ({ ...run, text: "" })),
    ];
  }
  paragraph.dirty = true;
}

export function paragraphText(paragraph: OoxmlParagraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}

export function setRunProperty(
  run: OoxmlRun,
  property: "bold" | "italic" | "underline",
  value: boolean,
): void {
  run[property] = value;
  // The serializer currently preserves the original rPr. A dedicated property
  // writer will be added as part of the rich-model mapping.
}
