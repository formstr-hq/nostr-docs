import type { Element } from "@xmldom/xmldom";
import { PAGE_SIZES, type PageLayout, type PageSize } from "../docLayout";
import type { OoxmlDocument } from "./body";
import { DocxPackage } from "./package";
import {
  W_NS,
  descendants,
  elements,
  firstElement,
  isElement,
  outerXml,
  parseXml,
  serializeXml,
  setWAttr,
  wAttr,
} from "./xml";

const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface OoxmlPageMargins {
  topTwips?: number;
  rightTwips?: number;
  bottomTwips?: number;
  leftTwips?: number;
  headerTwips?: number;
  footerTwips?: number;
  gutterTwips?: number;
}

export interface OoxmlHeaderFooterRef {
  type: string;
  relationshipId: string;
}

export interface OoxmlSection {
  sectPrXml?: string;
  widthTwips?: number;
  heightTwips?: number;
  orientation?: "portrait" | "landscape";
  margins?: OoxmlPageMargins;
  headers: OoxmlHeaderFooterRef[];
  footers: OoxmlHeaderFooterRef[];
}

export interface OoxmlHeaderFooterPart {
  kind: "header" | "footer";
  partName: string;
  /** Plain-text projection used by the current PageLayout model. */
  text: string;
  /** Paragraph-level projection for left/right header slots. */
  paragraphs: string[];
  /** Raw part XML, preserved for writing back. */
  rawXml: string;
}

export interface OoxmlPageSetup {
  section: OoxmlSection | null;
  headers: OoxmlHeaderFooterPart[];
  footers: OoxmlHeaderFooterPart[];
}

interface Relationship {
  id: string;
  target: string;
  type: string;
}

function relationshipId(element: Element): string {
  return (
    element.getAttributeNS(R_NS, "id") ??
    element.getAttribute("r:id") ??
    ""
  );
}

function numberAttr(element: Element | null, name: string): number | undefined {
  if (!element) return undefined;
  const value = wAttr(element, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRelationships(xml: string): Relationship[] {
  if (!xml.trim()) return [];
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (!root) return [];
  return descendants(root, "Relationship", null).map((element) => ({
    id: element.getAttribute("Id") ?? "",
    target: element.getAttribute("Target") ?? "",
    type: element.getAttribute("Type") ?? "",
  }));
}

function parseSection(documentXml: string): OoxmlSection | null {
  const doc = parseXml(documentXml);
  const root = doc.documentElement;
  if (!root) return null;
  const body = firstElement(root, "body");
  if (!body) return null;
  const sectPr = elements(body, "sectPr").at(-1) ??
    descendants(body, "sectPr").at(-1) ??
    null;
  if (!sectPr) return null;

  const pgSz = firstElement(sectPr, "pgSz");
  const pgMar = firstElement(sectPr, "pgMar");
  const headers = elements(sectPr, "headerReference").map((element) => ({
    type: wAttr(element, "type") ?? "default",
    relationshipId: relationshipId(element),
  }));
  const footers = elements(sectPr, "footerReference").map((element) => ({
    type: wAttr(element, "type") ?? "default",
    relationshipId: relationshipId(element),
  }));

  return {
    sectPrXml: outerXml(sectPr),
    widthTwips: numberAttr(pgSz, "w"),
    heightTwips: numberAttr(pgSz, "h"),
    orientation:
      wAttr(pgSz ?? sectPr, "orient") === "landscape"
        ? "landscape"
        : "portrait",
    margins: pgMar
      ? {
          topTwips: numberAttr(pgMar, "top"),
          rightTwips: numberAttr(pgMar, "right"),
          bottomTwips: numberAttr(pgMar, "bottom"),
          leftTwips: numberAttr(pgMar, "left"),
          headerTwips: numberAttr(pgMar, "header"),
          footerTwips: numberAttr(pgMar, "footer"),
          gutterTwips: numberAttr(pgMar, "gutter"),
        }
      : undefined,
    headers,
    footers,
  };
}

function textOf(node: Element): string {
  if (node.localName === "t") return node.textContent ?? "";
  if (node.localName === "br" || node.localName === "cr") return "\n";
  if (node.localName === "tab") return "\t";
  let text = "";
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes.item(i);
    if (child && isElement(child)) text += textOf(child);
  }
  return text;
}

function parseHeaderFooterPart(
  kind: "header" | "footer",
  partName: string,
  xml: string,
): OoxmlHeaderFooterPart {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const paragraphs = root
    ? descendants(root, "p").map((paragraph) => textOf(paragraph).trim())
    : [];
  return {
    kind,
    partName,
    text: paragraphs.filter(Boolean).join(" · "),
    paragraphs: paragraphs.filter(Boolean),
    rawXml: xml,
  };
}

function resolveTarget(target: string): string {
  if (!target) return "";
  if (target.startsWith("/")) return target.slice(1);
  return `word/${target.replace(/^\.\//, "")}`;
}

/** Parse section properties and the resolved header/footer parts. */
export async function parsePageSetup(pkg: DocxPackage): Promise<OoxmlPageSetup> {
  const documentXml = await pkg.text("word/document.xml");
  const section = parseSection(documentXml);
  const relsXml = pkg.hasPart("word/_rels/document.xml.rels")
    ? await pkg.text("word/_rels/document.xml.rels")
    : "";
  const relationships = parseRelationships(relsXml);
  const byId = new Map(relationships.map((rel) => [rel.id, rel]));

  const headers: OoxmlHeaderFooterPart[] = [];
  const footers: OoxmlHeaderFooterPart[] = [];

  for (const ref of section?.headers ?? []) {
    const rel = byId.get(ref.relationshipId);
    if (!rel) continue;
    const partName = resolveTarget(rel.target);
    if (!pkg.hasPart(partName)) continue;
    headers.push(parseHeaderFooterPart("header", partName, await pkg.text(partName)));
  }
  for (const ref of section?.footers ?? []) {
    const rel = byId.get(ref.relationshipId);
    if (!rel) continue;
    const partName = resolveTarget(rel.target);
    if (!pkg.hasPart(partName)) continue;
    footers.push(parseHeaderFooterPart("footer", partName, await pkg.text(partName)));
  }

  return { section, headers, footers };
}

function twipsToInches(value: number | undefined, fallback: number): number {
  if (!value || value <= 0) return fallback;
  return Math.round((value / 1440) * 100) / 100;
}

function pageSizeFor(
  widthTwips: number | undefined,
  heightTwips: number | undefined,
): PageSize {
  if (!widthTwips || !heightTwips) return "A4";
  const short = Math.min(widthTwips, heightTwips);
  const long = Math.max(widthTwips, heightTwips);
  if (short === 12240 && long === 15840) return "Letter";
  if (short === 12240 && long === 20160) return "Legal";
  return "A4";
}

function slotsFromText(text: string, position: "header" | "footer") {
  const parts = text.split("\t").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { left: parts[0], center: parts[1], right: parts.slice(2).join(" ") };
  }
  if (parts.length === 2) {
    return { left: parts[0], right: parts[1] };
  }
  if (parts.length === 1) {
    return position === "header"
      ? { left: parts[0] }
      : { center: parts[0] };
  }
  return undefined;
}

function slotsFromPart(
  part: OoxmlHeaderFooterPart,
  position: "header" | "footer",
) {
  if (part.paragraphs.length >= 2) {
    if (position === "header") {
      return {
        left: part.paragraphs[0],
        right: part.paragraphs.slice(1).join(" · "),
      };
    }
    return { center: part.paragraphs.join(" · ") };
  }
  return slotsFromText(part.paragraphs[0] ?? part.text, position);
}

/**
 * Project the OOXML section/header/footer data into the app's PageLayout.
 *
 * The current PageLayout model only has text slots and page geometry; rich
 * header/footer blocks come later. The raw parts remain in the package, so this
 * projection is lossy only for the editor, not for the DOCX file.
 */
export function pageSetupToLayout(
  setup: OoxmlPageSetup,
  base: PageLayout,
): PageLayout {
  const section = setup.section;
  if (!section) return base;
  const width = section.widthTwips;
  const height = section.heightTwips;
  const header = setup.headers.find((part) => part.text);
  const footer = setup.footers.find((part) => part.text);

  return {
    ...base,
    canvas: "page",
    pageSize: pageSizeFor(width, height),
    orientation: section.orientation ?? "portrait",
    margins: {
      top: twipsToInches(section.margins?.topTwips, base.margins.top),
      right: twipsToInches(section.margins?.rightTwips, base.margins.right),
      bottom: twipsToInches(section.margins?.bottomTwips, base.margins.bottom),
      left: twipsToInches(section.margins?.leftTwips, base.margins.left),
    },
    header: header ? slotsFromPart(header, "header") : base.header,
    footer: footer ? slotsFromPart(footer, "footer") : base.footer,
  };
}

/**
 * Write page size, orientation and margins from PageLayout back into the final
 * `w:sectPr` before export. Header/footer text is preserved from the original
 * parts; editing those slots is a later adapter slice.
 */
export function applyLayoutToSection(
  parsed: OoxmlDocument,
  layout: PageLayout,
): void {
  if (!parsed.sectPrXml) return;
  const doc = parseXml(parsed.sectPrXml);
  const sectPr = doc.documentElement;
  if (!sectPr) return;

  let pgSz = firstElement(sectPr, "pgSz");
  if (!pgSz) {
    pgSz = doc.createElementNS(W_NS, "w:pgSz");
    sectPr.appendChild(pgSz);
  }
  const page = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.A4;
  const widthIn =
    layout.orientation === "landscape" ? page.heightIn : page.widthIn;
  const heightIn =
    layout.orientation === "landscape" ? page.widthIn : page.heightIn;
  setWAttr(pgSz, "w", String(Math.round(widthIn * 1440)));
  setWAttr(pgSz, "h", String(Math.round(heightIn * 1440)));
  setWAttr(pgSz, "orient", layout.orientation);

  let pgMar = firstElement(sectPr, "pgMar");
  if (!pgMar) {
    pgMar = doc.createElementNS(W_NS, "w:pgMar");
    sectPr.appendChild(pgMar);
  }
  setWAttr(pgMar, "top", String(Math.round(layout.margins.top * 1440)));
  setWAttr(pgMar, "right", String(Math.round(layout.margins.right * 1440)));
  setWAttr(pgMar, "bottom", String(Math.round(layout.margins.bottom * 1440)));
  setWAttr(pgMar, "left", String(Math.round(layout.margins.left * 1440)));

  parsed.sectPrXml = serializeXml(sectPr);
}
