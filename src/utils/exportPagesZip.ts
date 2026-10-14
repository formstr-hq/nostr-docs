// src/utils/exportPagesZip.ts
//
// Batch export: pack any number of pages into a single .zip of Markdown files.
// Complements the single-document exporters in exportDocument.ts, which handle
// HTML/PDF/DOCX; this one is the "backup everything" path and stays lossless —
// each page is written verbatim as its raw Markdown source.

import JSZip from "jszip";

export type ExportPageEntry = {
  /** Document address ("kind:pubkey:dtag") — used for logging/telemetry only. */
  address: string;
  /** Human-readable page title, used to derive the file name. */
  title: string;
  /** Raw Markdown source of the page's latest version. */
  markdown: string;
};

/**
 * Turn a page title into a safe, lowercase base filename (no extension).
 * Mirrors the conventions of `deriveFilename` in exportDocument.ts so a page
 * exported alone and the same page exported in a backup get the same name.
 */
export function pageSlug(title: string): string {
  const slug = title
    .replace(/^#+\s*/, "")
    .trim()
    .slice(0, 60)
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return slug || "untitled";
}

/**
 * Assign each entry a unique `<slug>.md` name. Duplicate titles (e.g. several
 * "Untitled" pages) get a numeric suffix: `untitled.md`, `untitled (2).md`, …
 */
export function assignFilenames(
  entries: ExportPageEntry[],
): { name: string; entry: ExportPageEntry }[] {
  const used = new Map<string, number>();
  return entries.map((entry) => {
    const base = pageSlug(entry.title || entry.markdown);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const name = count === 1 ? `${base}.md` : `${base} (${count}).md`;
    return { name, entry };
  });
}

/** Build a zip blob containing one .md file per entry. */
export async function buildPagesZip(entries: ExportPageEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const { name, entry } of assignFilenames(entries)) {
    zip.file(name, entry.markdown ?? "");
  }
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/**
 * Build and download a zip backup named `pages-backup-YYYY-MM-DD.zip`.
 * Returns the number of files written.
 */
export async function exportPagesAsZip(entries: ExportPageEntry[]): Promise<number> {
  const blob = await buildPagesZip(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pages-backup-${stamp}.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  return assignFilenames(entries).length;
}
