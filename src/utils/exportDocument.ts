// src/utils/exportDocument.ts

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
 * Export as HTML (.html) — styled standalone web page.
 */
export function exportAsHtml(html: string, title: string, filename?: string) {
  const derived = title
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const name = filename ?? (derived || "untitled");
  const fullHtml = styledHtmlDocument(html, title);
  const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, `${name}.html`);
}

/**
 * Export as PDF — opens the browser's native Print → Save as PDF dialog.
 * Zero dependencies. Generates flawless vector text and uses native print engine.
 */
export function exportAsPdf(html: string, title: string) {
  const fullHtml = styledHtmlDocument(html, title);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(fullHtml);
  printWindow.document.close();
  // Wait for content to render, then trigger print
  printWindow.addEventListener("afterprint", () => printWindow.close());
  setTimeout(() => printWindow.print(), 300);
}

/**
 * Export as Word DOC (.doc) using HTML + Office namespaces.
 * Word / Google Docs / LibreOffice can open it natively. Zero dependencies.
 */
export function exportAsDoc(html: string, title: string, filename?: string) {
  const derived = title
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  const name = filename ?? (derived || "untitled");

  // Word-compatible HTML with Office namespace declarations
  const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    body {
      font-family: Calibri, "Segoe UI", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
    }
    h1 { font-size: 20pt; font-weight: 700; }
    h2 { font-size: 16pt; font-weight: 700; }
    h3 { font-size: 13pt; font-weight: 700; }
    pre, code { font-family: Consolas, "Courier New", monospace; font-size: 10pt; background: #f4f4f4; }
    pre { padding: 8pt; }
    blockquote { border-left: 3pt solid #ccc; padding-left: 8pt; color: #555; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #ccc; padding: 4pt 8pt; }
  </style>
</head>
<body>
${html}
</body>
</html>`;

  const blob = new Blob(["\ufeff" + docHtml], {
    type: "application/msword",
  });
  downloadBlob(blob, `${name}.doc`);
}
