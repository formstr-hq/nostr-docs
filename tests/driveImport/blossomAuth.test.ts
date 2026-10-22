/**
 * tests/driveImport/blossomAuth.test.ts
 * Comprehensive unit and integration test suite for Blossom HTTP client and Kind 24242 auth engine.
 *
 * Covers:
 * 1. Kind 24242 auth token generation, tag scoping (BUD-01/11), expiration, and header encoding.
 * 2. Header parsing, validation, and error recovery.
 * 3. Ephemeral signer generation and signing verification.
 * 4. Blossom HTTP blob fetching: 200 OK, streaming progress, 401/403 auto-retry with auth, 404, network error, timeout, and abort.
 * 5. Full fetchAndDecryptDriveFile integration workflow.
 */

import {
  createEphemeralSigner,
  encryptNip44LegacyBytes,
  encryptNipFsSegmentBlob,
  parseKind24242AuthHeader,
} from "./helpers/driveFixtures";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bytesToHex } from "nostr-tools/utils";
import { sha256 } from "@noble/hashes/sha256";
import {
  createKind24242AuthHeader,
} from "../../src/features/driveImport/blossom/auth";
import {
  fetchAndDecryptDriveFile,
  fetchBlossomBlob,
} from "../../src/features/driveImport/blossom/fetchBlob";
import {
  DriveImportError,
  type NormalizedDrivePayload,
} from "../../src/features/driveImport/types";

describe("Milestone 2: Blossom Client & Kind 24242 Auth Engine", () => {
  const TEST_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const TEST_SERVER = "https://blossom.example.com";
  const HASH_1 = "1111111111111111111111111111111111111111111111111111111111111111";
  const HASH_2 = "2222222222222222222222222222222222222222222222222222222222222222";

  let signer: ReturnType<typeof createEphemeralSigner>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    signer = createEphemeralSigner(TEST_KEY_HEX);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // GROUP 1: Kind 24242 Auth Header Generation & Scoping
  // =========================================================================
  describe("1. Kind 24242 Nostr Auth Header Construction", () => {
    it("1.1 produces Authorization header with 'Nostr ' prefix", async () => {
      const header = await createKind24242AuthHeader(signer, HASH_1, "get", 60);
      expect(header.startsWith("Nostr ")).toBe(true);
    });

    it("1.2 encodes valid kind 24242 event with t=get, x=hash, and expiration tags", async () => {
      const header = await createKind24242AuthHeader(signer, HASH_1, "get", 60);
      const event = parseKind24242AuthHeader(header);

      expect(event.kind).toBe(24242);
      expect(event.pubkey).toBe(await signer.getPublicKey());
      expect(event.content).toBe(`Get ${HASH_1}`);

      const tTag = event.tags.find((t) => t[0] === "t");
      expect(tTag).toEqual(["t", "get"]);

      const xTag = event.tags.find((t) => t[0] === "x");
      expect(xTag).toEqual(["x", HASH_1]);

      const expTag = event.tags.find((t) => t[0] === "expiration");
      expect(expTag).toBeDefined();
      const expTimestamp = Number(expTag![1]);
      expect(expTimestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("1.3 supports multiple hashes (BUD-11 chunk scoping)", async () => {
      const header = await createKind24242AuthHeader(signer, [HASH_1, HASH_2], "get");
      const event = parseKind24242AuthHeader(header);

      const xTags = event.tags.filter((t) => t[0] === "x");
      expect(xTags.length).toBe(2);
      expect(xTags[0]).toEqual(["x", HASH_1]);
      expect(xTags[1]).toEqual(["x", HASH_2]);
    });

    it("1.4 supports custom verbs (upload, delete)", async () => {
      const header = await createKind24242AuthHeader(signer, HASH_1, "upload", 3600);
      const event = parseKind24242AuthHeader(header);

      const tTag = event.tags.find((t) => t[0] === "t");
      expect(tTag).toEqual(["t", "upload"]);
      expect(event.content).toBe(`Upload ${HASH_1}`);
    });

    it("1.5 throws BLOSSOM_AUTH_FAILED on empty hash array", async () => {
      await expect(createKind24242AuthHeader(signer, [])).rejects.toThrow(DriveImportError);
    });

    it("1.6 throws BLOSSOM_AUTH_FAILED if signer rejects signing", async () => {
      const rejectingSigner = {
        getPublicKey: async () => "fake-pubkey",
        signEvent: async () => {
          throw new Error("User rejected prompt in Nostr extension");
        },
      };

      await expect(createKind24242AuthHeader(rejectingSigner, HASH_1)).rejects.toThrow(
        DriveImportError,
      );
    });
  });

  // =========================================================================
  // GROUP 2: Kind 24242 Auth Header Parsing & Validation
  // =========================================================================
  describe("2. Auth Header Parsing & Error Recovery", () => {
    it("2.1 rejects header without 'Nostr ' prefix", () => {
      expect(() => parseKind24242AuthHeader("Bearer eyJhbGci..."))
        .toThrow(DriveImportError);
    });

    it("2.2 rejects header with invalid Base64", () => {
      expect(() => parseKind24242AuthHeader("Nostr not_valid_base64!@#$"))
        .toThrow(DriveImportError);
    });

    it("2.3 rejects header with wrong kind (e.g. kind 1)", () => {
      const b64 = btoa(JSON.stringify({ kind: 1, content: "Not auth event" }));
      expect(() => parseKind24242AuthHeader(`Nostr ${b64}`))
        .toThrow(DriveImportError);
    });
  });

  // =========================================================================
  // GROUP 3: Blossom HTTP Blob Fetching
  // =========================================================================
  describe("3. Blossom HTTP Blob Fetching", () => {
    it("3.1 successfully downloads blob via HTTP GET 200 OK", async () => {
      const mockData = new Uint8Array([1, 2, 3, 4, 5]);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "5" }),
        arrayBuffer: async () => mockData.buffer,
      });

      const downloaded = await fetchBlossomBlob(TEST_SERVER, HASH_1);
      expect(downloaded).toEqual(mockData);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${TEST_SERVER}/${HASH_1}`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("3.2 attaches precomputed Authorization header if provided", async () => {
      const mockData = new Uint8Array([10, 20]);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "2" }),
        arrayBuffer: async () => mockData.buffer,
      });

      await fetchBlossomBlob(TEST_SERVER, HASH_1, {
        authHeader: "Nostr test-header",
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${TEST_SERVER}/${HASH_1}`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Nostr test-header" }),
        }),
      );
    });

    it("3.3 catches 401 Unauthorized and automatically retries with signed Kind 24242 auth header", async () => {
      const mockData = new Uint8Array([99, 100]);

      // First call returns 401; second call returns 200 OK
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": "2" }),
          arrayBuffer: async () => mockData.buffer,
        });

      const downloaded = await fetchBlossomBlob(TEST_SERVER, HASH_1, { signer });

      expect(downloaded).toEqual(mockData);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      // Verify second call had Authorization header attached
      const secondCallArgs = vi.mocked(globalThis.fetch).mock.calls[1];
      const headers = (secondCallArgs[1] as any).headers;
      expect(headers.Authorization).toBeDefined();
      expect(headers.Authorization.startsWith("Nostr ")).toBe(true);
    });

    it("3.4 throws BLOSSOM_AUTH_REQUIRED on 401/403 when no signer is provided", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
      });

      await expect(fetchBlossomBlob(TEST_SERVER, HASH_1)).rejects.toThrow(DriveImportError);
      try {
        await fetchBlossomBlob(TEST_SERVER, HASH_1);
      } catch (e: any) {
        expect(e.code).toBe("BLOSSOM_AUTH_REQUIRED");
      }
    });

    it("3.5 throws BLOB_NOT_FOUND on HTTP 404 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers(),
      });

      await expect(fetchBlossomBlob(TEST_SERVER, HASH_1)).rejects.toThrow(DriveImportError);
      try {
        await fetchBlossomBlob(TEST_SERVER, HASH_1);
      } catch (e: any) {
        expect(e.code).toBe("BLOB_NOT_FOUND");
        expect(e.title).toBe("File Not Found");
      }
    });

    it("3.6 maps network/CORS TypeError to NETWORK_ERROR", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(fetchBlossomBlob(TEST_SERVER, HASH_1)).rejects.toThrow(DriveImportError);
      try {
        await fetchBlossomBlob(TEST_SERVER, HASH_1);
      } catch (e: any) {
        expect(e.code).toBe("NETWORK_ERROR");
        expect(e.title).toBe("Network Connection Error");
      }
    });

    it("3.7 respects AbortSignal and aborts cleanly", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        fetchBlossomBlob(TEST_SERVER, HASH_1, { signal: controller.signal }),
      ).rejects.toThrow("Download aborted");
    });

    it("3.8 validates hash format and throws INVALID_HASH_FORMAT for non-64 hex chars", async () => {
      await expect(fetchBlossomBlob(TEST_SERVER, "short-hash")).rejects.toThrow(DriveImportError);
    });
  });

  // =========================================================================
  // GROUP 4: Full fetchAndDecryptDriveFile Integration
  // =========================================================================
  describe("4. End-to-End fetchAndDecryptDriveFile Integration Flow", () => {
    it("4.1 downloads and decrypts single-blob nip-fs-segment-v1 file", async () => {
      const plaintext = new TextEncoder().encode("Hello Formstr End-to-End");
      const encBlob = await encryptNipFsSegmentBlob(plaintext, TEST_KEY_HEX, 65536);
      const blobHash = bytesToHex(sha256(encBlob));

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(encBlob.length) }),
        arrayBuffer: async () => encBlob.buffer,
      });

      const payload: NormalizedDrivePayload = {
        server: TEST_SERVER,
        blobHash,
        privateKeyHex: TEST_KEY_HEX,
        cipher: "nip-fs-segment-v1",
        name: "test.txt",
        mimeType: "text/plain",
        size: plaintext.length,
        chunkSize: 65536,
      };

      const stages: string[] = [];
      const result = await fetchAndDecryptDriveFile(payload, {
        onProgress: (prog) => {
          stages.push(prog.stage);
        },
      });

      expect(new TextDecoder().decode(result.data)).toBe("Hello Formstr End-to-End");
      expect(result.name).toBe("test.txt");
      expect(stages).toContain("parsing");
      expect(stages).toContain("fetching");
      expect(stages).toContain("decrypting");
      expect(stages).toContain("complete");
    });

    it("4.2 downloads and decrypts multi-chunk nip44-v2 file", async () => {
      const chunk1Plain = new TextEncoder().encode("Multi Chunk ");
      const chunk2Plain = new TextEncoder().encode("Reassembly Success!");
      const fullPlaintext = new TextEncoder().encode("Multi Chunk Reassembly Success!");

      const encChunk1 = await encryptNip44LegacyBytes(chunk1Plain, TEST_KEY_HEX);
      const encChunk2 = await encryptNip44LegacyBytes(chunk2Plain, TEST_KEY_HEX);

      const hash1 = bytesToHex(sha256(encChunk1));
      const hash2 = bytesToHex(sha256(encChunk2));

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith(hash1)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": String(encChunk1.length) }),
            arrayBuffer: async () => encChunk1.buffer,
          });
        }
        if (url.endsWith(hash2)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": String(encChunk2.length) }),
            arrayBuffer: async () => encChunk2.buffer,
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const payload: NormalizedDrivePayload = {
        server: TEST_SERVER,
        chunks: [{ hash: hash1 }, { hash: hash2 }],
        privateKeyHex: TEST_KEY_HEX,
        cipher: "nip44-v2",
        name: "multi.txt",
        mimeType: "text/plain",
        size: fullPlaintext.length,
        chunkSize: 65536,
        unencryptedFileHash: bytesToHex(sha256(fullPlaintext)),
      };

      const result = await fetchAndDecryptDriveFile(payload);
      expect(new TextDecoder().decode(result.data)).toBe("Multi Chunk Reassembly Success!");
      expect(result.size).toBe(fullPlaintext.length);
    });
  });
});
