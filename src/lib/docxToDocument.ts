import type { JSONContent } from "@tiptap/core";
import { DEFAULT_PAGE_LAYOUT, type PageLayout } from "./docLayout";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { fetchEncryptedBase64 } from "./encryptedBlob";
import type { OoxmlSource } from "./documentFormat";
import { DocxPackage } from "./ooxml/package";
import { parseDocumentXml, serializeDocumentXml } from "./ooxml/body";
import { resolveImageBlocks } from "./ooxml/images";
import { ooxmlToRichDocument } from "./ooxml/rich";
import { applyRichDocumentToOoxml } from "./ooxml/writer";
import { pageSetupToLayout, parsePageSetup, applyLayoutToSection } from "./ooxml/sections";

export interface DocxImportResult {
  doc: JSONContent;
  layout: PageLayout;
  /** Base64 of the original package, kept as the DOCX export source. */
  packageBase64: string;
  messages: string[];
}

/**
 * Resolve the package bytes for export. New imports store an encrypted Blossom
 * reference; older/device-only imports may still carry the inline base64.
 */
export async function resolveOoxmlPackageBase64(
  source?: string | OoxmlSource,
): Promise<string | undefined> {
  const inline = typeof source === "string" ? source : source?.package;
  if (inline) return inline;
  const ref = typeof source === "object" ? source?.packageRef : undefined;
  return ref ? fetchEncryptedBase64(ref) : undefined;
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
  await resolveImageBlocks(parsed, pkg);
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
  layout?: PageLayout,
): Promise<Blob> {
  const pkg = await DocxPackage.load(base64ToBytes(packageBase64));
  const parsed = parseDocumentXml(await pkg.text("word/document.xml"));
  applyRichDocumentToOoxml(parsed, doc);
  if (layout) applyLayoutToSection(parsed, layout);
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
