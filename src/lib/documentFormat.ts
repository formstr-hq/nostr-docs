import type { JSONContent } from "@tiptap/core";
import type { EncryptedBlobRef } from "./encryptedBlob";

/**
 * Versioned envelope for the rich document body stored in KIND_RICH_DOCUMENT.
 *
 * The document model is ProseMirror JSON. HTML, Markdown, DOCX and PDF are
 * adapters around this model; they are never the durable source of truth.
 */
export const RICH_DOCUMENT_FORMAT = "prosemirror-json";
export const RICH_DOCUMENT_VERSION = 1;

/** Original imported DOCX package, either inline (legacy/device-only) or on Blossom. */
export interface OoxmlSource {
  package?: string;
  packageRef?: EncryptedBlobRef;
}

export interface RichDocumentPayload {
  format: typeof RICH_DOCUMENT_FORMAT;
  version: number;
  doc: JSONContent;
  ooxml?: OoxmlSource;
}

export type ParsedDocumentContent =
  | {
      kind: "rich";
      doc: JSONContent;
      package?: string;
      packageRef?: EncryptedBlobRef;
      raw: string;
    }
  | { kind: "markdown"; markdown: string; raw: string };

/** Serialize a ProseMirror doc into the encrypted payload for KIND_RICH_DOCUMENT. */
export function serializeRichDocument(
  doc: JSONContent,
  ooxml?: string | OoxmlSource,
): string {
  const source = typeof ooxml === "string" ? { package: ooxml } : ooxml;
  const ooxmlPayload =
    source && (source.package || source.packageRef)
      ? {
          ooxml: {
            ...(source.package ? { package: source.package } : {}),
            ...(source.packageRef ? { packageRef: source.packageRef } : {}),
          },
        }
      : {};
  const payload: RichDocumentPayload = {
    format: RICH_DOCUMENT_FORMAT,
    version: RICH_DOCUMENT_VERSION,
    doc,
    ...ooxmlPayload,
  };
  return JSON.stringify(payload);
}

/**
 * Detect the stored content format.
 *
 * KIND_RICH_DOCUMENT always carries the envelope, but we also accept a bare
 * ProseMirror doc for forward compatibility/imports. Anything else is treated
 * as legacy Markdown (KIND_FILE), which must remain readable forever.
 */
export function parseDocumentContent(raw: string): ParsedDocumentContent {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<RichDocumentPayload> & JSONContent;
      if (
        parsed &&
        parsed.format === RICH_DOCUMENT_FORMAT &&
        parsed.doc &&
        typeof parsed.doc === "object" &&
        typeof parsed.doc.type === "string"
      ) {
        return {
          kind: "rich",
          doc: parsed.doc,
          ...(parsed.ooxml?.package ? { package: parsed.ooxml.package } : {}),
          ...(parsed.ooxml?.packageRef
            ? { packageRef: parsed.ooxml.packageRef }
            : {}),
          raw,
        };
      }
      // Tolerate a bare ProseMirror doc (useful for imports/tests).
      if (parsed && typeof parsed.type === "string" && Array.isArray(parsed.content)) {
        return { kind: "rich", doc: parsed as JSONContent, raw };
      }
    } catch {
      // Not JSON — fall through to legacy Markdown.
    }
  }
  return { kind: "markdown", markdown: raw, raw };
}

function textFromNode(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "pageBreak") return "\n";

  const childText = (node.content ?? []).map(textFromNode).join("");
  const blockTypes = new Set([
    "paragraph",
    "heading",
    "listItem",
    "blockquote",
    "codeBlock",
    "tableRow",
    "tableCell",
    "tableHeader",
  ]);
  return blockTypes.has(node.type ?? "") ? `${childText}\n` : childText;
}

/** Plain text projection used for titles, search, filenames and comments. */
export function richDocumentToPlainText(doc: JSONContent): string {
  return textFromNode(doc)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text for either stored format. */
export function documentToPlainText(raw: string): string {
  const parsed = parseDocumentContent(raw);
  return parsed.kind === "rich"
    ? richDocumentToPlainText(parsed.doc)
    : markdownToPlainText(parsed.markdown);
}

/** Markdown projection for either stored format — an export/import adapter. */
export function documentToMarkdown(raw: string): string {
  const parsed = parseDocumentContent(raw);
  return parsed.kind === "rich"
    ? richDocumentToMarkdown(parsed.doc)
    : parsed.markdown;
}

function inlineToMarkdown(node: JSONContent): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case "bold":
          text = `**${text}**`;
          break;
        case "italic":
          text = `*${text}*`;
          break;
        case "strike":
          text = `~~${text}~~`;
          break;
        case "code":
          text = `\`${text}\``;
          break;
        case "link":
          text = `[${text}](${mark.attrs?.href ?? ""})`;
          break;
        case "textStyle":
          if (mark.attrs?.color) {
            text = `<span style="color: ${mark.attrs.color}">${text}</span>`;
          }
          break;
        default:
          break;
      }
    }
    return text;
  }
  if (node.type === "hardBreak") return "  \n";
  return (node.content ?? []).map(inlineToMarkdown).join("");
}

function blockToMarkdown(node: JSONContent, depth = 0): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((child) => blockToMarkdown(child)).join("\n\n");
    case "paragraph":
      return inlineToMarkdown(node);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `${"#".repeat(level)} ${inlineToMarkdown(node)}`;
    }
    case "bulletList":
      return (node.content ?? [])
        .map((item) => {
          const body = (item.content ?? [])
            .map((child) => blockToMarkdown(child, depth + 1))
            .join("\n");
          return `${"  ".repeat(depth)}- ${body.replace(/\n/g, `\n${"  ".repeat(depth)}  `)}`;
        })
        .join("\n");
    case "orderedList":
      return (node.content ?? [])
        .map((item, index) => {
          const body = (item.content ?? [])
            .map((child) => blockToMarkdown(child, depth + 1))
            .join("\n");
          return `${"  ".repeat(depth)}${index + 1}. ${body.replace(/\n/g, `\n${"  ".repeat(depth)}   `)}`;
        })
        .join("\n");
    case "listItem":
      return (node.content ?? []).map((child) => blockToMarkdown(child, depth)).join("\n");
    case "blockquote":
      return (node.content ?? [])
        .map((child) => blockToMarkdown(child, depth))
        .join("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock":
      return `\`\`\`\n${(node.content ?? []).map((child) => child.text ?? "").join("")}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "pageBreak":
      return '<div data-page-break="true"></div>';
    case "ooxmlBlock": {
      const label = String(node.attrs?.label ?? "Word content").replace(
        /"/g,
        "&quot;",
      );
      return `<div data-ooxml-block="true" data-label="${label}"></div>`;
    }
    case "ooxmlImage": {
      const attrs = node.attrs ?? {};
      const src = String(attrs.src ?? "");
      if (!src) return "";
      if (src.startsWith("data:")) {
        return `![${String(attrs.alt ?? "")}](${src})`;
      }
      const width = attrs.width != null ? ` data-width="${attrs.width}"` : "";
      const height = attrs.height != null ? ` data-height="${attrs.height}"` : "";
      return `<encrypted-file data-ooxml-image="true" data-src="${src}" data-key="${String(
        attrs.decryptionKey ?? "",
      )}" data-nonce="${String(attrs.decryptionNonce ?? "")}" data-mime="${String(
        attrs.mimeType ?? "image/png",
      )}" data-filename="${encodeURIComponent(
        String(attrs.filename ?? attrs.alt ?? "Word image"),
      )}"${width}${height}></encrypted-file>`;
    }
    case "table": {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          (cell.content ?? []).map((child) => blockToMarkdown(child, depth)).join(" ").replace(/\n/g, " ").trim(),
        ),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
      return [line(rows[0]), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)].join("\n");
    }
    case "encryptedFile": {
      const attrs = node.attrs ?? {};
      return `<encrypted-file data-src="${attrs.src ?? ""}" data-key="${attrs.decryptionKey ?? ""}" data-nonce="${attrs.decryptionNonce ?? ""}" data-mime="${attrs.mimeType ?? ""}" data-filename="${encodeURIComponent(attrs.filename ?? "")}"></encrypted-file>`;
    }
    case "nostrForm": {
      const attrs = node.attrs ?? {};
      return `<nostr-form data-naddr="${attrs.naddr ?? ""}" data-nkeys="${attrs.nkeys ?? ""}"></nostr-form>`;
    }
    default:
      return (node.content ?? []).map((child) => blockToMarkdown(child, depth)).join("\n\n");
  }
}

/** Best-effort Markdown serialization of a rich ProseMirror doc. */
export function richDocumentToMarkdown(doc: JSONContent): string {
  return blockToMarkdown(doc)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Best-effort plain text for legacy Markdown without pulling the editor in.
 * Keeps the first heading/title readable while dropping markup noise.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^\s*<!--pages-layout:[^>]*-->\s*/i, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-*+]\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First meaningful line, used for page titles and export filenames. */
export function documentTitle(raw: string): string {
  const text = documentToPlainText(raw);
  const firstLine = text.split("\n").find((line) => line.trim());
  return (firstLine ?? "").trim().slice(0, 120);
}
