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
  dirty: boolean;
}

export interface OoxmlRawBlock {
  kind: "raw";
  xml: string;
}

export type OoxmlBlock = OoxmlParagraph | OoxmlRawBlock;

export interface OoxmlDocument {
  /** Source document DOM; root/body namespaces and attributes are preserved. */
  doc: Document;
  body: Element;
  blocks: OoxmlBlock[];
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
  for (let i = 0; i < body.childNodes.length; i += 1) {
    const node = body.childNodes.item(i);
    if (!node || !isElement(node)) continue;
    if (node.localName === "p") {
      const paragraph = parseParagraph(node);
      if (paragraph) {
        blocks.push(paragraph);
        continue;
      }
    }
    blocks.push({ kind: "raw", xml: outerXml(node) });
  }

  return { doc, body, blocks };
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

/** Serialize the body back into the original document root. */
export function serializeDocumentXml(parsed: OoxmlDocument): string {
  const { doc, body, blocks } = parsed;
  while (body.firstChild) body.removeChild(body.firstChild);

  for (const block of blocks) {
    if (block.kind === "raw") {
      appendRaw(doc, body, block.xml);
    } else {
      appendParagraph(doc, body, block);
    }
  }

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
