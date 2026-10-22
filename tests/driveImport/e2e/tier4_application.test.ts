/**
 * tests/driveImport/e2e/tier4_application.test.ts
 * Tier 4: Realistic End-to-End Application Scenarios (6 Scenarios).
 * Tests complete end-to-end user journeys defined in TEST_INFRA.md.
 */

import {
  createEphemeralSigner,
  encryptNip44LegacyBytes,
  encryptNipFsSegmentBlob,
} from "../helpers/driveFixtures";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "nostr-tools/utils";
import { parseDrivePayload } from "../../../src/features/driveImport/parsePayload";
import { fetchAndDecryptDriveFile } from "../../../src/features/driveImport/blossom/fetchBlob";
import { convertDriveFileToDocument } from "../../../src/features/driveImport/converters/documentConverter";
import { classifyDriveFile } from "../../../src/features/driveImport/converters/mimeClassifier";
import { DriveImportError, type NormalizedDrivePayload } from "../../../src/features/driveImport/types";

describe("Tier 4: Realistic End-to-End Application Scenarios (6 Tests)", () => {
  const TEST_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const TEST_SERVER = "https://blossom.primal.net";

  let signer: ReturnType<typeof createEphemeralSigner>;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    signer = createEphemeralSigner(TEST_KEY);
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  // Scenario 1: Formstr Drive exports Markdown meeting notes via hash payload -> Pages imports as editable document in TipTap
  it("Scenario 1: Formstr Drive exports Markdown meeting notes via hash payload -> TipTap Collaborative Document", async () => {
    const meetingNotes = `# Q4 Strategy Meeting
Date: 2026-10-15
Attendees: Alice, Bob, Charlie

## Action Items
* Ship Formstr Drive import feature
* Verify TipTap collaborative document sync
* Run full E2E test suite

> Note: All cryptographic keys must remain client-side only.`;

    const plain = new TextEncoder().encode(meetingNotes);
    const enc = await encryptNipFsSegmentBlob(plain, TEST_KEY, 65536);
    const blobHash = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const exportPayload = {
      server: TEST_SERVER,
      hash: blobHash,
      encryptionKey: TEST_KEY,
      type: "text/markdown",
      name: "Q4_Strategy_Meeting.md",
      size: plain.length,
    };
    const b64 = btoa(JSON.stringify(exportPayload));
    const importUrl = `https://pages.formstr.app/#payload=${encodeURIComponent(b64)}`;

    // 1. Ingestion
    const parsed = parseDrivePayload(importUrl);
    expect(parsed.server).toBe(TEST_SERVER);
    expect(parsed.blobHash).toBe(blobHash);
    expect(parsed.cipher).toBe("nip-fs-segment-v1");

    // 2. Fetch & Decrypt
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    expect(decrypted.name).toBe("Q4_Strategy_Meeting.md");
    expect(decrypted.size).toBe(plain.length);

    // 3. Document Import
    const docResult = await convertDriveFileToDocument(decrypted);
    expect(docResult.title).toBe("Q4_Strategy_Meeting");
    expect(docResult.format).toBe("markdown");
    expect(docResult.docId.startsWith("doc_")).toBe(true);
    expect(docResult.htmlContent).toContain("<h1>Q4 Strategy Meeting</h1>");
    expect(docResult.htmlContent).toContain("<h2>Action Items</h2>");
    expect(docResult.htmlContent).toContain("<blockquote>");
    expect(docResult.wordCount).toBeGreaterThan(15);
  });

  // Scenario 2: Legacy Formstr Drive chunked document shared via query URL -> Decrypts and populates TipTap without formatting loss
  it("Scenario 2: Legacy chunked document shared via query URL -> TipTap Document", async () => {
    const chunk1Text = "Legacy document section 1: Introduction to project.\n\n";
    const chunk2Text = "Legacy document section 2: Specifications and results.\n";
    const fullText = chunk1Text + chunk2Text;

    const enc1 = await encryptNip44LegacyBytes(new TextEncoder().encode(chunk1Text), TEST_KEY);
    const enc2 = await encryptNip44LegacyBytes(new TextEncoder().encode(chunk2Text), TEST_KEY);
    const h1 = bytesToHex(sha256(enc1));
    const h2 = bytesToHex(sha256(enc2));

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const data = url.endsWith(h1) ? enc1 : enc2;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(data.length) }),
        arrayBuffer: async () => data.buffer,
      });
    });

    const payloadObj = {
      server: TEST_SERVER,
      chunks: [{ hash: h1 }, { hash: h2 }],
      encryptionKey: TEST_KEY,
      encryptionAlgorithm: "nip44-v2",
      name: "Legacy_Spec.txt",
      type: "text/plain",
      size: new TextEncoder().encode(fullText).length,
    };
    const b64 = btoa(JSON.stringify(payloadObj));
    const importUrl = `https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`;

    const parsed = parseDrivePayload(importUrl);
    expect(parsed.cipher).toBe("nip44-v2");
    expect(parsed.chunks?.length).toBe(2);

    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const docResult = await convertDriveFileToDocument(decrypted);

    expect(docResult.title).toBe("Legacy_Spec");
    expect(docResult.format).toBe("text");
    expect(docResult.rawText).toBe(fullText);
  });

  // Scenario 3: Large multi-chunk protected PDF blob requested from Blossom -> Attaches Kind 24242 auth, verifies hash, renders PDF viewer
  it("Scenario 3: Multi-chunk protected PDF with Kind 24242 auth -> In-App PDF Preview", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 Protected Financial Report Body");
    const enc = await encryptNipFsSegmentBlob(pdfBytes, TEST_KEY, 65536);
    const blobHash = bytesToHex(sha256(enc));
    const plainHash = bytesToHex(sha256(pdfBytes));

    let authHeaderReceived = "";

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 401, headers: new Headers() });
      }
      authHeaderReceived = init.headers.Authorization;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc.length) }),
        arrayBuffer: async () => enc.buffer,
      });
    });

    const payload: NormalizedDrivePayload = {
      server: TEST_SERVER,
      blobHash,
      privateKeyHex: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "Financial_Report.pdf",
      mimeType: "application/pdf",
      size: pdfBytes.length,
      chunkSize: 65536,
      unencryptedFileHash: plainHash,
    };

    const decrypted = await fetchAndDecryptDriveFile(payload, { signer });

    // Verify auth header was attached on retry
    expect(authHeaderReceived.startsWith("Nostr ")).toBe(true);
    expect(decrypted.name).toBe("Financial_Report.pdf");
    expect(decrypted.mimeType).toBe("application/pdf");

    // Verify classification is media-pdf and previewable
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("media-pdf");
    expect(c.isPreviewable).toBe(true);
    expect(c.primaryAction).toBe("preview");
  });

  // Scenario 4: Video media file shared via exploded query parameters -> Renders responsive video player with fallback alert
  it("Scenario 4: Video shared via exploded query parameters -> In-App Video Preview", async () => {
    const videoData = new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]);
    const enc = await encryptNipFsSegmentBlob(videoData, TEST_KEY, 65536);
    const blobHash = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const url = `https://pages.formstr.app/drive-import?server=${encodeURIComponent(TEST_SERVER)}&hash=${blobHash}&key=${TEST_KEY}&cipher=nip-fs-segment-v1&name=demo.mp4&type=video/mp4&size=${videoData.length}`;

    const parsed = parseDrivePayload(url);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const classification = classifyDriveFile(decrypted.mimeType, decrypted.name);

    expect(classification.category).toBe("media-video");
    expect(classification.isPreviewable).toBe(true);
    expect(classification.primaryAction).toBe("preview");
  });

  // Scenario 5: Non-previewable executable binary shared -> Displays file size, name, and triggers direct download
  it("Scenario 5: Non-previewable executable binary shared -> Direct Download Action", async () => {
    const binaryBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ executable signature
    const enc = await encryptNipFsSegmentBlob(binaryBytes, TEST_KEY, 65536);
    const blobHash = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const payloadObj = {
      server: TEST_SERVER,
      hash: blobHash,
      key: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "installer.exe",
      type: "application/x-msdownload",
      size: binaryBytes.length,
    };
    const b64 = btoa(JSON.stringify(payloadObj));
    const importUrl = `https://pages.formstr.app/#payload=${b64}`;

    const parsed = parseDrivePayload(importUrl);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const classification = classifyDriveFile(decrypted.mimeType, decrypted.name);

    expect(classification.category).toBe("generic-binary");
    expect(classification.isDocument).toBe(false);
    expect(classification.isPreviewable).toBe(false);
    expect(classification.primaryAction).toBe("download");
    expect(classification.actionLabel).toBe("Download File");
  });

  // Scenario 6: Corrupted chunk hash or malformed payload URL -> Triggers graceful error alert with "Back to docs" button
  it("Scenario 6: Corrupted chunk hash or malformed payload URL -> Graceful Error Alert", async () => {
    // 6A: Corrupted Base64 URL
    expect(() => parseDrivePayload("https://pages.formstr.app/#payload=malformed%%%json")).toThrow(
      DriveImportError,
    );

    // 6B: 404 Missing Blob on Blossom Server
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
    });

    const validPayload: NormalizedDrivePayload = {
      server: TEST_SERVER,
      blobHash: "f".repeat(64),
      privateKeyHex: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "missing.pdf",
      mimeType: "application/pdf",
      size: 100,
      chunkSize: 65536,
    };

    await expect(fetchAndDecryptDriveFile(validPayload)).rejects.toThrow(DriveImportError);
    try {
      await fetchAndDecryptDriveFile(validPayload);
    } catch (e: any) {
      expect(e.code).toBe("BLOB_NOT_FOUND");
      expect(e.title).toBe("File Not Found");
      expect(e.actionGuidance).toBeDefined();
    }
  });
});
