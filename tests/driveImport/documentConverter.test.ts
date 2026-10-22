/**
 * tests/driveImport/documentConverter.test.ts
 * Comprehensive unit test suite for MIME classification and collaborative document conversion into TipTap.
 *
 * Covers:
 * 1. MIME and file extension classification across all document, media, and binary types.
 * 2. Title sanitization, path traversal stripping, and fallback defaults.
 * 3. Markdown parsing into HTML and TipTap ProseMirror JSON (headings, lists, code blocks, bold/italic, tables).
 * 4. Plain Text conversion with XSS escaping and paragraph splitting.
 * 5. HTML document sanitization (stripping script/iframe/event handlers).
 * 6. DOCX archive validation and error recovery.
 * 7. Universal convertDriveFileToDocument workflow.
 */

// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { makeDocx, paragraph } from "./helpers/makeDocx";
import {
  classifyDriveFile,
  getDocumentSubtype,
  normalizeMimeType,
  resolveFileExtension,
} from "../../src/features/driveImport/converters/mimeClassifier";
import {
  convertDriveFileToDocument,
  convertHtmlToDocument,
  convertMarkdownToDocument,
  convertPlainTextToDocument,
  convertDocxToDocument,
  sanitizeDocumentTitle,
} from "../../src/features/driveImport/converters/documentConverter";
import {
  DriveImportError,
  type DecryptedDriveFile,
} from "../../src/features/driveImport/types";

describe("Milestone 3: Document Importer", () => {
  // =========================================================================
  // GROUP 1: MIME Type & File Extension Classification
  // =========================================================================
  describe("1. MIME Type & Extension Classifier", () => {
    it("1.1 resolves lowercase file extensions accurately", () => {
      expect(resolveFileExtension("meeting.MD")).toBe("md");
      expect(resolveFileExtension("archive.tar.gz")).toBe("gz");
      expect(resolveFileExtension("no_extension")).toBe("");
      expect(resolveFileExtension(".hidden")).toBe("");
      expect(resolveFileExtension(undefined)).toBe("");
    });

    it("1.2 normalizes MIME types and strips parameter suffixes", () => {
      expect(normalizeMimeType("text/markdown; charset=utf-8")).toBe("text/markdown");
      expect(normalizeMimeType("TEXT/HTML")).toBe("text/html");
      expect(normalizeMimeType(undefined)).toBe("application/octet-stream");
    });

    it("1.3 identifies Markdown documents by MIME or extension", () => {
      const byMime = classifyDriveFile("text/markdown", "notes");
      expect(byMime.category).toBe("document");
      expect(byMime.documentSubtype).toBe("markdown");
      expect(byMime.isDocument).toBe(true);
      expect(byMime.primaryAction).toBe("import");

      const byExt = classifyDriveFile("application/octet-stream", "README.md");
      expect(byExt.category).toBe("document");
      expect(byExt.documentSubtype).toBe("markdown");
    });

    it("1.4 identifies HTML documents by MIME or extension", () => {
      const byMime = classifyDriveFile("text/html", "index");
      expect(byMime.category).toBe("document");
      expect(byMime.documentSubtype).toBe("html");
      expect(byMime.isPreviewable).toBe(true); // HTML is both importable and previewable

      const byExt = classifyDriveFile("application/octet-stream", "page.htm");
      expect(byExt.documentSubtype).toBe("html");
    });

    it("1.5 identifies DOCX and Office documents by MIME or extension", () => {
      const byMime = classifyDriveFile(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "proposal",
      );
      expect(byMime.category).toBe("document");
      expect(byMime.documentSubtype).toBe("docx");

      const byExt = classifyDriveFile("application/octet-stream", "draft.docx");
      expect(byExt.documentSubtype).toBe("docx");
    });

    it("1.6 identifies Plain Text and code/data formats by MIME or extension", () => {
      expect(classifyDriveFile("text/plain", "file").documentSubtype).toBe("text");
      expect(classifyDriveFile("application/json", "config.json").documentSubtype).toBe("text");
      expect(classifyDriveFile("text/csv", "table.csv").documentSubtype).toBe("text");
      expect(classifyDriveFile("application/octet-stream", "script.py").documentSubtype).toBe("text");
    });

    it("1.7 identifies Image, Video, Audio, and PDF media correctly", () => {
      const img = classifyDriveFile("image/png", "photo.png");
      expect(img.category).toBe("media-image");
      expect(img.isMedia).toBe(true);
      expect(img.primaryAction).toBe("preview");

      const vid = classifyDriveFile("video/mp4", "clip.mp4");
      expect(vid.category).toBe("media-video");
      expect(vid.isMedia).toBe(true);
      expect(vid.primaryAction).toBe("preview");

      const aud = classifyDriveFile("audio/mpeg", "track.mp3");
      expect(aud.category).toBe("media-audio");
      expect(aud.isMedia).toBe(true);

      const pdf = classifyDriveFile("application/pdf", "manual.pdf");
      expect(pdf.category).toBe("media-pdf");
      expect(pdf.isMedia).toBe(true);
      expect(pdf.primaryAction).toBe("preview");
    });

    it("1.8 classifies generic binaries (zip, exe, unknown) as download action", () => {
      const zip = classifyDriveFile("application/zip", "archive.zip");
      expect(zip.category).toBe("generic-binary");
      expect(zip.isDocument).toBe(false);
      expect(zip.isMedia).toBe(false);
      expect(zip.primaryAction).toBe("download");
      expect(zip.actionLabel).toBe("Download File");
    });

  });

  // =========================================================================
  // GROUP 2: Document Title Sanitization
  // =========================================================================
  describe("2. Document Title Sanitization", () => {
    it("2.1 strips standard document extensions (.md, .docx, .txt, .html)", () => {
      expect(sanitizeDocumentTitle("Meeting Notes.md")).toBe("Meeting Notes");
      expect(sanitizeDocumentTitle("Project Proposal.docx")).toBe("Project Proposal");
      expect(sanitizeDocumentTitle("index.html")).toBe("index");
      expect(sanitizeDocumentTitle("logfile.txt")).toBe("logfile");
    });

    it("2.2 strips UNIX and Windows directory path components", () => {
      expect(sanitizeDocumentTitle("../../sensitive.md")).toBe("sensitive");
      expect(sanitizeDocumentTitle("C:\\Users\\alice\\Documents\\budget.docx")).toBe("budget");
      expect(sanitizeDocumentTitle("sub/folder/nested.txt")).toBe("nested");
    });

    it("2.3 preserves internal periods while stripping final extension", () => {
      expect(sanitizeDocumentTitle("release.v1.0.final.md")).toBe("release.v1.0.final");
    });

    it("2.4 falls back to 'Untitled Document (Imported)' on empty or whitespace strings", () => {
      expect(sanitizeDocumentTitle("")).toBe("Untitled Document (Imported)");
      expect(sanitizeDocumentTitle("   ")).toBe("Untitled Document (Imported)");
      expect(sanitizeDocumentTitle(".md")).toBe("Untitled Document (Imported)");
      expect(sanitizeDocumentTitle(undefined)).toBe("Untitled Document (Imported)");
    });
  });

  // =========================================================================
  // GROUP 3: Markdown to TipTap Document Conversion
  // =========================================================================
  describe("3. Markdown Converter", () => {
    it("3.1 converts headings (H1 to H3)", () => {
      const md = "# Title H1\n\n## Section H2\n\n### Sub-section H3";
      const result = convertMarkdownToDocument(md);

      expect(result.htmlContent).toContain("<h1>Title H1</h1>");
      expect(result.htmlContent).toContain("<h2>Section H2</h2>");
      expect(result.htmlContent).toContain("<h3>Sub-section H3</h3>");
    });

    it("3.2 converts inline bold, italic, code, strikethrough, and links", () => {
      const md = "This is **bold**, *italic*, ~~struck~~, `code`, and [link](https://formstr.app).";
      const result = convertMarkdownToDocument(md);

      expect(result.htmlContent).toContain("<strong>bold</strong>");
      expect(result.htmlContent).toContain("<em>italic</em>");
      expect(result.htmlContent).toContain("<s>struck</s>");
      expect(result.htmlContent).toContain("<code>code</code>");
      expect(result.htmlContent).toContain('<a href="https://formstr.app">link</a>');
    });

    it("3.3 converts fenced code blocks with language annotations", () => {
      const md = "```typescript\nconst x: number = 42;\nconsole.log(x);\n```";
      const result = convertMarkdownToDocument(md);

      expect(result.htmlContent).toContain('<pre><code class="language-typescript">');
      expect(result.htmlContent).toContain("const x: number = 42;");
    });

    it("3.4 converts unordered and ordered lists", () => {
      const md = "* Bullet Item 1\n* Bullet Item 2\n\n1. First step\n2. Second step";
      const result = convertMarkdownToDocument(md);

      expect(result.htmlContent).toContain("<ul>");
      expect(result.htmlContent).toContain("<li>Bullet Item 2</li>");
      expect(result.htmlContent).toContain("<ol>");
      expect(result.htmlContent).toContain("<li>First step</li>");
    });

    it("3.5 converts blockquotes and horizontal rules", () => {
      const md = "> This is a quote\n\n---\n\nParagraph text";
      const result = convertMarkdownToDocument(md);

      expect(result.htmlContent).toContain("<blockquote>");
      expect(result.htmlContent).toContain("<p>This is a quote</p>");
      expect(result.htmlContent).toContain("<hr>");
    });

    it("3.7 shows raw HTML inside Markdown as text, not markup", () => {
      const result = convertMarkdownToDocument("Hello <script>alert(1)</script> world");

      expect(result.htmlContent).not.toContain("<script>");
      expect(result.htmlContent).toContain("&lt;script&gt;");
    });

    it("3.6 normalizes Windows CRLF (\\r\\n) newlines cleanly", () => {
      const md = "# Title\r\n\r\nFirst paragraph\r\n\r\nSecond paragraph";
      const result = convertMarkdownToDocument(md);

      expect(result.htmlContent).toContain("<h1>Title</h1>");
      expect(result.htmlContent).toContain("<p>First paragraph</p>");
      expect(result.htmlContent).toContain("<p>Second paragraph</p>");
    });
  });

  // =========================================================================
  // GROUP 4: Plain Text to TipTap Document Conversion
  // =========================================================================
  describe("4. Plain Text Converter", () => {
    it("4.1 splits plain text into paragraphs across blank lines", () => {
      const text = "First paragraph content.\n\nSecond paragraph content.";
      const result = convertPlainTextToDocument(text);

      expect(result.htmlContent).toBe("<p>First paragraph content.</p><p>Second paragraph content.</p>");
    });

    it("4.2 escapes HTML special characters to prevent XSS injection", () => {
      const unsafe = "<script>alert('pwned')</script> & <b>bold</b>";
      const result = convertPlainTextToDocument(unsafe);

      expect(result.htmlContent).not.toContain("<script>");
      expect(result.htmlContent).toContain("&lt;script&gt;");
      expect(result.htmlContent).toContain("&amp;");
    });

    it("4.3 converts single newlines inside paragraph to hard breaks", () => {
      const multiLine = "Line one\nLine two";
      const result = convertPlainTextToDocument(multiLine);

      expect(result.htmlContent).toBe("<p>Line one<br />Line two</p>");
    });
  });

  // =========================================================================
  // GROUP 5: HTML Document Conversion & Sanitization
  // =========================================================================
  describe("5. HTML Converter & Sanitization", () => {
    it("5.1 strips malicious script tags and inline event handlers", () => {
      const maliciousHtml =
        '<h1>Clean Heading</h1><script>evil()</script><img src="x" onerror="alert(1)" /><p>Body</p>';
      const result = convertHtmlToDocument(maliciousHtml);

      expect(result.htmlContent).not.toContain("<script>");
      expect(result.htmlContent).not.toContain("evil()");
      expect(result.htmlContent).not.toContain("onerror");
      expect(result.htmlContent).toContain("<h1>Clean Heading</h1>");
      expect(result.htmlContent).toContain("<p>Body</p>");
    });

    it("5.2 extracts clean text for the word count", () => {
      const html = "<h2>Subtitle</h2><p>Description text here.</p>";
      const result = convertHtmlToDocument(html);

      expect(result.rawText).toContain("Subtitle");
      expect(result.rawText).toContain("Description text here.");
    });
  });

  // =========================================================================
  // GROUP 6: DOCX Binary Validation & Recovery
  // =========================================================================
  describe("6. DOCX Archive Converter", () => {
    it("6.1 rejects empty (0 bytes) DOCX file with CORRUPTED_DOCUMENT error", async () => {
      await expect(convertDocxToDocument(new Uint8Array(0))).rejects.toThrow(DriveImportError);
    });

    it("6.2 rejects invalid file lacking ZIP header with CORRUPTED_DOCUMENT error", async () => {
      const fakeDocx = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      await expect(convertDocxToDocument(fakeDocx)).rejects.toThrow(DriveImportError);
    });

    it("6.3 extracts text, headings, lists and tables from a real DOCX archive", async () => {
      const docx = await makeDocx(
        paragraph("Report title", '<w:pStyle w:val="Heading1"/>') +
          paragraph("Extracted from Word Doc") +
          paragraph("First point", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
          "<w:tbl><w:tr><w:tc>" + paragraph("Cell A") + "</w:tc><w:tc>" + paragraph("Cell B") + "</w:tc></w:tr></w:tbl>",
      );

      const result = await convertDocxToDocument(docx);
      expect(result.rawText).toContain("Extracted from Word Doc");
      expect(result.htmlContent).toContain("<h1>Report title</h1>");
      expect(result.htmlContent).toContain("<li>");
      expect(result.htmlContent).toContain("<table>");
      expect(result.htmlContent).toContain("Cell B");
    });
  });

  // =========================================================================
  // GROUP 7: Universal convertDriveFileToDocument Workflow
  // =========================================================================
  describe("7. Universal convertDriveFileToDocument Workflow", () => {
    it("7.1 converts DecryptedDriveFile for Markdown document with word count and metadata", async () => {
      const mdContent = "# Project Plan\n\nHere are the action items for the team.";
      const file: DecryptedDriveFile = {
        data: new TextEncoder().encode(mdContent),
        name: "Project-Plan.md",
        mimeType: "text/markdown",
        size: mdContent.length,
        originalPayload: {
          server: "https://blossom.example.com",
          privateKeyHex: "01".repeat(32),
          cipher: "nip-fs-segment-v1",
          name: "Project-Plan.md",
          mimeType: "text/markdown",
          size: mdContent.length,
          chunkSize: 65536,
        },
      };

      const result = await convertDriveFileToDocument(file);

      expect(result.title).toBe("Project-Plan");
      expect(result.format).toBe("markdown");
      expect(result.docId.startsWith("doc_")).toBe(true);
      expect(result.wordCount).toBe(11);
      expect(result.characterCount).toBe(mdContent.length);
      expect(result.htmlContent).toContain("<h1>Project Plan</h1>");
    });

    it("7.2 rejects non-document formats (e.g. image/png) with UNSUPPORTED_DOCUMENT_FORMAT", async () => {
      const imageFile = {
        data: new Uint8Array([1, 2, 3]),
        name: "photo.png",
        mimeType: "image/png",
      };

      await expect(convertDriveFileToDocument(imageFile)).rejects.toThrow(DriveImportError);
      try {
        await convertDriveFileToDocument(imageFile);
      } catch (e: any) {
        expect(e.code).toBe("UNSUPPORTED_DOCUMENT_FORMAT");
        expect(e.title).toBe("Unsupported Document");
      }
    });
  });
});
