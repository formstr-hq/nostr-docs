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
 * schema then parses that HTML. This is an editable conversion, not a perfect
 * OOXML round-trip: headers/footers, footnotes, tracked changes and some
 * floating objects are not representable and are reported as warnings.
 */
export async function docxToRichDocument(data: ArrayBuffer): Promise<DocxImportResult> {
  const result = await mammoth.convertToHtml({ arrayBuffer: data });
  return {
    doc: htmlToRichDocument(result.value),
    messages: result.messages.map((message) => message.message),
  };
}
