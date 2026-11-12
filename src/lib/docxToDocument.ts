import type { JSONContent } from "@tiptap/core";
import { DEFAULT_PAGE_LAYOUT, type PageLayout } from "./docLayout";
import { DocxPackage } from "./ooxml/package";
import { parseDocumentXml, serializeDocumentXml } from "./ooxml/body";
import { ooxmlToRichDocument } from "./ooxml/rich";
import { applyRichDocumentToOoxml } from "./ooxml/writer";
import { pageSetupToLayout, parsePageSetup } from "./ooxml/sections";

export interface DocxImportResult {
  doc: JSONContent;
  layout: PageLayout;
  /** Base64 of the original package, kept as the DOCX export source. */
  packageBase64: string;
  messages: string[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function countRawBlocks(doc: JSONContent): number {
  let count = 0;
  const visit = (node: JSONContent) => {
    if (node.type === "ooxmlBlock") count += 1;
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return count;
}

/**
 * DOCX -> canonical rich document using our own OOXML adapter.
 *
 * Supported content (paragraphs, headings, simple tables, numbered lists) maps
 * to editable rich nodes. Unsupported blocks (drawings, merged tables, fields,
 * tracked changes, content controls, …) become `ooxmlBlock` placeholders that
 * carry their raw XML, and the original DOCX package is retained for lossless
 * export.
 */
export async function docxToRichDocument(
  data: ArrayBuffer,
): Promise<DocxImportResult> {
  const pkg = await DocxPackage.load(data);
  const documentXml = await pkg.text("word/document.xml");
  const parsed = parseDocumentXml(documentXml);
  const doc = ooxmlToRichDocument(parsed);
  const setup = await parsePageSetup(pkg);
  const layout = pageSetupToLayout(setup, {
    ...DEFAULT_PAGE_LAYOUT,
    canvas: "page",
  });

  const rawBlocks = countRawBlocks(doc);
  const messages: string[] = [];
  if (rawBlocks > 0) {
    messages.push(
      `Preserved ${rawBlocks} unsupported Word block${rawBlocks === 1 ? "" : "s"} as read-only.`,
    );
  }

  return {
    doc,
    layout,
    packageBase64: bytesToBase64(new Uint8Array(data)),
    messages,
  };
}

/**
 * Write an edited rich document back into its original DOCX package. The body
 * is rebuilt from editable paragraphs/tables; raw `ooxmlBlock` nodes are
 * re-emitted; every other part (headers/footers, media, comments, footnotes,
 * styles) is left untouched.
 */
export async function richDocumentToDocxBlob(
  packageBase64: string,
  doc: JSONContent,
): Promise<Blob> {
  const pkg = await DocxPackage.load(base64ToBytes(packageBase64));
  const parsed = parseDocumentXml(await pkg.text("word/document.xml"));
  applyRichDocumentToOoxml(parsed, doc);
  pkg.setText("word/document.xml", serializeDocumentXml(parsed));
  const bytes = await pkg.save();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
