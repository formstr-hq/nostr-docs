/**
 * src/features/driveImport/converters/mimeClassifier.ts
 * Comprehensive MIME type and file extension classification engine.
 *
 * Directs incoming Formstr Drive files to:
 * - Document Import Workflow (Markdown, Text, HTML, DOCX) -> TipTap Editor
 * - In-App Standalone Preview (Image, Video, Audio, PDF) -> Media Previewers
 * - Generic Binary Download Card (Executables, Archives, Unknown) -> Direct Download
 */

import type { DocumentSubtype, FileClassification } from "../types";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkdn", "mkd"]);
const MARKDOWN_MIMES = new Set(["text/markdown", "text/x-markdown"]);

const HTML_EXTENSIONS = new Set(["html", "htm", "xhtml"]);
const HTML_MIMES = new Set(["text/html", "application/xhtml+xml"]);

const DOCX_EXTENSIONS = new Set(["docx", "doc", "odt"]);
const DOCX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.oasis.opendocument.text",
]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "log",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "xml",
  "js",
  "ts",
  "jsx",
  "tsx",
  "css",
  "scss",
  "py",
  "rb",
  "go",
  "rs",
  "c",
  "cpp",
  "h",
  "java",
  "kt",
  "sql",
  "sh",
  "bash",
  "zsh",
  "env",
  "ini",
  "conf",
  "toml",
]);

const TEXT_MIMES = new Set([
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
  "text/csv",
  "text/tab-separated-values",
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
  "application/javascript",
  "application/x-javascript",
  "text/javascript",
  "text/css",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "tiff",
  "tif",
  "avif",
  "heic",
  "heif",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogv", "mov", "mkv", "avi", "m4v"]);

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "aac", "flac", "m4a", "weba", "opus"]);

/**
 * Extracts normalized lowercase file extension from a file name (without leading dot).
 */
export function resolveFileExtension(fileName?: string): string {
  if (!fileName || typeof fileName !== "string") return "";
  const clean = fileName.trim().toLowerCase();
  const lastDot = clean.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === clean.length - 1) return "";
  return clean.slice(lastDot + 1);
}

/**
 * Normalizes a MIME type string to lowercase trimmed representation.
 */
export function normalizeMimeType(mimeType?: string): string {
  if (!mimeType || typeof mimeType !== "string") return "application/octet-stream";
  const trimmed = mimeType.trim().toLowerCase();
  // Strip trailing parameters (e.g. "text/html; charset=utf-8" -> "text/html")
  const semicolon = trimmed.indexOf(";");
  return semicolon !== -1 ? trimmed.slice(0, semicolon).trim() : trimmed;
}

/**
 * Determines the document subtype if the file is a collaborative document.
 */
export function getDocumentSubtype(mimeType?: string, fileName?: string): DocumentSubtype | undefined {
  const normMime = normalizeMimeType(mimeType);
  const ext = resolveFileExtension(fileName);

  if (MARKDOWN_MIMES.has(normMime) || MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  if (HTML_MIMES.has(normMime) || HTML_EXTENSIONS.has(ext)) {
    return "html";
  }
  if (DOCX_MIMES.has(normMime) || DOCX_EXTENSIONS.has(ext)) {
    return "docx";
  }
  if (TEXT_MIMES.has(normMime) || TEXT_EXTENSIONS.has(ext) || normMime.startsWith("text/")) {
    return "text";
  }

  return undefined;
}

/**
 * Classifies a shared Formstr Drive file by MIME type and filename.
 * Produces routing category, document subtype, preview capability, and action guidance.
 */
export function classifyDriveFile(mimeType?: string, fileName?: string): FileClassification {
  const normMime = normalizeMimeType(mimeType);
  const ext = resolveFileExtension(fileName);

  // 1. Check Document Subtypes
  const docSubtype = getDocumentSubtype(normMime, fileName);
  if (docSubtype) {
    return {
      category: "document",
      documentSubtype: docSubtype,
      isDocument: true,
      isMedia: false,
      isPreviewable: docSubtype === "html", // HTML can also be previewed
      primaryAction: "import",
      actionLabel: "Import as Document",
      fileExtension: ext,
      normalizedMimeType: normMime,
    };
  }

  // 2. Check PDF
  if (normMime === "application/pdf" || ext === "pdf") {
    return {
      category: "media-pdf",
      isDocument: false,
      isMedia: true,
      isPreviewable: true,
      primaryAction: "preview",
      actionLabel: "Preview PDF",
      fileExtension: ext || "pdf",
      normalizedMimeType: "application/pdf",
    };
  }

  // 3. Check Image Media
  if (normMime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
    return {
      category: "media-image",
      isDocument: false,
      isMedia: true,
      isPreviewable: true,
      primaryAction: "preview",
      actionLabel: "Preview Image",
      fileExtension: ext,
      normalizedMimeType: normMime.startsWith("image/") ? normMime : `image/${ext}`,
    };
  }

  // 4. Check Video Media
  if (normMime.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
    return {
      category: "media-video",
      isDocument: false,
      isMedia: true,
      isPreviewable: true,
      primaryAction: "preview",
      actionLabel: "Preview Video",
      fileExtension: ext,
      normalizedMimeType: normMime.startsWith("video/") ? normMime : `video/${ext}`,
    };
  }

  // 5. Check Audio Media
  if (normMime.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) {
    return {
      category: "media-audio",
      isDocument: false,
      isMedia: true,
      isPreviewable: true,
      primaryAction: "preview",
      actionLabel: "Preview Audio",
      fileExtension: ext,
      normalizedMimeType: normMime.startsWith("audio/") ? normMime : `audio/${ext}`,
    };
  }

  // 6. Generic Binary Fallback
  return {
    category: "generic-binary",
    isDocument: false,
    isMedia: false,
    isPreviewable: false,
    primaryAction: "download",
    actionLabel: "Download File",
    fileExtension: ext,
    normalizedMimeType: normMime,
  };
}

