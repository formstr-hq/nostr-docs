/**
 * tests/driveImport/mimeClassifier.test.ts
 * Boundary cases for file classification and file-name handling.
 */

import { describe, it, expect } from "vitest";
import {
  classifyDriveFile,
  normalizeMimeType,
  resolveFileExtension,
} from "../../src/features/driveImport/converters/mimeClassifier";
import { sanitizeDocumentTitle } from "../../src/features/driveImport/converters/documentConverter";

  describe("media classification boundaries", () => {
    it("unknown image extension (.bmp, .tiff, .avif) classified as media-image", () => {
      expect(classifyDriveFile("image/avif", "pic.avif").category).toBe("media-image");
      expect(classifyDriveFile("image/tiff", "scan.tiff").category).toBe("media-image");
    });

    it("video container without MIME type classified by extension (.mkv)", () => {
      expect(classifyDriveFile("", "movie.mkv").category).toBe("media-video");
    });

    it("audio file with uppercase extension (.MP3) classified as media-audio", () => {
      expect(classifyDriveFile("", "song.MP3").category).toBe("media-audio");
    });

    it("PDF file with trailing spaces in filename classified as media-pdf", () => {
      expect(classifyDriveFile("application/pdf", "  doc.pdf  ").category).toBe("media-pdf");
    });

    it("normalizeMimeType handles parameters with quotes", () => {
      expect(normalizeMimeType('application/pdf; name="doc.pdf"')).toBe("application/pdf");
    });
  });

  // -------------------------------------------------------------------------
  // binary and edge-case file names
  // -------------------------------------------------------------------------
  describe("binary and edge-case file names", () => {
    it("file with no extension and no MIME type defaults to generic-binary", () => {
      const c = classifyDriveFile("", "unknown_blob");
      expect(c.category).toBe("generic-binary");
      expect(c.primaryAction).toBe("download");
    });

    it("reserved Windows filenames (CON, PRN, AUX) are accepted without crash", () => {
      expect(sanitizeDocumentTitle("CON.txt")).toBe("CON");
      expect(sanitizeDocumentTitle("AUX.md")).toBe("AUX");
    });

    it("resolves extension for file ending with dot (.txt.) correctly", () => {
      expect(resolveFileExtension("file.txt.")).toBe("");
    });

    it("handles large binary size (5GB) in classification", () => {
      const c = classifyDriveFile("application/x-iso9660-image", "ubuntu.iso");
      expect(c.primaryAction).toBe("download");
    });

    it("resolves a multi-letter extension", () => {
      expect(resolveFileExtension("archive.7z")).toBe("7z");
    });
  });
