// src/utils/exportDocument.ts

import { decryptFile } from "./fileEncryption";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  PageBreak,
  PageOrientation,
  Packer,
  Paragraph,
  ImageRun,
  TextRun,
  convertInchesToTwip,
} from "docx";
import {
  DEFAULT_PAGE_LAYOUT,
  getPageDimensions,
  normalizePageLayout,
  type BlockStyle,
  type PageHeaderFooter,
  type PageLayout,
} from "../lib/docLayout";

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
      .replace(/<[^>]*>/g, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#+\s*/, "")
      .replace(/[*_~`]/g, "")
      .trim()
      .slice(0, 60)
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase() || "untitled"
  );
}

/** Shared styled HTML wrapper used by HTML export, PDF, and DOC. */
function styledHtmlDocument(
  html: string,
  title: string,
  layoutInput?: PageLayout,
): string {
  const layout = normalizePageLayout(layoutInput ?? DEFAULT_PAGE_LAYOUT);
  const dimensions = getPageDimensions(layout);
  const { margins } = layout;
  const contentWidthIn =
    dimensions.widthIn - margins.left - margins.right;
  const header = layout.header ? slotsHtml(layout.header, "pages-header") : "";
  const footer = layout.footer ? slotsHtml(layout.footer, "pages-footer") : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: ${dimensions.widthIn}in ${dimensions.heightIn}in;
      margin: ${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in;
    }
    body {
      font-family: ${cssFontFamily(layout.fontFamily)};
      font-size: ${layout.fontSizePt}pt;
      line-height: ${layout.lineHeight};
      max-width: ${contentWidthIn}in;
      margin: 2rem auto;
      padding: 0 1rem;
      color: #1a1a1a;
    }
    h1, h2, h3, h4 { font-weight: 700; margin-top: 1.5em; }
${blockCssText("h1", layout.styles?.h1)}
${blockCssText("h2", layout.styles?.h2)}
${blockCssText("h3", layout.styles?.h3)}
${blockCssText("h4", layout.styles?.h4)}
${blockCssText("p", layout.styles?.paragraph)}
${blockCssText("blockquote", layout.styles?.blockquote)}
    pre { background: #f4f4f4; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 1rem; color: #555; }
    hr { border: none; border-top: 2px solid ${layout.ruleColor ?? "#ddd"}; margin: 1.15em 0; }
    img { max-width: 100%; height: auto; }
    a { color: #0070f3; }
    .pages-header, .pages-footer {
      display: flex;
      gap: 1rem;
      align-items: baseline;
      font-size: 0.75em;
      color: #666;
    }
    .pages-header { border-bottom: 1px solid #e5e7eb; padding-bottom: 0.4rem; margin-bottom: 1.2rem; }
    .pages-footer { border-top: 1px solid #e5e7eb; padding-top: 0.4rem; margin-top: 1.2rem; }
    .pages-header > span, .pages-footer > span { flex: 1; }
    .pages-header > span:nth-child(1), .pages-footer > span:nth-child(1) { text-align: left; }
    .pages-header > span:nth-child(2), .pages-footer > span:nth-child(2) { text-align: center; }
    .pages-header > span:nth-child(3), .pages-footer > span:nth-child(3) { text-align: right; }
    [data-columns] { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); gap: 1.75rem; align-items: start; }
    [data-column] { min-width: 0; }
    [data-page-break] { border-top: 2px dashed #ddd; margin: 2em 0; height: 0; }
    @media print {
      [data-columns] { display: table; width: 100%; }
      [data-column] { display: table-cell; vertical-align: top; }
      [data-column] + [data-column] { padding-left: 1.75rem; }
      body { margin: 0; padding: 0; max-width: none; }
      .pages-header {
        position: fixed;
        top: 0.28in;
        left: ${margins.left}in;
        right: ${margins.right}in;
        border: 0;
        padding: 0;
        margin: 0;
      }
      .pages-footer {
        position: fixed;
        bottom: 0.28in;
        left: ${margins.left}in;
        right: ${margins.right}in;
        border: 0;
        padding: 0;
        margin: 0;
      }
      [data-page-break] {
        break-after: page;
        page-break-after: always;
        border: 0;
        margin: 0;
      }
    }
  </style>
</head>
<body>
${header}
<div class="pages-content">
${html}
</div>
${footer}
</body>
</html>`;
}

function cssFontFamily(family: string): string {
  return `"${family.replace(/["\\]/g, "")}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
}

function blockCssText(tag: string, style: BlockStyle | undefined): string {
  if (!style) return "";
  const declarations: string[] = [];
  if (style.fontFamily) declarations.push(`font-family: ${cssFontFamily(style.fontFamily)};`);
  if (style.fontSizePt) declarations.push(`font-size: ${style.fontSizePt}pt;`);
  if (style.fontWeight) declarations.push(`font-weight: ${style.fontWeight};`);
  if (style.fontStyle) declarations.push(`font-style: ${style.fontStyle};`);
  if (style.align) declarations.push(`text-align: ${style.align};`);
  if (style.lineHeight) declarations.push(`line-height: ${style.lineHeight};`);
  if (style.color) declarations.push(`color: ${style.color};`);
  if (style.textTransform) declarations.push(`text-transform: ${style.textTransform};`);
  if (style.marginTopPt) declarations.push(`margin-top: ${style.marginTopPt}pt;`);
  if (style.marginBottomPt) declarations.push(`margin-bottom: ${style.marginBottomPt}pt;`);
  if (declarations.length === 0) return "";
  return `    ${tag} { ${declarations.join(" ")} }`;
}

function slotsHtml(slots: PageHeaderFooter, className: string): string {
  const values = [slots.left, slots.center, slots.right];
  if (values.every((value) => !value)) return "";
  return `<div class="${className}">${values
    .map((value) => `<span>${escapeHtml(value ?? "")}</span>`)
    .join("")}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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

/** Page nodes are an editor view wrapper. Export adapters use page breaks. */
function flattenPageSheetsForExport(html: string): string {
  if (!html.includes("data-page-sheet")) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const sheets = Array.from(doc.querySelectorAll("[data-page-sheet]"));
  sheets.forEach((sheet, index) => {
    if (index > 0) {
      const breakNode = doc.createElement("div");
      breakNode.setAttribute("data-page-break", "true");
      sheet.parentNode?.insertBefore(breakNode, sheet);
    }
    while (sheet.firstChild) {
      sheet.parentNode?.insertBefore(sheet.firstChild, sheet);
    }
    sheet.remove();
  });
  return doc.body.innerHTML;
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
  alignment?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
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

  // Inline styles are authoritative for editor-generated HTML. Detached
  // DOMParser elements often have no useful computed style, and alignment /
  // font size are written as inline styles by TipTap.
  const inlineStyle = el.getAttribute("style") ?? "";
  if (inlineStyle) {
    const align = inlineStyle.match(
      /text-align:\s*(left|center|right|justify)/i,
    )?.[1];
    if (align) result.alignment = align.toLowerCase() as NonNullable<typeof result.alignment>;

    const lineHeight = inlineStyle.match(/line-height:\s*([\d.]+)/i)?.[1];
    if (lineHeight) result.lineHeight = parseFloat(lineHeight);

    const fontSizePt = inlineStyle.match(/font-size:\s*([\d.]+)pt/i)?.[1];
    if (fontSizePt) result.fontSize = Math.round(parseFloat(fontSizePt) * 2);

    const fontSizePx = inlineStyle.match(/font-size:\s*([\d.]+)px/i)?.[1];
    if (!fontSizePt && fontSizePx) {
      result.fontSize = Math.round(parseFloat(fontSizePx) * 1.5);
    }

    const inlineFamily = inlineStyle.match(/font-family:\s*([^;]+)/i)?.[1];
    if (inlineFamily) {
      result.fontFamily = inlineFamily
        .split(",")[0]
        .trim()
        .replace(/["']/g, "");
    }

    const inlineColor = inlineStyle.match(
      /(?:^|;)\s*color:\s*#([0-9a-f]{3,6})/i,
    )?.[1];
    if (inlineColor) result.color = inlineColor;

    if (/font-weight:\s*(bold|[6-9]00)/i.test(inlineStyle)) {
      result.bold = true;
    }
    if (/font-style:\s*italic/i.test(inlineStyle)) {
      result.italic = true;
    }
  }

  return result;
}

const DOCX_ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

function docxAlignment(value: "left" | "center" | "right" | "justify" | undefined) {
  return value ? DOCX_ALIGNMENTS[value] : undefined;
}

/**
 * Parse HTML to DOCX Paragraph array, preserving structure, styles, and embedded images.
 * Handles heading levels, text formatting, colors, fonts, spacing, and base64 images.
 */
async function htmlToDocxParagraphs(html: string, layout?: PageLayout): Promise<Paragraph[]> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const paragraphs: Paragraph[] = [];
  const baseStyle: ReturnType<typeof parseElementStyle> | undefined = layout
    ? {
        fontFamily: layout.fontFamily,
        fontSize: Math.round(layout.fontSizePt * 2),
      }
    : undefined;
  const paragraphStyle = layout?.styles?.paragraph;

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

    // ── Page breaks ──
    if (
      (tagName === "div" || tagName === "hr") &&
      el.hasAttribute("data-page-break")
    ) {
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
      return null;
    }

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
      const blockStyle =
        level === 1
          ? layout?.styles?.h1
          : level === 2
            ? layout?.styles?.h2
            : level === 3
              ? layout?.styles?.h3
              : layout?.styles?.h4;

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
          alignment: docxAlignment(style.alignment ?? blockStyle?.align),
          children: [
            new TextRun({
              text,
              bold: blockStyle?.fontWeight ? blockStyle.fontWeight >= 700 : true,
              size: blockStyle?.fontSizePt
                ? Math.round(blockStyle.fontSizePt * 2)
                : headingSizes[level],
              font: blockStyle?.fontFamily,
              color: blockStyle?.color,
              allCaps: blockStyle?.textTransform === "uppercase",
            }),
          ],
          spacing: {
            before: 200,
            after: 200,
            line: Math.round(
              (style.lineHeight ?? blockStyle?.lineHeight ?? 1.5) * 240,
            ),
          },
        })
      );
      return null;
    }

    // ── Paragraphs ──
    if (tagName === "p" || tagName === "div") {
      const children: (TextRun | ImageRun)[] = [];
      const effectiveStyle = {
        ...style,
        ...(paragraphStyle?.fontFamily
          ? { fontFamily: paragraphStyle.fontFamily }
          : {}),
        ...(paragraphStyle?.fontSizePt
          ? { fontSize: Math.round(paragraphStyle.fontSizePt * 2) }
          : {}),
        ...(paragraphStyle?.color ? { color: paragraphStyle.color } : {}),
      };
      for (const child of el.childNodes) {
        try {
          const result = await procesNode(child, effectiveStyle);
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
            alignment: docxAlignment(
              style.alignment ?? paragraphStyle?.align,
            ),
            spacing: {
              before: style.marginTop ?? 100,
              after: style.marginBottom ?? 100,
              line: Math.round(
                (style.lineHeight ?? paragraphStyle?.lineHeight ?? 1.5) * 240,
              ),
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
    const result = await procesNode(child, baseStyle);
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
export async function exportAsHtml(
  html: string,
  title: string,
  layout?: PageLayout,
  filename?: string,
) {
  const derived = title
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const name = filename ?? (derived || "untitled");
  const exportHtml = await inlineEncryptedImagesForExport(
    flattenPageSheetsForExport(html),
  );
  const fullHtml = styledHtmlDocument(exportHtml, title, layout);
  const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, `${name}.html`);
}

/**
 * Export as PDF — opens the browser's native Print → Save as PDF dialog.
 * Zero dependencies. Generates flawless vector text and uses native print engine.
 */
export async function exportAsPdf(
  html: string,
  title: string,
  layout?: PageLayout,
) {
  const exportHtml = await inlineEncryptedImagesForExport(
    flattenPageSheetsForExport(html),
  );
  const fullHtml = styledHtmlDocument(exportHtml, title, layout);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  printWindow.document.write(fullHtml);
  printWindow.document.close();

  await waitForImagesInWindow(printWindow);

  // Trigger print after content and images are ready.
  printWindow.addEventListener("afterprint", () => printWindow.close());
  printWindow.print();
}

function docxHeaderFooterParagraph(
  slots: PageHeaderFooter | undefined,
): Paragraph | null {
  if (!slots) return null;
  const text = [slots.left, slots.center, slots.right]
    .filter((value): value is string => !!value)
    .join("    ");
  if (!text) return null;
  return new Paragraph({
    children: [new TextRun({ text, size: 18, color: "666666" })],
    spacing: { after: 0 },
  });
}

/**
 * Export as Word DOCX (.docx) using proper OOXML format with inlined attachments.
 * Generates valid Office Open XML archive with embedded base64 images.
 */
export async function exportAsDocx(
  html: string,
  title: string,
  layoutInput?: PageLayout,
  filename?: string,
) {
  const derived = title
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const name = filename ?? (derived || "untitled");
  const layout = normalizePageLayout(layoutInput ?? DEFAULT_PAGE_LAYOUT);
  // docx swaps width/height itself when orientation is landscape, so always
  // give it the portrait (base) dimensions plus the orientation flag.
  const dimensions = getPageDimensions({ ...layout, orientation: "portrait" });
  const { margins } = layout;

  try {
    // Pass the raw editor HTML directly to htmlToDocxParagraphs.
    // Unlike HTML/PDF export, we do NOT run inlineEncryptedImagesForExport here
    // because the DOMParser + Promise.all + outerHTML mutation pattern can lose
    // sibling images when multiple <encrypted-file> tags share the same parent.
    // htmlToDocxParagraphs handles <encrypted-file> tags natively by fetching,
    // decrypting, and creating ImageRun objects from the raw binary data.
    const paragraphs = await htmlToDocxParagraphs(
      flattenPageSheetsForExport(html),
      layout,
    );

    const headerParagraph = docxHeaderFooterParagraph(layout.header);
    const footerParagraph = docxHeaderFooterParagraph(layout.footer);

    // Create and pack OOXML document
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: {
                width: convertInchesToTwip(dimensions.widthIn),
                height: convertInchesToTwip(dimensions.heightIn),
                orientation:
                  layout.orientation === "landscape"
                    ? PageOrientation.LANDSCAPE
                    : PageOrientation.PORTRAIT,
              },
              margin: {
                top: convertInchesToTwip(margins.top),
                right: convertInchesToTwip(margins.right),
                bottom: convertInchesToTwip(margins.bottom),
                left: convertInchesToTwip(margins.left),
                header: convertInchesToTwip(0.3),
                footer: convertInchesToTwip(0.3),
              },
            },
          },
          headers: headerParagraph
            ? { default: new Header({ children: [headerParagraph] }) }
            : undefined,
          footers: footerParagraph
            ? { default: new Footer({ children: [footerParagraph] }) }
            : undefined,
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
