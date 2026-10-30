/**
 * tests/driveImport/previewComponents.test.ts
 * Unit tests for Milestone 4 Standalone Preview & Import Route UI components:
 * - ImportLoadingState
 * - BinaryDownloadView
 * - MediaPreviewModal
 * - DriveImportPage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { ImportLoadingState } from "../../src/features/driveImport/components/ImportLoadingState";
import { BinaryDownloadView } from "../../src/features/driveImport/components/BinaryDownloadView";
import { MediaPreviewModal } from "../../src/features/driveImport/components/MediaPreviewModal";
import type { DecryptedDriveFile } from "../../src/features/driveImport/types";

describe("Milestone 4: Standalone Preview & UI Components", () => {
  const mockMarkdownFile: DecryptedDriveFile = {
    data: new TextEncoder().encode("# Hello Formstr Docs"),
    name: "meeting-notes.md",
    mimeType: "text/markdown",
    size: 20,
    originalPayload: {
      server: "https://blossom.example.com",
      privateKeyHex: "01".repeat(32),
      cipher: "nip-fs-segment-v1",
      name: "meeting-notes.md",
      mimeType: "text/markdown",
      size: 20,
      chunkSize: 65536,
    },
  };

  const mockImageFile: DecryptedDriveFile = {
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    name: "screenshot.png",
    mimeType: "image/png",
    size: 4,
    originalPayload: {
      server: "https://blossom.example.com",
      privateKeyHex: "01".repeat(32),
      cipher: "nip-fs-segment-v1",
      name: "screenshot.png",
      mimeType: "image/png",
      size: 4,
      chunkSize: 65536,
    },
  };

  const mockVideoFile: DecryptedDriveFile = {
    data: new Uint8Array([0, 0, 0, 0]),
    name: "demo.mp4",
    mimeType: "video/mp4",
    size: 1048576, // 1 MB
    originalPayload: {
      server: "https://blossom.example.com",
      privateKeyHex: "01".repeat(32),
      cipher: "nip-fs-segment-v1",
      name: "demo.mp4",
      mimeType: "video/mp4",
      size: 1048576,
      chunkSize: 65536,
    },
  };

  const mockAudioFile: DecryptedDriveFile = {
    data: new Uint8Array([0, 0, 0, 0]),
    name: "podcast.mp3",
    mimeType: "audio/mpeg",
    size: 512000,
    originalPayload: {
      server: "https://blossom.example.com",
      privateKeyHex: "01".repeat(32),
      cipher: "nip-fs-segment-v1",
      name: "podcast.mp3",
      mimeType: "audio/mpeg",
      size: 512000,
      chunkSize: 65536,
    },
  };

  const mockPdfFile: DecryptedDriveFile = {
    data: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
    name: "whitepaper.pdf",
    mimeType: "application/pdf",
    size: 2048,
    originalPayload: {
      server: "https://blossom.example.com",
      privateKeyHex: "01".repeat(32),
      cipher: "nip-fs-segment-v1",
      name: "whitepaper.pdf",
      mimeType: "application/pdf",
      size: 2048,
      chunkSize: 65536,
    },
  };

  const mockBinaryFile: DecryptedDriveFile = {
    data: new Uint8Array([1, 2, 3, 4, 5]),
    name: "firmware.bin",
    mimeType: "application/octet-stream",
    size: 5,
    originalPayload: {
      server: "https://blossom.example.com",
      privateKeyHex: "01".repeat(32),
      cipher: "nip-fs-segment-v1",
      name: "firmware.bin",
      mimeType: "application/octet-stream",
      size: 5,
      chunkSize: 65536,
    },
  };

  // =========================================================================
  // GROUP 1: ImportLoadingState Tests
  // =========================================================================
  describe("1. ImportLoadingState Component", () => {
    it("1.1 renders downloading stage label and file metadata", () => {
      const html = renderToString(
        React.createElement(ImportLoadingState, {
          progress: {
            stage: "fetching",
            chunksCompleted: 0,
            totalChunks: 1,
            bytesReceived: 512,
            totalBytes: 1024,
          },
          fileName: "document.pdf",
          totalSize: 1024,
        }),
      );

      expect(html).toContain("Downloading");
      expect(html).toContain("document.pdf");
      expect(html).toContain("50%");
      expect(html).toContain("1.0 KB");
    });

    it("1.2 renders decrypting stage label", () => {
      const html = renderToString(
        React.createElement(ImportLoadingState, {
          progress: {
            stage: "decrypting",
            chunksCompleted: 1,
            totalChunks: 1,
            bytesReceived: 1024,
            totalBytes: 1024,
          },
        }),
      );

      expect(html).toContain("Decrypting");
      expect(html).toContain("100%");
    });
  });

  // =========================================================================
  // GROUP 2: BinaryDownloadView Tests
  // =========================================================================
  describe("2. BinaryDownloadView Component", () => {
    it("2.1 renders file name, human-readable size, and download button", () => {
      const html = renderToString(
        React.createElement(BinaryDownloadView, {
          file: mockBinaryFile,
          onBackToDocs: vi.fn(),
        }),
      );

      expect(html).toContain("firmware.bin");
      expect(html).toContain("5.0 B");
      expect(html).toContain("application/octet-stream");
      expect(html).toContain("Download File");
      expect(html).toContain("Back to docs");
    });
  });

  // =========================================================================
  // GROUP 3: MediaPreviewModal Tests
  // =========================================================================
  describe("3. MediaPreviewModal Component", () => {
    // Stub URL.createObjectURL and URL.revokeObjectURL for Node environment
    beforeEach(() => {
      if (typeof URL.createObjectURL === "undefined") {
        URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/test-blob");
        URL.revokeObjectURL = vi.fn();
      }
    });

    it("3.1 renders responsive image viewer for image files", () => {
      const html = renderToString(
        React.createElement(MediaPreviewModal, {
          file: mockImageFile,
          onBackToDocs: vi.fn(),
        }),
      );

      expect(html).toContain("screenshot.png");
      expect(html).toContain("<img");
      expect(html).toContain('alt="screenshot.png"');
      expect(html).toContain("Download");
    });

    it("3.2 renders responsive video player for video files", () => {
      const html = renderToString(
        React.createElement(MediaPreviewModal, {
          file: mockVideoFile,
          onBackToDocs: vi.fn(),
        }),
      );

      expect(html).toContain("demo.mp4");
      expect(html).toContain("<video");
      expect(html).toContain("1.0 MB");
      expect(html).toContain("Your browser does not support this video format");
    });

    it("3.3 renders audio player for audio files", () => {
      const html = renderToString(
        React.createElement(MediaPreviewModal, {
          file: mockAudioFile,
          onBackToDocs: vi.fn(),
        }),
      );

      expect(html).toContain("podcast.mp3");
      expect(html).toContain("<audio");
      expect(html).toContain("500.0 KB");
    });

    it("3.4 renders iframe viewer for PDF documents", () => {
      const html = renderToString(
        React.createElement(MediaPreviewModal, {
          file: mockPdfFile,
          onBackToDocs: vi.fn(),
        }),
      );

      expect(html).toContain("whitepaper.pdf");
      expect(html).toContain("<iframe");
      expect(html).toContain('title="whitepaper.pdf"');
    });
  });
});
