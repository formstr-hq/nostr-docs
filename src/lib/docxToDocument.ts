import mammoth from "mammoth";
import type { JSONContent } from "@tiptap/core";
import { htmlToRichDocument } from "./markdownToDocument";

export interface DocxImportResult {
  doc: JSONContent;
  messages: string[];
}

/**
 * DOCX -> canonical ProseMirror JSON import adapter.
 *
 * Mammoth gives us semantic HTML from the WordprocessingML body; the editor
 * schema then parses that HTML. Mammoth is intentionally a semantic converter,
 * not a package-preserving OOXML round-trip: constructs it cannot map to HTML
 * (headers/footers, footnotes, tracked changes, floating objects, some section
 * properties) are dropped.
 *
 * That is a limitation of this adapter, not of the document model. A proper
 * OOXML adapter can map the package to rich nodes and preserve unmodelled parts
 * in an opaque sidecar, then write the package back. The internal model does
 * not need to be OOXML for that to work.
 */
export async function docxToRichDocument(data: ArrayBuffer): Promise<DocxImportResult> {
  const result = await mammoth.convertToHtml({ arrayBuffer: data });
  return {
    doc: htmlToRichDocument(result.value),
    messages: result.messages.map((message) => message.message),
  };
}
