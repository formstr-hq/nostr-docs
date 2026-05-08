// src/utils/exportDocument.ts

import { decryptFile } from "./fileEncryption";
import { Document, Packer, Paragraph, ImageRun, TextRun } from "docx";

/**
 * Trigger a browser download of the given content as a file.
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Derive a safe filename from the document's first line / title.
 * Falls back to "untitled" if the content is empty.
 */
export function deriveFilename(markdown: string): string {
  const firstLine = markdown.split("\n").find((l) => l.trim());
  if (!firstLine) return "untitled";
  return (
    firstLine
      .replace(/^#+\s*/, "")
      .trim()
      .slice(0, 60)
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase() || "untitled"
  );
}

/** Shared styled HTML wrapper used by HTML export, PDF, and DOC. */
function styledHtmlDocument(html: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      max-width: 720px;
      margin: 2rem auto;
      padding: 0 1rem;
      line-height: 1.7;
      color: #1a1a1a;
    }
    h1, h2, h3, h4 { font-weight: 700; margin-top: 1.5em; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 1rem; color: #555; }
    img { max-width: 100%; height: auto; }
    a { color: #0070f3; }
    @media print {
      body { margin: 0; padding: 0; max-width: none; }
    }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
}

function waitForImageDecode(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

async function inlineEncryptedImagesForExport(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  console.debug("inlineEncryptedImagesForExport: start", { length: html.length });
  const nodes = Array.from(doc.querySelectorAll("encrypted-file"));

  await Promise.all(
    nodes.map(async (node) => {
      const src = node.getAttribute("data-src") ?? "";
      const decryptionKey = node.getAttribute("data-key") ?? "";
      const decryptionNonce = node.getAttribute("data-nonce") ?? "";
      const mimeType = node.getAttribute("data-mime") ?? "";
      const rawFilename = node.getAttribute("data-filename") ?? "file";
      const filename = decodeURIComponent(rawFilename);
      const width = node.getAttribute("data-width");

      if (!src || !decryptionKey || !decryptionNonce) {
        node.outerHTML = `<span>[Attachment unavailable: ${escapeHtml(filename)}]</span>`;
        return;
      }

      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const encryptedData = await response.arrayBuffer();
        const decrypted = await decryptFile(encryptedData, decryptionKey, decryptionNonce);

        const imageMime = mimeType.startsWith("image/") ? mimeType : "image/png";
        const blob = new Blob([decrypted], { type: imageMime });
        const objectUrl = URL.createObjectURL(blob);
        const isImage = await waitForImageDecode(objectUrl);
        URL.revokeObjectURL(objectUrl);

        if (!isImage) {
          node.outerHTML = `<span>[Attachment: ${escapeHtml(filename)}]</span>`;
          return;
        }

        const dataUrl = await blobToDataUrl(blob);
        const parsedWidth = width ? Number(width) : null;
        const safeWidth = parsedWidth && Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : null;
        const widthStyle = safeWidth ? ` style="width:${safeWidth}px;max-width:100%;height:auto;"` : "";
        node.outerHTML = `<img src="${dataUrl}" alt="${escapeHtml(filename)}"${widthStyle} />`;
        console.debug("inlineEncryptedImagesForExport: inlined image", { filename, src: src.slice(0, 120), size: blob.size, width: safeWidth });
      } catch {
        node.outerHTML = `<span>[Attachment unavailable: ${escapeHtml(filename)}]</span>`;
        console.warn("inlineEncryptedImagesForExport: failed to inline", { filename, src });
      }
    }),
  );

  try {
    const resultHtml = doc.body.innerHTML;
    console.debug("inlineEncryptedImagesForExport: result length", { length: resultHtml.length });
    console.debug("inlineEncryptedImagesForExport: resultPreview", resultHtml.slice(0, 1000));
    return resultHtml;
  } catch (e) {
    console.error("inlineEncryptedImagesForExport: error serializing result", e);
    return html;
  }
}

function waitForImagesInWindow(win: Window, timeoutMs = 8000): Promise<void> {
  const images = Array.from(win.document.images);
  const pending = images.filter((img) => !img.complete);

  if (!pending.length) return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    let remaining = pending.length;
    const timer = window.setTimeout(() => {
      finish();
    }, timeoutMs);

    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve();
    };

    const mark = () => {
      remaining -= 1;
      if (remaining <= 0) finish();
    };

    pending.forEach((img) => {
      const onDone = () => {
        img.removeEventListener("load", onDone);
        img.removeEventListener("error", onDone);
        mark();
      };
      img.addEventListener("load", onDone, { once: true });
      img.addEventListener("error", onDone, { once: true });
    });
  });
}

/**
 * Parse CSS style string and extract relevant properties.
 * Returns an object with normalized properties for DOCX conversion.
 */
function parseElementStyle(el: Element): {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  marginTop?: number;
  marginBottom?: number;
} {
  const computed = window.getComputedStyle(el);
  const result: ReturnType<typeof parseElementStyle> = {};

  // Font size (convert px to pt: 1pt ≈ 1.33px in print, but DOCX uses half-points)
  const fontSize = computed.fontSize;
  if (fontSize && fontSize.endsWith("px")) {
    const px = parseFloat(fontSize);
    result.fontSize = Math.round(px * 2); // Convert to half-points for DOCX
  }

  // Font family
  const fontFamily = computed.fontFamily;
  if (fontFamily && !fontFamily.includes("serif")) {
    result.fontFamily = fontFamily.split(",")[0].trim().replace(/"/g, "");
  }

  // Color (hex format)
  const color = computed.color;
  if (color && color !== "rgb(0, 0, 0)") {
    const rgb = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgb) {
      const r = parseInt(rgb[1]).toString(16).padStart(2, "0");
      const g = parseInt(rgb[2]).toString(16).padStart(2, "0");
      const b = parseInt(rgb[3]).toString(16).padStart(2, "0");
      result.color = `${r}${g}${b}`;
    }
  }

  // Font weight (bold)
  const fontWeight = computed.fontWeight;
  if (fontWeight && (parseInt(fontWeight) >= 700 || fontWeight === "bold")) {
    result.bold = true;
  }

  // Font style (italic)
  if (computed.fontStyle === "italic") {
    result.italic = true;
  }

  // Margins
  const marginTop = computed.marginTop;
  if (marginTop && marginTop.endsWith("px")) {
    result.marginTop = Math.round(parseFloat(marginTop) * 12.7); // px to twips
  }
  const marginBottom = computed.marginBottom;
  if (marginBottom && marginBottom.endsWith("px")) {
    result.marginBottom = Math.round(parseFloat(marginBottom) * 12.7);
  }

  return result;
}

/**
 * Parse HTML to DOCX Paragraph array, preserving structure, styles, and embedded images.
 * Handles heading levels, text formatting, colors, fonts, spacing, and base64 images.
 */
async function htmlToDocxParagraphs(html: string): Promise<Paragraph[]> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const paragraphs: Paragraph[] = [];

  async function procesNode(node: Node, inheritedStyle?: ReturnType<typeof parseElementStyle>): Promise<TextRun | ImageRun | null> {
    if (node.nodeType === 3) {
      // Text node
      const text = node.textContent?.trim();
      if (!text) return null;

      const runConfig: Record<string, unknown> = { text };
      if (inheritedStyle?.bold) runConfig.bold = true;
      if (inheritedStyle?.italic) runConfig.italics = true;
      if (inheritedStyle?.color) runConfig.color = inheritedStyle.color;
      if (inheritedStyle?.fontFamily) runConfig.font = inheritedStyle.fontFamily;
      if (inheritedStyle?.fontSize) runConfig.size = inheritedStyle.fontSize;

      return new TextRun(runConfig as Record<string, unknown>);
    }

    if (node.nodeType !== 1) return null;

    const el = node as Element;
    const tagName = el.tagName.toLowerCase();
    // parseElementStyle uses getComputedStyle which can fail on DOMParser
    // elements (not attached to the live document). Wrap in try-catch to
    // gracefully degrade to inherited styles only.
    let elemStyle: ReturnType<typeof parseElementStyle> = {};
    try {
      elemStyle = parseElementStyle(el);
    } catch {
      // Ignore — DOMParser elements don't support getComputedStyle
    }
    const style = { ...inheritedStyle, ...elemStyle };

    // ── Images (from data URLs or regular URLs) ──
    if (tagName === "img") {
      const src = el.getAttribute("src") ?? "";
      if (!src) return null;

      try {
        // Use fetch() to convert any URL (data: or http:) to raw binary —
        // this is far more reliable than regex-parsing huge base64 strings.
        const response = await fetch(src);
        if (!response.ok) return null;

        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // Determine image type from the response content-type or src
        const contentType = response.headers.get("content-type") ?? "";
        const mimeMatch = contentType.match(/image\/([^;\s]+)/) ?? src.match(/^data:image\/([^;,]+)/);
        const mime = mimeMatch?.[1]?.toLowerCase() ?? "png";
        const typeMap: Record<string, "png" | "jpg" | "gif"> = {
          png: "png", jpg: "jpg", jpeg: "jpg", gif: "gif", webp: "png", "svg+xml": "png", svg: "png",
        };
        const type: "png" | "jpg" | "gif" = typeMap[mime] ?? "png";

        // Get intrinsic image dimensions
        const imgEl = new Image();
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          imgEl.onload = () => resolve({ w: imgEl.naturalWidth || 400, h: imgEl.naturalHeight || 300 });
          imgEl.onerror = () => resolve({ w: 400, h: 300 });
          imgEl.src = src;
        });

        // Honour the inline style width if present
        const styleWidthStr = el.getAttribute("style")?.match(/width:\s*(\d+)px/)?.[1];
        let finalWidth = styleWidthStr ? parseInt(styleWidthStr) : dims.w;
        let finalHeight = dims.w > 0
          ? Math.round(dims.h * finalWidth / dims.w)
          : Math.round(finalWidth * 0.75);

        // Clamp to a sensible DOCX page width (~600 px ≈ 6 inches at 100 dpi)
        const MAX_WIDTH = 600;
        if (finalWidth > MAX_WIDTH) {
          finalHeight = Math.round(finalHeight * MAX_WIDTH / finalWidth);
          finalWidth = MAX_WIDTH;
        }

        return new ImageRun({
          data,
          transformation: { width: finalWidth, height: finalHeight },
          type,
        });
      } catch (e) {
        console.error("DOCX: failed to embed <img>", src.slice(0, 120), e);
      }
      return null;
    }

    // ── Encrypted file attachments (fallback if inlining didn't convert them) ──
    if (tagName === "encrypted-file") {
      const blobSrc = el.getAttribute("data-src") ?? "";
      const key = el.getAttribute("data-key") ?? "";
      const nonce = el.getAttribute("data-nonce") ?? "";
      const mime = el.getAttribute("data-mime") ?? "";
      const widthAttr = el.getAttribute("data-width");

      if (!blobSrc || !key || !nonce || !mime.startsWith("image/")) return null;

      try {
        const response = await fetch(blobSrc);
        if (!response.ok) return null;

        const encryptedData = await response.arrayBuffer();
        const decrypted = await decryptFile(encryptedData, key, nonce);
        const data = new Uint8Array(decrypted);

        const sub = mime.replace("image/", "").toLowerCase();
        const typeMap: Record<string, "png" | "jpg" | "gif"> = {
          png: "png", jpg: "jpg", jpeg: "jpg", gif: "gif", webp: "png", "svg+xml": "png",
        };
        const type: "png" | "jpg" | "gif" = typeMap[sub] ?? "png";

        // Probe dimensions by loading into an Image
        const blob = new Blob([decrypted], { type: mime });
        const objectUrl = URL.createObjectURL(blob);
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
          img.onerror = () => resolve({ w: 400, h: 300 });
          img.src = objectUrl;
        });
        URL.revokeObjectURL(objectUrl);

        let finalWidth = widthAttr ? parseInt(widthAttr) || dims.w : dims.w;
        let finalHeight = dims.w > 0
          ? Math.round(dims.h * finalWidth / dims.w)
          : Math.round(finalWidth * 0.75);

        const MAX_WIDTH = 600;
        if (finalWidth > MAX_WIDTH) {
          finalHeight = Math.round(finalHeight * MAX_WIDTH / finalWidth);
          finalWidth = MAX_WIDTH;
        }

        return new ImageRun({
          data,
          transformation: { width: finalWidth, height: finalHeight },
          type,
        });
      } catch (e) {
        console.error("DOCX: failed to embed <encrypted-file>", blobSrc.slice(0, 120), e);
      }
      return null;
    }

    // ── Headings ──
    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
      const level = parseInt(tagName[1]);
      const text = el.textContent || "";

      const headingLevels: Record<number, "Heading1" | "Heading2" | "Heading3" | "Heading4" | "Heading5" | "Heading6"> = {
        1: "Heading1",
        2: "Heading2",
        3: "Heading3",
        4: "Heading4",
        5: "Heading5",
        6: "Heading6",
      };

      const headingSizes: Record<number, number> = {
        1: 56,  // 28pt in half-points
        2: 48,  // 24pt
        3: 40,  // 20pt
        4: 32,  // 16pt
        5: 28,  // 14pt
        6: 24,  // 12pt
      };

      paragraphs.push(
        new Paragraph({
          heading: headingLevels[level],
          children: [
            new TextRun({
              text,
              bold: true,
              size: headingSizes[level],
            }),
          ],
          spacing: {
            before: 200,
            after: 200,
            line: 360,
          },
        })
      );
      return null;
    }

    // ── Paragraphs ──
    if (tagName === "p" || tagName === "div") {
      const children: (TextRun | ImageRun)[] = [];
      for (const child of el.childNodes) {
        try {
          const result = await procesNode(child, style);
          if (result instanceof TextRun || result instanceof ImageRun) {
            children.push(result);
          }
        } catch (e) {
          console.error("DOCX: error processing child in <p>", e);
        }
      }

      if (children.length > 0) {
        paragraphs.push(
          new Paragraph({
            children,
            spacing: {
              before: style.marginTop ?? 100,
              after: style.marginBottom ?? 100,
              line: 360, // 1.5x line height
            },
          })
        );
      }
      return null;
    }

    // ── Lists ──
    if (tagName === "ul" || tagName === "ol") {
      const items = el.querySelectorAll("li");
      for (let i = 0; i < items.length; i++) {
        const li = items[i];
        const children: (TextRun | ImageRun)[] = [];
        for (const child of li.childNodes) {
          const result = await procesNode(child, style);
          if (result instanceof TextRun || result instanceof ImageRun) children.push(result);
        }
        const content = children.length > 0 ? children : [new TextRun(li.textContent || "")];
        paragraphs.push(
          new Paragraph({
            children: content,
            bullet: { level: 0 },
            spacing: { line: 360 },
          })
        );
      }
      return null;
    }

    // ── Blockquotes ──
    if (tagName === "blockquote") {
      const children: (TextRun | ImageRun)[] = [];
      for (const child of el.childNodes) {
        const result = await procesNode(child, style);
        if (result instanceof TextRun || result instanceof ImageRun) children.push(result);
      }
      paragraphs.push(
        new Paragraph({
          children: children.length > 0 ? children : [new TextRun("")],
          indent: { left: 720, firstLine: 0 },
          spacing: {
            before: 200,
            after: 200,
            line: 360,
          },
          border: {
            left: {
              color: "CCCCCC",
              space: 1,
              style: "single",
              size: 12,
            },
          },
        })
      );
      return null;
    }

    // ── Code blocks ──
    if (tagName === "pre") {
      const code = el.textContent || "";
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: code, font: "Courier New" })],
          spacing: { before: 100, after: 100, line: 240 },
          shading: { fill: "F4F4F4" },
        })
      );
      return null;
    }

    // ── Inline text formatting ──
    if (tagName === "strong" || tagName === "b") {
      const text = el.textContent || "";
      return new TextRun({
        text,
        bold: true,
        ...(style.color && { color: style.color }),
        ...(style.fontFamily && { font: style.fontFamily }),
      });
    }

    if (tagName === "em" || tagName === "i") {
      const text = el.textContent || "";
      return new TextRun({
        text,
        italics: true,
        ...(style.color && { color: style.color }),
        ...(style.fontFamily && { font: style.fontFamily }),
      });
    }

    if (tagName === "u") {
      const text = el.textContent || "";
      return new TextRun({
        text,
        underline: {},
        ...(style.color && { color: style.color }),
        ...(style.fontFamily && { font: style.fontFamily }),
      });
    }

    if (tagName === "a") {
      const text = el.textContent || "";
      return new TextRun({
        text,
        color: "0070F3",
        underline: {},
      });
    }

    // ── Code (inline) ──
    if (tagName === "code") {
      const text = el.textContent || "";
      return new TextRun({
        text,
        font: "Courier New",
        shading: { fill: "F4F4F4" },
      });
    }

    // ── Fallback: process children ──
    // Collect inline results (images, text) so they aren't silently discarded
    const fallbackChildren: (TextRun | ImageRun)[] = [];
    for (const child of el.childNodes) {
      const result = await procesNode(child, style);
      if (result instanceof TextRun || result instanceof ImageRun) {
        fallbackChildren.push(result);
      }
    }
    if (fallbackChildren.length > 0) {
      paragraphs.push(new Paragraph({ children: fallbackChildren }));
    }

    return null;
  }

  // Process body children — collect any inline results (e.g. top-level
  // <img> tags) that procesNode returns instead of pushing to paragraphs[].
  const topLevelInline: (TextRun | ImageRun)[] = [];
  for (const child of doc.body.childNodes) {
    const result = await procesNode(child);
    if (result instanceof TextRun || result instanceof ImageRun) {
      topLevelInline.push(result);
    }
  }
  // Wrap any collected top-level inline content in a paragraph
  if (topLevelInline.length > 0) {
    paragraphs.push(new Paragraph({ children: topLevelInline }));
  }

  // Ensure at least one paragraph
  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph(""));
  }

  return paragraphs;
}

/* ── Export formats ────────────────────────────────────────── */

/**
 * Export as Markdown (.md) — raw source, no transformation.
 */
export function exportAsMarkdown(markdown: string, filename?: string) {
  const name = filename ?? deriveFilename(markdown);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, `${name}.md`);
}

/**
 * Export as plain text (.txt) — strips all markdown syntax.
 */
export function exportAsPlainText(markdown: string, filename?: string) {
  const name = filename ?? deriveFilename(markdown);
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`{3}[\s\S]*?`{3}/g, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.+?)\]\(.*?\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  const blob = new Blob([plain], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `${name}.txt`);
}

/**
 * Export as HTML (.html) — styled standalone web page with inlined attachments.
 */
export async function exportAsHtml(html: string, title: string, filename?: string) {
  const derived = title
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const name = filename ?? (derived || "untitled");
  const exportHtml = await inlineEncryptedImagesForExport(html);
  const fullHtml = styledHtmlDocument(exportHtml, title);
  const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, `${name}.html`);
}

/**
 * Export as PDF — opens the browser's native Print → Save as PDF dialog.
 * Zero dependencies. Generates flawless vector text and uses native print engine.
 */
export async function exportAsPdf(html: string, title: string) {
  const exportHtml = await inlineEncryptedImagesForExport(html);
  const fullHtml = styledHtmlDocument(exportHtml, title);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  printWindow.document.write(fullHtml);
  printWindow.document.close();

  await waitForImagesInWindow(printWindow);

  // Trigger print after content and images are ready.
  printWindow.addEventListener("afterprint", () => printWindow.close());
  printWindow.print();
}

/**
 * Export as Word DOCX (.docx) using proper OOXML format with inlined attachments.
 * Generates valid Office Open XML archive with embedded base64 images.
 */
export async function exportAsDocx(html: string, title: string, filename?: string) {
  const derived = title
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const name = filename ?? (derived || "untitled");

  try {
    // Pass the raw editor HTML directly to htmlToDocxParagraphs.
    // Unlike HTML/PDF export, we do NOT run inlineEncryptedImagesForExport here
    // because the DOMParser + Promise.all + outerHTML mutation pattern can lose
    // sibling images when multiple <encrypted-file> tags share the same parent.
    // htmlToDocxParagraphs handles <encrypted-file> tags natively by fetching,
    // decrypting, and creating ImageRun objects from the raw binary data.
    const paragraphs = await htmlToDocxParagraphs(html);

    // Create and pack OOXML document
    const doc = new Document({
      sections: [
        {
          children: paragraphs,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `${name}.docx`);
  } catch (e) {
    console.error("DOCX export failed:", e);
    throw e;
  }
}
