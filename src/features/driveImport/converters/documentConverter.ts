/**
 * src/features/driveImport/converters/documentConverter.ts
 * Converts a decrypted Drive file (Markdown, HTML, plain text or DOCX) into what the
 * import screen needs: HTML for the reader, plain text for the word count, and the
 * Markdown that Pages stores when the user opens it in the editor.
 */

import MarkdownIt from "markdown-it";
import {
  DriveImportError,
  type DecryptedDriveFile,
  type DocumentImportResult,
} from "../types";
import { classifyDriveFile } from "./mimeClassifier";
import { convertDocxToDocument } from "./docxConverter";
import { htmlToMarkdown } from "./htmlToMarkdown";

export { convertDocxToDocument };

type Converted = { htmlContent: string; rawText: string };

/** html: false turns raw HTML inside a Markdown file into text instead of markup. */
const markdown = new MarkdownIt({ html: false, linkify: false });

/**
 * Strips path components and document file extensions to derive a clean display title.
 * Falls back to "Untitled Document (Imported)" if result is empty.
 */
export function sanitizeDocumentTitle(fileName?: string): string {
  if (!fileName || typeof fileName !== "string") {
    return "Untitled Document (Imported)";
  }

  // Strip path traversal prefixes (both UNIX / and Windows \)
  const baseName = fileName.replace(/^.*[/\\]/, "").trim();
  if (!baseName) {
    return "Untitled Document (Imported)";
  }

  // Strip known document extensions
  const stripped = baseName.replace(
    /\.(md|markdown|mdown|mkdn|txt|text|html|htm|xhtml|docx|doc|odt|log|json|xml|csv)$/i,
    "",
  ).trim();

  const cleaned = stripped.replace(/^\.+$/, "").trim();
  return cleaned.length > 0 ? cleaned : "Untitled Document (Imported)";
}

/** Escapes unsafe HTML characters. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function convertMarkdownToDocument(markdownText: string): Converted {
  const rawText = markdownText || "";
  return { htmlContent: markdown.render(rawText).trim() || "<p></p>", rawText };
}

/** Paragraphs are separated by blank lines; single newlines inside one become line breaks. */
export function convertPlainTextToDocument(plainText: string): Converted {
  const rawText = (plainText || "").replace(/\r\n?/g, "\n");
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split("\n").map(escapeHtml).join("<br />")}</p>`);
  return { htmlContent: paragraphs.join("") || "<p></p>", rawText };
}

/** Removes scripts, styles, frames and event handlers; the reader also renders in a sandboxed iframe. */
export function convertHtmlToDocument(htmlText: string): Converted {
  const sanitized = htmlText
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

  // Word count and plain text: break at block boundaries, then drop the tags.
  const rawText = sanitized
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { htmlContent: sanitized.trim() || "<p></p>", rawText };
}

/** Converts a decrypted Drive file into the document the import screen shows and the editor saves. */
export async function convertDriveFileToDocument(
  file: DecryptedDriveFile | { data: Uint8Array; name: string; mimeType: string },
): Promise<DocumentImportResult> {
  const classification = classifyDriveFile(file.mimeType, file.name);

  if (!classification.isDocument) {
    throw new DriveImportError(
      "UNSUPPORTED_DOCUMENT_FORMAT",
      `Cannot import "${file.name}" as document: format "${classification.normalizedMimeType}" is not a supported document type`,
      "Import is available for Markdown, Plain Text, HTML, and Word documents",
      "Unsupported Document",
      "mimeType",
    );
  }

  const title = sanitizeDocumentTitle(file.name);
  const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const subtype = classification.documentSubtype || "text";
  const decode = () => new TextDecoder("utf-8").decode(file.data);

  let converted: Converted;
  switch (subtype) {
    case "docx":
      converted = await convertDocxToDocument(file.data);
      break;
    case "markdown":
      converted = convertMarkdownToDocument(decode());
      break;
    case "html":
      converted = convertHtmlToDocument(decode());
      break;
    default:
      converted = convertPlainTextToDocument(decode());
  }

  // Pages stores Markdown. HTML and docx are converted from their HTML (needs a DOM; plain text elsewhere).
  const bodyMarkdown =
    (subtype === "docx" || subtype === "html") && typeof DOMParser !== "undefined"
      ? htmlToMarkdown(converted.htmlContent)
      : converted.rawText;
  // The title is the first line of a page, so a file that does not open with a heading gets its name.
  const pageMarkdown = /^#{1,6}\s/.test(bodyMarkdown) ? bodyMarkdown : `# ${title}\n\n${bodyMarkdown}`;

  const trimmed = converted.rawText.trim();
  return {
    docId,
    title,
    markdown: pageMarkdown,
    format: subtype === "markdown" ? "markdown" : subtype === "html" ? "html" : "text",
    htmlContent: converted.htmlContent,
    rawText: converted.rawText,
    sourceFileName: file.name,
    sourceMimeType: classification.normalizedMimeType,
    characterCount: converted.rawText.length,
    wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
    createdAt: Date.now(),
  };
}
