/**
 * src/features/driveImport/converters/docxConverter.ts
 * Converts a .docx archive into editor HTML (headings, lists, tables, inline
 * formatting) by reading word/document.xml and word/numbering.xml via JSZip.
 */

import JSZip from "jszip";
import { DriveImportError } from "../types";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function corrupted(message: string): DriveImportError {
  return new DriveImportError(
    "CORRUPTED_DOCUMENT",
    message,
    "The Word document is corrupted, encrypted, or not a valid .docx file",
    "Corrupted Document",
    "file",
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter(
    (c) => c.namespaceURI === W_NS && c.localName === name,
  );
}

function child(el: Element | null | undefined, name: string): Element | null {
  return el ? children(el, name)[0] ?? null : null;
}

function attr(el: Element | null, name: string): string | null {
  // Qualified-name fallback for DOM implementations without namespaced attribute lookup.
  return el ? (el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`)) : null;
}

/** A toggle property like <w:b/> is on unless w:val is false/0/none. */
function isOn(rPr: Element | null, name: string): boolean {
  const el = child(rPr, name);
  if (!el) return false;
  const val = attr(el, "val");
  return val === null || !["false", "0", "none"].includes(val);
}

function renderRun(run: Element): string {
  const rPr = child(run, "rPr");
  let out = "";
  for (const node of Array.from(run.children)) {
    if (node.namespaceURI !== W_NS) continue;
    if (node.localName === "t") out += escapeHtml(node.textContent ?? "");
    else if (node.localName === "tab") out += "&emsp;";
    else if (node.localName === "br" || node.localName === "cr") out += "<br />";
  }
  if (!out) return "";
  if (isOn(rPr, "b")) out = `<strong>${out}</strong>`;
  if (isOn(rPr, "i")) out = `<em>${out}</em>`;
  if (isOn(rPr, "u")) out = `<u>${out}</u>`;
  if (isOn(rPr, "strike")) out = `<s>${out}</s>`;
  return out;
}

function renderInline(p: Element): { html: string; text: string } {
  let html = "";
  const walk = (el: Element) => {
    for (const node of Array.from(el.children)) {
      if (node.namespaceURI !== W_NS) continue;
      if (node.localName === "r") html += renderRun(node);
      else if (node.localName === "hyperlink" || node.localName === "smartTag" || node.localName === "ins") walk(node);
    }
  };
  walk(p);
  const text = (p.textContent ?? "").trim();
  return { html, text };
}

function renderParagraph(
  p: Element,
  numFormats: Map<string, boolean>,
): { html: string; text: string; list?: { ordered: boolean; level: number } } {
  const { html, text } = renderInline(p);
  const pPr = child(p, "pPr");
  const style = attr(child(pPr, "pStyle"), "val") ?? "";
  const headingMatch = style.match(/^Heading([1-6])$/i) ?? (/^Title$/i.test(style) ? ["", "1"] : null);
  const numPr = child(pPr, "numPr");

  if (headingMatch && text) {
    const level = headingMatch[1];
    return { html: `<h${level}>${html}</h${level}>`, text };
  }
  if (numPr && text) {
    const numId = attr(child(numPr, "numId"), "val") ?? "";
    const level = Number(attr(child(numPr, "ilvl"), "val") ?? 0);
    return {
      html: `<p>${html}</p>`,
      text,
      list: { ordered: numFormats.get(numId) ?? false, level },
    };
  }
  return { html: text || html ? `<p>${html}</p>` : "", text };
}

function renderBlocks(
  container: Element,
  numFormats: Map<string, boolean>,
  textParts: string[],
): string {
  const out: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listOrdered ? "ol" : "ul";
    out.push(`<${tag}>${listItems.map((li) => `<li>${li}</li>`).join("")}</${tag}>`);
    listItems = [];
  };

  for (const node of Array.from(container.children)) {
    if (node.namespaceURI !== W_NS) continue;

    if (node.localName === "p") {
      const r = renderParagraph(node, numFormats);
      if (r.text) textParts.push(r.text);
      if (r.list) {
        if (listItems.length && listOrdered !== r.list.ordered) flushList();
        listOrdered = r.list.ordered;
        listItems.push(r.html);
        continue;
      }
      flushList();
      if (r.html) out.push(r.html);
    } else if (node.localName === "tbl") {
      flushList();
      const rows = children(node, "tr").map((tr) => {
        const cells = children(tr, "tc").map((tc) => {
          const inner = renderBlocks(tc, numFormats, textParts) || "<p></p>";
          return `<td>${inner}</td>`;
        });
        return `<tr>${cells.join("")}</tr>`;
      });
      out.push(`<table><tbody>${rows.join("")}</tbody></table>`);
    } else if (node.localName === "sdt") {
      flushList();
      const content = child(node, "sdtContent");
      if (content) out.push(renderBlocks(content, numFormats, textParts));
    }
  }
  flushList();
  return out.join("");
}

async function readNumberingFormats(zip: JSZip): Promise<Map<string, boolean>> {
  const formats = new Map<string, boolean>();
  const file = zip.file("word/numbering.xml");
  if (!file) return formats;

  const doc = new DOMParser().parseFromString(await file.async("string"), "application/xml");
  const abstractOrdered = new Map<string, boolean>();
  for (const abs of children(doc.documentElement, "abstractNum")) {
    const id = attr(abs, "abstractNumId") ?? "";
    const lvl0 = children(abs, "lvl")[0];
    const fmt = attr(child(lvl0, "numFmt"), "val");
    abstractOrdered.set(id, !!fmt && fmt !== "bullet");
  }
  for (const num of children(doc.documentElement, "num")) {
    const id = attr(num, "numId") ?? "";
    const abstractId = attr(child(num, "abstractNumId"), "val") ?? "";
    formats.set(id, abstractOrdered.get(abstractId) ?? false);
  }
  return formats;
}

export async function convertDocxToDocument(
  docxBytes: Uint8Array,
): Promise<{ htmlContent: string; rawText: string }> {
  if (!docxBytes || docxBytes.length === 0) throw corrupted("DOCX file is empty (0 bytes)");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(docxBytes);
  } catch {
    throw corrupted("Invalid DOCX file format: not a valid ZIP archive");
  }

  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw corrupted("word/document.xml not found in DOCX archive");

  const xml = new DOMParser().parseFromString(await documentFile.async("string"), "application/xml");
  const body = child(xml.documentElement, "body");
  if (!body) throw corrupted("DOCX document body is missing");

  const numFormats = await readNumberingFormats(zip);
  const textParts: string[] = [];
  const htmlContent = renderBlocks(body, numFormats, textParts) || "<p></p>";
  const rawText = textParts.join("\n\n");

  return { htmlContent, rawText };
}
