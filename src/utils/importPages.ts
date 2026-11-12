// src/utils/importPages.ts
//
// Read pages to import from user-selected files. Accepts plain Markdown files,
// .docx documents (converted to the rich model) and .zip archives containing
// Markdown — so a backup produced by the "Backup pages" feature can be
// re-imported directly. Nothing here touches Nostr; it only turns Files into
// importable entries.

import JSZip from "jszip";
import type { JSONContent } from "@tiptap/core";
import type { PageLayout } from "../lib/docLayout";
import { docxToRichDocument } from "../lib/docxToDocument";

export type ImportEntry = {
  /** Stable, unique key for React lists. */
  id: string;
  /** Display name (file name without its extension). */
  name: string;
  /** Raw Markdown for Markdown entries (empty for DOCX). */
  markdown: string;
  /** Canonical rich document for DOCX entries. */
  doc?: JSONContent;
  /** Page setup parsed from the DOCX. */
  layout?: PageLayout;
  /** Original DOCX package, retained for export. */
  package?: string;
  kind: "markdown" | "docx";
  /** DOCX import warnings (unsupported features, etc.). */
  warnings?: string[];
  /** Original file or archive entry path, for display. */
  source: string;
};

export type ImportReadResult = {
  entries: ImportEntry[];
  /** Names of files that were not Markdown/DOCX or could not be read. */
  skipped: string[];
};

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;
const DOCX_EXT = /\.docx$/i;

function basename(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "") || base;
}

function isIgnoredPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return path.startsWith("__MACOSX/") || base.startsWith(".");
}

function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === "application/zip";
}

function isDocx(file: File): boolean {
  return (
    DOCX_EXT.test(file.name) ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

/**
 * Expand the given files into importable Markdown entries. Zip archives are
 * unpacked and every non-hidden Markdown entry is read; a zip with no Markdown
 * is reported as skipped. Reads are best-effort — an unreadable file never
 * rejects the whole batch.
 */
export async function readImportFiles(files: File[]): Promise<ImportReadResult> {
  const entries: ImportEntry[] = [];
  const skipped: string[] = [];
  let counter = 0;

  const push = (source: string, markdown: string) => {
    entries.push({
      id: `import-${counter++}`,
      name: basename(source),
      markdown,
      kind: "markdown",
      source,
    });
  };

  for (const file of files) {
    if (isDocx(file)) {
      try {
        const result = await docxToRichDocument(await file.arrayBuffer());
        entries.push({
          id: `import-${counter++}`,
          name: basename(file.name),
          markdown: "",
          doc: result.doc,
          layout: result.layout,
          package: result.packageBase64,
          kind: "docx",
          warnings: result.messages,
          source: file.name,
        });
      } catch (err) {
        console.warn("Failed to read DOCX for import:", file.name, err);
        skipped.push(file.name);
      }
    } else if (isZip(file)) {
      try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const paths = Object.keys(zip.files)
          .filter(
            (p) =>
              !zip.files[p].dir && !isIgnoredPath(p) && MARKDOWN_EXT.test(p),
          )
          .sort();
        for (const p of paths) {
          push(p, await zip.files[p].async("string"));
        }
        if (paths.length === 0) skipped.push(file.name);
      } catch (err) {
        console.warn("Failed to read zip for import:", file.name, err);
        skipped.push(file.name);
      }
    } else if (MARKDOWN_EXT.test(file.name) || file.type.startsWith("text/")) {
      try {
        push(file.name, await file.text());
      } catch (err) {
        console.warn("Failed to read file for import:", file.name, err);
        skipped.push(file.name);
      }
    } else {
      skipped.push(file.name);
    }
  }

  return { entries, skipped };
}
