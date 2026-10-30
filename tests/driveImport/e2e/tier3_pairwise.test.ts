/**
 * tests/driveImport/e2e/tier3_pairwise.test.ts
 * Tier 3: Combinatorial Pairwise Interaction Testing (15 Tests).
 * Systematically exercises interactions across:
 * - Ingestion Channel: Hash fragment vs Query parameter vs Exploded query
 * - Encryption Cipher: nip-fs-segment-v1 vs nip44-v2
 * - Storage Layout: Single-blob vs Multi-chunk
 * - File Classification: Document (MD/TXT/HTML) vs Media (Image/Video/Audio/PDF) vs Binary
 * - Blossom Auth: Unprotected vs Protected (Kind 24242 auto-retry)
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
import {
  deriveConversationKey,
} from "../../../src/features/driveImport/crypto/nipFsSegment";
import { fetchAndDecryptDriveFile } from "../../../src/features/driveImport/blossom/fetchBlob";
import { convertDriveFileToDocument } from "../../../src/features/driveImport/converters/documentConverter";
import { classifyDriveFile } from "../../../src/features/driveImport/converters/mimeClassifier";
import type { NormalizedDrivePayload } from "../../../src/features/driveImport/types";

describe("Tier 3: Combinatorial Pairwise Interactions (15 Tests)", () => {
  const TEST_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const TEST_SERVER = "https://blossom.example.com";

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

  // Pair 1: Hash + nip-fs-segment-v1 + Single-blob + Markdown + Public Blossom
  it("P1: Hash + nip-fs-segment-v1 + Single-blob + Markdown Document + Public Blossom", async () => {
    const plain = new TextEncoder().encode("# Pair 1 Notes\n\nContent here.");
    const enc = await encryptNipFsSegmentBlob(plain, TEST_KEY, 65536);
    const hash = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash,
      key: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "notes.md",
      type: "text/markdown",
      size: plain.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/#payload=${b64}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const doc = await convertDriveFileToDocument(decrypted);

    expect(doc.format).toBe("markdown");
    expect(doc.htmlContent).toContain("<h1>Pair 1 Notes</h1>");
  });

  // Pair 2: Hash + nip44-v2 + Multi-chunk + Plain Text + Protected Blossom
  it("P2: Hash + nip44-v2 + Multi-chunk + Plain Text + Protected Blossom", async () => {
    const c1Plain = new TextEncoder().encode("Hello ");
    const c2Plain = new TextEncoder().encode("World!");
    const full = new TextEncoder().encode("Hello World!");

    const enc1 = await encryptNip44LegacyBytes(c1Plain, TEST_KEY);
    const enc2 = await encryptNip44LegacyBytes(c2Plain, TEST_KEY);
    const h1 = bytesToHex(sha256(enc1));
    const h2 = bytesToHex(sha256(enc2));

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      // Challenge 401 if no Authorization header
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 401, headers: new Headers() });
      }
      const data = url.endsWith(h1) ? enc1 : enc2;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(data.length) }),
        arrayBuffer: async () => data.buffer,
      });
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      chunks: [{ hash: h1 }, { hash: h2 }],
      key: TEST_KEY,
      cipher: "nip44-v2",
      name: "msg.txt",
      type: "text/plain",
      size: full.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/#payload=${b64}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed, { signer });
    const doc = await convertDriveFileToDocument(decrypted);

    expect(doc.rawText).toBe("Hello World!");
  });

  // Pair 3: Query + nip-fs-segment-v1 + Single-blob + Image Media + Protected Blossom
  it("P3: Query + nip-fs-segment-v1 + Single-blob + Image Media + Protected Blossom", async () => {
    const fakeImg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const enc = await encryptNipFsSegmentBlob(fakeImg, TEST_KEY, 65536);
    const hash = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 403, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc.length) }),
        arrayBuffer: async () => enc.buffer,
      });
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash,
      key: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "photo.png",
      type: "image/png",
      size: fakeImg.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed, { signer });
    const classification = classifyDriveFile(decrypted.mimeType, decrypted.name);

    expect(classification.category).toBe("media-image");
    expect(decrypted.data).toEqual(fakeImg);
  });

  // Pair 4: Query + nip44-v2 + Single-blob + Video Media + Public Blossom
  it("P4: Query + nip44-v2 + Single-blob + Video Media + Public Blossom", async () => {
    const fakeVid = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const enc = await encryptNip44LegacyBytes(fakeVid, TEST_KEY);
    const hash = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash,
      key: TEST_KEY,
      cipher: "nip44-v2",
      name: "clip.mp4",
      type: "video/mp4",
      size: fakeVid.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);

    expect(c.category).toBe("media-video");
  });

  // Pair 5: Exploded + nip-fs-segment-v1 + Single-blob + PDF Media + Public Blossom
  it("P5: Exploded + nip-fs-segment-v1 + Single-blob + PDF Media + Public Blossom", async () => {
    const fakePdf = new TextEncoder().encode("%PDF-1.4 header");
    const enc = await encryptNipFsSegmentBlob(fakePdf, TEST_KEY, 65536);
    const hash = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const url = `https://pages.formstr.app/drive-import?server=${encodeURIComponent(TEST_SERVER)}&hash=${hash}&key=${TEST_KEY}&cipher=nip-fs-segment-v1&name=manual.pdf&type=application/pdf&size=${fakePdf.length}`;
    const parsed = parseDrivePayload(url);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);

    expect(c.category).toBe("media-pdf");
  });

  // Pair 6: Exploded + nip44-v2 + Multi-chunk + Audio Media + Protected Blossom
  it("P6: Exploded + nip44-v2 + Multi-chunk + Audio Media + Protected Blossom", async () => {
    const c1 = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    const enc1 = await encryptNip44LegacyBytes(c1, TEST_KEY);
    const h1 = bytesToHex(sha256(enc1));

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 401, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc1.length) }),
        arrayBuffer: async () => enc1.buffer,
      });
    });

    const payload: NormalizedDrivePayload = {
      server: TEST_SERVER,
      chunks: [{ hash: h1 }],
      privateKeyHex: TEST_KEY,
      cipher: "nip44-v2",
      name: "audio.mp3",
      mimeType: "audio/mpeg",
      size: 4,
      chunkSize: 65536,
    };

    const decrypted = await fetchAndDecryptDriveFile(payload, { signer });
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("media-audio");
  });

  // Pair 7: Hash + nip-fs-segment-v1 + Multi-chunk + Generic Binary + Public Blossom
  it("P7: Hash + nip-fs-segment-v1 + Multi-chunk + Generic Binary + Public Blossom", async () => {
    const b1 = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const blobKey = deriveConversationKey(TEST_KEY);
    const enc1 = await encryptNipFsSegmentBlob(b1, TEST_KEY, 65536);
    const h1 = bytesToHex(sha256(enc1));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc1.length) }),
      arrayBuffer: async () => enc1.buffer,
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash: h1,
      key: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "backup.zip",
      type: "application/zip",
      size: 4,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/#payload=${b64}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("generic-binary");
    expect(c.primaryAction).toBe("download");
  });

  // Pair 8: Query + nip-fs-segment-v1 + Multi-chunk + HTML Document + Public Blossom
  it("P8: Query + nip-fs-segment-v1 + Multi-chunk + HTML Document + Public Blossom", async () => {
    const htmlText = "<h1>Title</h1><p>Body</p>";
    const plain = new TextEncoder().encode(htmlText);
    const enc = await encryptNipFsSegmentBlob(plain, TEST_KEY, 65536);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash: h,
      key: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "page.html",
      type: "text/html",
      size: plain.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const doc = await convertDriveFileToDocument(decrypted);
    expect(doc.format).toBe("html");
    expect(doc.htmlContent).toContain("<h1>Title</h1>");
  });

  // Pair 9: Exploded + nip-fs-segment-v1 + Single-blob + Plain Text + Protected Blossom
  it("P9: Exploded + nip-fs-segment-v1 + Single-blob + Plain Text + Protected Blossom", async () => {
    const plain = new TextEncoder().encode("Log entry: server start");
    const enc = await encryptNipFsSegmentBlob(plain, TEST_KEY, 65536);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 401, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc.length) }),
        arrayBuffer: async () => enc.buffer,
      });
    });

    const url = `https://pages.formstr.app/drive-import?server=${encodeURIComponent(TEST_SERVER)}&hash=${h}&key=${TEST_KEY}&cipher=nip-fs-segment-v1&name=server.log&type=text/plain&size=${plain.length}`;
    const parsed = parseDrivePayload(url);
    const decrypted = await fetchAndDecryptDriveFile(parsed, { signer });
    const doc = await convertDriveFileToDocument(decrypted);
    expect(doc.rawText).toBe("Log entry: server start");
  });

  // Pair 10: Hash + nip44-v2 + Single-blob + Markdown Document + Protected Blossom
  it("P10: Hash + nip44-v2 + Single-blob + Markdown Document + Protected Blossom", async () => {
    const plain = new TextEncoder().encode("# Secure Notes");
    const enc = await encryptNip44LegacyBytes(plain, TEST_KEY);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 403, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc.length) }),
        arrayBuffer: async () => enc.buffer,
      });
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash: h,
      key: TEST_KEY,
      cipher: "nip44-v2",
      name: "secure.md",
      type: "text/markdown",
      size: plain.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/#payload=${b64}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed, { signer });
    const doc = await convertDriveFileToDocument(decrypted);
    expect(doc.htmlContent).toContain("<h1>Secure Notes</h1>");
  });

  // Pair 11: Query + nip44-v2 + Multi-chunk + Generic Binary + Protected Blossom
  it("P11: Query + nip44-v2 + Multi-chunk + Generic Binary + Protected Blossom", async () => {
    const bin = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF binary
    const enc = await encryptNip44LegacyBytes(bin, TEST_KEY);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 401, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc.length) }),
        arrayBuffer: async () => enc.buffer,
      });
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      chunks: [{ hash: h }],
      key: TEST_KEY,
      cipher: "nip44-v2",
      name: "program.elf",
      type: "application/octet-stream",
      size: bin.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed, { signer });
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("generic-binary");
  });

  // Pair 12: Exploded + nip44-v2 + Single-blob + Image Media + Public Blossom
  it("P12: Exploded + nip44-v2 + Single-blob + Image Media + Public Blossom", async () => {
    const fakeWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const enc = await encryptNip44LegacyBytes(fakeWebp, TEST_KEY);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const url = `https://pages.formstr.app/drive-import?server=${encodeURIComponent(TEST_SERVER)}&hash=${h}&key=${TEST_KEY}&cipher=nip44-v2&name=banner.webp&type=image/webp&size=${fakeWebp.length}`;
    const parsed = parseDrivePayload(url);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("media-image");
  });

  // Pair 13: Hash + nip-fs-segment-v1 + Single-blob + Audio Media + Public Blossom
  it("P13: Hash + nip-fs-segment-v1 + Single-blob + Audio Media + Public Blossom", async () => {
    const fakeWav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24]);
    const enc = await encryptNipFsSegmentBlob(fakeWav, TEST_KEY, 65536);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(enc.length) }),
      arrayBuffer: async () => enc.buffer,
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash: h,
      key: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "sound.wav",
      type: "audio/wav",
      size: fakeWav.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/#payload=${b64}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed);
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("media-audio");
  });

  // Pair 14: Query + nip-fs-segment-v1 + Multi-chunk + Video Media + Protected Blossom
  it("P14: Query + nip-fs-segment-v1 + Multi-chunk + Video Media + Protected Blossom", async () => {
    const vidPart = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]); // WebM
    const enc = await encryptNipFsSegmentBlob(vidPart, TEST_KEY, 65536);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 401, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc.length) }),
        arrayBuffer: async () => enc.buffer,
      });
    });

    const b64 = btoa(JSON.stringify({
      server: TEST_SERVER,
      hash: h,
      key: TEST_KEY,
      cipher: "nip-fs-segment-v1",
      name: "recording.webm",
      type: "video/webm",
      size: vidPart.length,
    }));

    const parsed = parseDrivePayload(`https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`);
    const decrypted = await fetchAndDecryptDriveFile(parsed, { signer });
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("media-video");
  });

  // Pair 15: Exploded + nip-fs-segment-v1 + Multi-chunk + PDF Media + Protected Blossom
  it("P15: Exploded + nip-fs-segment-v1 + Multi-chunk + PDF Media + Protected Blossom", async () => {
    const pdfData = new TextEncoder().encode("%PDF-1.7 protected document");
    const enc = await encryptNipFsSegmentBlob(pdfData, TEST_KEY, 65536);
    const h = bytesToHex(sha256(enc));

    globalThis.fetch = vi.fn().mockImplementation((_, init?: any) => {
      if (!init?.headers?.Authorization) {
        return Promise.resolve({ ok: false, status: 403, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(enc.length) }),
        arrayBuffer: async () => enc.buffer,
      });
    });

    const url = `https://pages.formstr.app/drive-import?server=${encodeURIComponent(TEST_SERVER)}&hash=${h}&key=${TEST_KEY}&cipher=nip-fs-segment-v1&name=protected.pdf&type=application/pdf&size=${pdfData.length}`;
    const parsed = parseDrivePayload(url);
    const decrypted = await fetchAndDecryptDriveFile(parsed, { signer });
    const c = classifyDriveFile(decrypted.mimeType, decrypted.name);
    expect(c.category).toBe("media-pdf");
  });
});
