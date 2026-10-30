import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseDriveImportUrl,
} from "./helpers/driveFixtures";
import {
  parseDrivePayload,
  sanitizeImportUrl,
  sanitizeDriveImportUrl,
  decodeBase64Json,
  normalizeDrivePayload,
} from "../../src/features/driveImport/parsePayload";
import {
  DriveImportError,
  type DriveImportPayload,
  type NormalizedDrivePayload,
} from "../../src/features/driveImport/types";

describe("Milestone 1: parseDrivePayload", () => {
  const VALID_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const VALID_HASH = "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae";
  const CHUNK_1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const CHUNK_2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const SERVER = "https://blossom.primal.net";

  // =========================================================================
  // GROUP 1: Happy Path Test Cases
  // =========================================================================
  describe("Happy Path Ingestion", () => {
    it("1.1 parses standard Formstr Drive export URL (#payload=<b64>)", () => {
      const payloadObj = {
        server: SERVER,
        hash: VALID_HASH,
        encryptionKey: VALID_KEY,
        type: "text/markdown",
        name: "meeting-notes.md",
        size: 1024,
      };
      const b64 = btoa(JSON.stringify(payloadObj));
      const url = `https://pages.formstr.app/#payload=${b64}`;

      const result: NormalizedDrivePayload = parseDrivePayload(url);

      expect(result).toEqual({
        server: SERVER,
        blobHash: VALID_HASH,
        privateKeyHex: VALID_KEY,
        cipher: "nip-fs-segment-v1",
        name: "meeting-notes.md",
        mimeType: "text/markdown",
        size: 1024,
        chunkSize: 65536,
        unencryptedFileHash: undefined,
      });
    });

    it("1.2 parses percent-encoded hash payload URL (#payload=%7B... or #payload=eyJ...%3D%3D)", () => {
      const payloadObj = {
        server: SERVER,
        hash: VALID_HASH,
        encryptionKey: VALID_KEY,
        type: "text/markdown",
        name: "notes.md",
        size: 512,
      };
      const b64 = btoa(JSON.stringify(payloadObj));
      const percentEncoded = encodeURIComponent(b64);
      const url = `https://pages.formstr.app/#payload=${percentEncoded}`;

      const result = parseDrivePayload(url);

      expect(result.server).toBe(SERVER);
      expect(result.blobHash).toBe(VALID_HASH);
      expect(result.privateKeyHex).toBe(VALID_KEY);
      expect(result.mimeType).toBe("text/markdown");
    });

    it("1.3 parses query string payload URL (/drive-import?payload=<b64>)", () => {
      const payloadObj = {
        server: SERVER,
        blobHash: VALID_HASH,
        key: VALID_KEY,
        cipher: "nip-fs-segment-v1",
        name: "report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 4096,
        chunkSize: 32768,
      };
      const b64 = btoa(JSON.stringify(payloadObj));
      const url = `https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`;

      const result = parseDrivePayload(url);

      expect(result).toEqual({
        server: SERVER,
        blobHash: VALID_HASH,
        privateKeyHex: VALID_KEY,
        cipher: "nip-fs-segment-v1",
        name: "report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 4096,
        chunkSize: 32768,
        unencryptedFileHash: undefined,
      });
    });

    it("1.4 parses exploded query string URL with all fields", () => {
      const url =
        `https://pages.formstr.app/drive-import?` +
        `server=${encodeURIComponent(SERVER)}&` +
        `hash=${VALID_HASH}&` +
        `key=${VALID_KEY}&` +
        `cipher=nip44-v2&` +
        `name=picture.png&` +
        `mimeType=${encodeURIComponent("image/png")}&` +
        `size=204800&` +
        `chunkSize=65536&` +
        `unencryptedFileHash=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;

      const result = parseDrivePayload(url);

      expect(result).toEqual({
        server: SERVER,
        blobHash: VALID_HASH,
        privateKeyHex: VALID_KEY,
        cipher: "nip44-v2",
        name: "picture.png",
        mimeType: "image/png",
        size: 204800,
        chunkSize: 65536,
        unencryptedFileHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      });
    });

    it("1.5 parses minimal exploded query string with defaults", () => {
      const url =
        `https://pages.formstr.app/drive-import?` +
        `server=${encodeURIComponent(SERVER)}&` +
        `hash=${VALID_HASH}&` +
        `key=${VALID_KEY}`;

      const result = parseDrivePayload(url);

      expect(result).toEqual({
        server: SERVER,
        blobHash: VALID_HASH,
        privateKeyHex: VALID_KEY,
        cipher: "nip-fs-segment-v1", // Default for single blob
        name: "Untitled",
        mimeType: "application/octet-stream",
        size: 0,
        chunkSize: 65536,
        unencryptedFileHash: undefined,
      });
    });

    it("1.6 normalizes field alias variations (encryptionKey/key, blobHash/hash, encryptionAlgorithm/cipher, type/mimeType)", () => {
      // Testing with trailing slash on server as well
      const payloadObj = {
        server: `${SERVER}/`,
        blobHash: VALID_HASH,
        encryptionKey: VALID_KEY,
        encryptionAlgorithm: "nip-fs-segment-v1",
        type: "text/plain",
        name: "simple.txt",
      };
      const b64 = btoa(JSON.stringify(payloadObj));
      const url = `https://pages.formstr.app/#payload=${b64}`;

      const result = parseDrivePayload(url);

      expect(result.server).toBe(SERVER); // Trailing slash stripped
      expect(result.blobHash).toBe(VALID_HASH);
      expect(result.privateKeyHex).toBe(VALID_KEY);
      expect(result.cipher).toBe("nip-fs-segment-v1");
      expect(result.mimeType).toBe("text/plain");
    });

    it("1.7 parses multi-chunk payload structure into normalized ChunkRef[]", () => {
      const payloadObj = {
        server: SERVER,
        chunks: [CHUNK_1, CHUNK_2],
        key: VALID_KEY,
        name: "large-video.mp4",
        mimeType: "video/mp4",
        size: 131072,
      };
      const b64 = btoa(JSON.stringify(payloadObj));
      const url = `https://pages.formstr.app/#payload=${b64}`;

      const result = parseDrivePayload(url);

      expect(result.blobHash).toBeUndefined();
      expect(result.chunks).toEqual([
        { hash: CHUNK_1 },
        { hash: CHUNK_2 },
      ]);
      expect(result.cipher).toBe("nip44-v2"); // Default for multi-chunk
      expect(result.name).toBe("large-video.mp4");
      expect(result.mimeType).toBe("video/mp4");
    });
  });

  // =========================================================================
  // GROUP 2: Error & Boundary Conditions
  // =========================================================================
  describe("Error & Boundary Handling", () => {
    it("2.1 fails gracefully on empty hash or query string", () => {
      expect(() => parseDrivePayload("https://pages.formstr.app/")).toThrow(DriveImportError);
      expect(() => parseDrivePayload("https://pages.formstr.app/#")).toThrow(DriveImportError);
      expect(() => parseDrivePayload("https://pages.formstr.app/drive-import")).toThrow(
        expect.objectContaining({ code: "MISSING_PAYLOAD" })
      );
    });

    it("2.2 fails gracefully on malformed Base64 (!@#$%^&*())", () => {
      const url = "https://pages.formstr.app/#payload=!@#$%^&*()";
      expect(() => parseDrivePayload(url)).toThrow(
        expect.objectContaining({ code: "MALFORMED_BASE64" })
      );
    });

    it("2.3 fails gracefully on valid Base64 but invalid JSON ('Hello World')", () => {
      const url = `https://pages.formstr.app/#payload=${btoa("Hello World")}`;
      expect(() => parseDrivePayload(url)).toThrow(
        expect.objectContaining({ code: "INVALID_JSON" })
      );
    });

    it("2.4 fails gracefully on valid JSON missing 'server'", () => {
      const payload = {
        hash: VALID_HASH,
        key: VALID_KEY,
      };
      const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload))}`;
      expect(() => parseDrivePayload(url)).toThrow(
        expect.objectContaining({
          code: "MISSING_REQUIRED_FIELD",
          message: expect.stringContaining("server"),
        })
      );
    });

    it("2.5 fails gracefully on valid JSON missing 'key' / 'encryptionKey'", () => {
      const payload = {
        server: SERVER,
        hash: VALID_HASH,
      };
      const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload))}`;
      expect(() => parseDrivePayload(url)).toThrow(
        expect.objectContaining({
          code: "MISSING_REQUIRED_FIELD",
          message: expect.stringContaining("key"),
        })
      );
    });

    it("2.6 fails gracefully on valid JSON missing both 'hash' and 'chunks'", () => {
      const payload = {
        server: SERVER,
        key: VALID_KEY,
      };
      const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload))}`;
      expect(() => parseDrivePayload(url)).toThrow(
        expect.objectContaining({
          code: "MISSING_REQUIRED_FIELD",
          message: expect.stringMatching(/hash|chunks/),
        })
      );
    });

    it("2.7 fails gracefully on corrupted hex key (non-hex, wrong length)", () => {
      // Non-hex
      const badHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789zzzzzz";
      const payload1 = { server: SERVER, hash: VALID_HASH, key: badHex };
      const url1 = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload1))}`;
      expect(() => parseDrivePayload(url1)).toThrow(
        expect.objectContaining({ code: "INVALID_KEY_FORMAT" })
      );

      // Too short (16 chars)
      const shortHex = "0123456789abcdef";
      const payload2 = { server: SERVER, hash: VALID_HASH, key: shortHex };
      const url2 = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload2))}`;
      expect(() => parseDrivePayload(url2)).toThrow(
        expect.objectContaining({ code: "INVALID_KEY_FORMAT" })
      );
    });
  });

  // =========================================================================
  // GROUP 3: URL Sanitization & Security
  // =========================================================================
  describe("URL Sanitization", () => {
    let replaceStateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Ensure global window and history exist in any test environment
      if (typeof globalThis.window === "undefined") {
        (globalThis as unknown as { window: unknown }).window = {
          location: new URL("https://pages.formstr.app/"),
          history: {
            replaceState: () => {},
          },
        };
      } else if (!globalThis.window.history) {
        (globalThis.window as unknown as { history: unknown }).history = {
          replaceState: () => {},
        };
      }
      replaceStateSpy = vi.spyOn(window.history, "replaceState");
    });

    afterEach(() => {
      replaceStateSpy.mockRestore();
    });

    it("3.1 invokes window.history.replaceState to strip #payload containing private keys", () => {
      const b64 = btoa(JSON.stringify({ server: SERVER, hash: VALID_HASH, key: VALID_KEY }));
      const dirtyUrl = `https://pages.formstr.app/#payload=${b64}`;

      sanitizeImportUrl(dirtyUrl);

      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanUrl).not.toContain(VALID_KEY);
      expect(cleanUrl).not.toContain("payload");
      expect(cleanUrl).toBe("https://pages.formstr.app/");
    });

    it("3.2 invokes window.history.replaceState to strip ?payload from /drive-import", () => {
      const b64 = btoa(JSON.stringify({ server: SERVER, hash: VALID_HASH, key: VALID_KEY }));
      const dirtyUrl = `https://pages.formstr.app/drive-import?payload=${encodeURIComponent(b64)}`;

      sanitizeImportUrl(dirtyUrl);

      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanUrl).not.toContain(VALID_KEY);
      expect(cleanUrl).not.toContain("payload");
      expect(cleanUrl).toBe("https://pages.formstr.app/drive-import");
    });

    it("3.3 invokes window.history.replaceState to strip exploded parameters containing key", () => {
      const dirtyUrl = `https://pages.formstr.app/drive-import?server=${encodeURIComponent(SERVER)}&hash=${VALID_HASH}&key=${VALID_KEY}`;

      sanitizeImportUrl(dirtyUrl);

      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanUrl).not.toContain(VALID_KEY);
      expect(cleanUrl).not.toContain("key=");
      expect(cleanUrl).toBe("https://pages.formstr.app/drive-import");
    });
  });

  // =========================================================================
  // GROUP 4: Advanced Edge Cases & Defensiveness
  // =========================================================================
  describe("Advanced Edge Cases & Defensiveness", () => {
    it("4.1 accepts URL-safe Base64 strings with - and _ without padding", () => {
      const payloadObj = {
        server: SERVER,
        hash: VALID_HASH,
        key: VALID_KEY,
        name: "sample.txt",
      };
      // Standard base64
      const b64 = btoa(JSON.stringify(payloadObj));
      // Convert to base64url
      const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const url = `https://pages.formstr.app/#payload=${b64url}`;
      const result = parseDrivePayload(url);

      expect(result.server).toBe(SERVER);
      expect(result.privateKeyHex).toBe(VALID_KEY);
      expect(result.name).toBe("sample.txt");
    });

    it("4.2 normalizes uppercase hex keys and hashes to lowercase", () => {
      const upperKey = VALID_KEY.toUpperCase();
      const upperHash = VALID_HASH.toUpperCase();

      const payloadObj = {
        server: SERVER,
        hash: upperHash,
        key: upperKey,
      };
      const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payloadObj))}`;
      const result = parseDrivePayload(url);

      expect(result.privateKeyHex).toBe(VALID_KEY.toLowerCase());
      expect(result.blobHash).toBe(VALID_HASH.toLowerCase());
    });

    it("4.3 infers MIME type from filename extension when MIME type is omitted", () => {
      const cases = [
        { name: "doc.docx", expected: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        { name: "readme.md", expected: "text/markdown" },
        { name: "photo.png", expected: "image/png" },
        { name: "movie.mp4", expected: "video/mp4" },
        { name: "manual.pdf", expected: "application/pdf" },
      ];

      for (const c of cases) {
        const payload = { server: SERVER, hash: VALID_HASH, key: VALID_KEY, name: c.name };
        const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload))}`;
        const res = parseDrivePayload(url);
        expect(res.mimeType).toBe(c.expected);
      }
    });

    it("4.4 rejects unsupported ciphers with UNSUPPORTED_CIPHER error", () => {
      const payload = {
        server: SERVER,
        hash: VALID_HASH,
        key: VALID_KEY,
        cipher: "aes-256-cbc",
      };
      const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload))}`;
      expect(() => parseDrivePayload(url)).toThrow(
        expect.objectContaining({ code: "UNSUPPORTED_CIPHER" })
      );
    });

    it("4.5 rejects non-http/https server URLs with INVALID_URL error", () => {
      const payload = {
        server: "ftp://blossom.primal.net",
        hash: VALID_HASH,
        key: VALID_KEY,
      };
      const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payload))}`;
      expect(() => parseDrivePayload(url)).toThrow(
        expect.objectContaining({ code: "INVALID_URL" })
      );
    });
  });

  // =========================================================================
  // GROUP 5: ParseResult Contract & Additional Ingestion Vectors
  // =========================================================================
  describe("ParseResult & Non-throwing Ingestion", () => {
    it("5.1 parseDriveImportUrl returns { ok: true, success: true, payload } for valid URL", () => {
      const payloadObj = {
        server: SERVER,
        hash: VALID_HASH,
        encryptionKey: VALID_KEY,
        type: "text/plain",
        name: "hello.txt",
      };
      const url = `https://pages.formstr.app/#payload=${btoa(JSON.stringify(payloadObj))}`;
      const res = parseDriveImportUrl(url);

      expect(res.ok).toBe(true);
      expect(res.success).toBe(true);
      if (res.ok) {
        expect(res.payload.name).toBe("hello.txt");
        expect(res.payload.server).toBe(SERVER);
      }
    });

    it("5.2 parseDriveImportUrl returns { ok: false, success: false, error } for invalid URL", () => {
      const res = parseDriveImportUrl("https://pages.formstr.app/");
      expect(res.ok).toBe(false);
      expect(res.success).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("MISSING_PAYLOAD");
        expect(res.error.title).toBe("No File Found");
        expect(res.error.actionGuidance).toBe("Back to docs");
      }
    });

    it("5.3 parses Formstr Drive live payload with omitted size and chunkSize", () => {
      // Exact structure emitted by Formstr Drive's openInNostrDocs
      const livePayload = {
        server: SERVER,
        hash: VALID_HASH,
        encryptionKey: VALID_KEY,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        name: "Contract.docx",
      };
      const url = `https://pages.formstr.app/#payload=${encodeURIComponent(btoa(JSON.stringify(livePayload)))}`;
      const result = parseDrivePayload(url);

      expect(result.size).toBe(0);
      expect(result.chunkSize).toBe(65536);
      expect(result.name).toBe("Contract.docx");
      expect(result.cipher).toBe("nip-fs-segment-v1");
    });

    it("5.4 decodeBase64Json directly decodes base64 payload into raw object", () => {
      const raw = { foo: "bar", num: 42 };
      const b64 = btoa(JSON.stringify(raw));
      const decoded = decodeBase64Json(b64);
      expect(decoded).toEqual(raw);
    });
  });

  // =========================================================================
  // GROUP 6: International Characters & Multi-byte UTF-8
  // =========================================================================
  describe("International UTF-8 Characters", () => {
    it("6.1 decodes international Unicode characters in filename without corruption", () => {
      const unicodeNames = [
        "会议记录.docx",
        "résumé_2026.pdf",
        "تقرير_المبيعات.md",
        "🚀_launch_plan.txt",
      ];

      for (const name of unicodeNames) {
        const payloadObj = {
          server: SERVER,
          hash: VALID_HASH,
          key: VALID_KEY,
          name,
        };
        // Encode via TextEncoder to simulate real browser JSON string
        const jsonStr = JSON.stringify(payloadObj);
        const bytes = new TextEncoder().encode(jsonStr);
        let binaryStr = "";
        for (let i = 0; i < bytes.length; i++) {
          binaryStr += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binaryStr);
        const url = `https://pages.formstr.app/#payload=${b64}`;

        const result = parseDrivePayload(url);
        expect(result.name).toBe(name);
      }
    });
  });

  // =========================================================================
  // GROUP 7: Security & Redaction
  // =========================================================================
  describe("Security & Redaction", () => {
    it("7.2 sanitizeDriveImportUrl alias works identically to sanitizeImportUrl", () => {
      const replaceSpy = vi.spyOn(window.history, "replaceState");
      sanitizeDriveImportUrl("https://pages.formstr.app/drive-import?key=0123");
      expect(replaceSpy).toHaveBeenCalledTimes(1);
      const cleanUrl = replaceSpy.mock.calls[0][2];
      expect(cleanUrl).toBe("https://pages.formstr.app/drive-import");
      replaceSpy.mockRestore();
    });

    it("7.3 DriveImportError.toJSON provides clean structured error without secrets", () => {
      const err = new DriveImportError(
        "INVALID_KEY_FORMAT",
        "Decryption key must be 64 hexadecimal characters",
        "Back to docs",
        "Invalid Decryption Key",
        "encryptionKey"
      );
      const json = err.toJSON();
      expect(json.code).toBe("INVALID_KEY_FORMAT");
      expect(json.title).toBe("Invalid Decryption Key");
      expect(json.actionGuidance).toBe("Back to docs");
      expect(json.field).toBe("encryptionKey");
      expect(JSON.stringify(json)).not.toContain(VALID_KEY);
    });
  });

  // =========================================================================
  // GROUP 8: Adversarial Robustness & Fuzz Defense
  // =========================================================================
  describe("Group 8: Adversarial Robustness & Fuzz Defense", () => {
    const encodePayload = (obj: unknown): string => {
      const json = JSON.stringify(obj);
      const bytes = new TextEncoder().encode(json);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
      }
      return btoa(bin);
    };

    const makeValidPayload = () => ({
      server: SERVER,
      hash: VALID_HASH,
      key: VALID_KEY,
      name: "test.md",
    });

    // -----------------------------------------------------------------------
    // 8.1 - 8.4: Base64 Padding & Character Corruptions
    // -----------------------------------------------------------------------
    it("8.1 handles standard base64 without padding (mod 2 and mod 3)", () => {
      const b64 = encodePayload(makeValidPayload());
      const unpadded = b64.replace(/=+$/, "");
      const url = `https://pages.formstr.app/#payload=${unpadded}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(true);
    });

    it("8.2 gracefully catches truncated base64 of length % 4 === 1", () => {
      const b64 = encodePayload(makeValidPayload());
      const targetLen = (Math.floor(b64.length / 4) - 1) * 4 + 1;
      const truncated = b64.slice(0, targetLen);
      expect(truncated.length % 4).toBe(1);
      const url = `https://pages.formstr.app/#payload=${truncated}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(DriveImportError);
        expect(res.error.code).toBe("MALFORMED_BASE64");
      }
    });

    it("8.3 gracefully handles invalid characters inside base64 string", () => {
      const invalidChars = ["!!!@@@###", "abcde===fgh", "====", "AAAA====", "a b c d"];
      for (const str of invalidChars) {
        const url = `https://pages.formstr.app/#payload=${str}`;
        const res = parseDriveImportUrl(url);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBeInstanceOf(DriveImportError);
          expect(["MALFORMED_BASE64", "INVALID_JSON"]).toContain(res.error.code);
        }
      }
    });

    it("8.4 handles URL-safe base64 with spaces substituted for '+'", () => {
      const b64 = encodePayload(makeValidPayload());
      const spaceCorrupted = b64.replace(/\+/g, " ");
      const url = `https://pages.formstr.app/#payload=${spaceCorrupted}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 8.5 - 8.6: Truncated & Malformed JSON
    // -----------------------------------------------------------------------
    it("8.5 handles truncated JSON safely with INVALID_JSON or EMPTY_PAYLOAD error", () => {
      const truncatedJsons = [
        '{"server": "https://blossom.net"',
        '{"server": "https://blossom.net", "key":',
        '{"server": "https://blossom.net", "chunks": [',
        "{",
        "[",
        "",
      ];

      for (const t of truncatedJsons) {
        const b64 = btoa(t);
        const url = `https://pages.formstr.app/#payload=${b64}`;
        const res = parseDriveImportUrl(url);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBeInstanceOf(DriveImportError);
          expect(["INVALID_JSON", "EMPTY_PAYLOAD", "MISSING_PAYLOAD"]).toContain(res.error.code);
        }
      }
    });

    it("8.6 rejects non-object JSON values (primitives, arrays, null)", () => {
      const primitives = ["null", "12345", '"just a string"', "true", "[1, 2, 3]"];
      for (const p of primitives) {
        const b64 = btoa(p);
        const url = `https://pages.formstr.app/#payload=${b64}`;
        const res = parseDriveImportUrl(url);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBeInstanceOf(DriveImportError);
          expect(res.error.code).toBe("INVALID_JSON");
        }
      }
    });

    // -----------------------------------------------------------------------
    // 8.7 - 8.8: Null Bytes & Control Characters
    // -----------------------------------------------------------------------
    it("8.7 sanitizes null bytes from filename", () => {
      const payload = {
        ...makeValidPayload(),
        name: "malicious\0file\0name.md",
      };
      const url = `https://pages.formstr.app/#payload=${encodePayload(payload)}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.payload.name).toBe("maliciousfilename.md");
        expect(res.payload.name).not.toContain("\0");
      }
    });

    it("8.8 rejects null bytes in server URL with INVALID_URL", () => {
      const payload = {
        ...makeValidPayload(),
        server: "https://blossom.net\0/extra",
      };
      const url = `https://pages.formstr.app/#payload=${encodePayload(payload)}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(DriveImportError);
        expect(res.error.code).toBe("INVALID_URL");
      }
    });

    // -----------------------------------------------------------------------
    // 8.9: Prototype Pollution Defense
    // -----------------------------------------------------------------------
    it("8.9 does not pollute Object.prototype when payload contains __proto__ or constructor", () => {
      const maliciousJson = JSON.stringify({
        __proto__: { polluted: "yes" },
        constructor: { prototype: { admin: true } },
        server: SERVER,
        hash: VALID_HASH,
        key: VALID_KEY,
      });

      const b64 = btoa(maliciousJson);
      const url = `https://pages.formstr.app/#payload=${b64}`;
      const res = parseDriveImportUrl(url);

      expect(res.ok).toBe(true);
      expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
      expect((Object.prototype as unknown as Record<string, unknown>).admin).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // 8.10 - 8.13: Type Fuzzing & Error Code Accuracy Guards
    // -----------------------------------------------------------------------
    it("8.10 safely rejects non-string server (number, boolean, array, object) with DriveImportError without crashing", () => {
      const nonStringServers = [12345, true, false, ["https://blossom.net"], { host: "blossom.net" }];

      for (const badServer of nonStringServers) {
        const raw = {
          server: badServer as unknown as string,
          key: VALID_KEY,
          hash: VALID_HASH,
        };

        let caughtError: unknown = null;
        try {
          normalizeDrivePayload(raw as unknown as DriveImportPayload);
        } catch (e) {
          caughtError = e;
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError).toBeInstanceOf(DriveImportError);
        expect(caughtError).not.toBeInstanceOf(TypeError);
        const err = caughtError as DriveImportError;
        expect(["MISSING_REQUIRED_FIELD", "INVALID_URL", "INVALID_SERVER_URL"]).toContain(err.code);
      }
    });

    it("8.11 safely rejects non-string arguments to parseDrivePayload with MISSING_PAYLOAD", () => {
      const badInputs = [12345, true, {}, []];

      for (const bad of badInputs) {
        let caught: unknown = null;
        try {
          parseDrivePayload(bad as unknown as string);
        } catch (e) {
          caught = e;
        }

        expect(caught).not.toBeNull();
        expect(caught).toBeInstanceOf(DriveImportError);
        expect(caught).not.toBeInstanceOf(TypeError);
        expect((caught as DriveImportError).code).toBe("MISSING_PAYLOAD");
      }
    });

    it("8.12 rejects invalid blob hash with INVALID_HASH_FORMAT and 'Invalid File Hash' title", () => {
      const payload = {
        server: SERVER,
        key: VALID_KEY,
        hash: "not-a-valid-hex-hash",
      };

      let caught: unknown = null;
      try {
        normalizeDrivePayload(payload as DriveImportPayload);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(DriveImportError);
      const err = caught as DriveImportError;
      expect(err.code).toBe("INVALID_HASH_FORMAT");
      expect(err.title).toBe("Invalid File Hash");
      expect(err.field).toBe("blobHash");
    });

    it("8.13 rejects invalid chunk hash with INVALID_HASH_FORMAT and 'Invalid File Hash' title", () => {
      // String chunk item
      const payloadString = {
        server: SERVER,
        key: VALID_KEY,
        chunks: ["bad-chunk-hash"],
      };

      let caughtString: unknown = null;
      try {
        normalizeDrivePayload(payloadString as DriveImportPayload);
      } catch (e) {
        caughtString = e;
      }

      expect(caughtString).toBeInstanceOf(DriveImportError);
      const errString = caughtString as DriveImportError;
      expect(errString.code).toBe("INVALID_HASH_FORMAT");
      expect(errString.title).toBe("Invalid File Hash");
      expect(errString.field).toBe("chunks[0]");

      // Object chunk item
      const payloadObj = {
        server: SERVER,
        key: VALID_KEY,
        chunks: [{ hash: "bad-hex-chunk-hash" }],
      };

      let caughtObj: unknown = null;
      try {
        normalizeDrivePayload(payloadObj as DriveImportPayload);
      } catch (e) {
        caughtObj = e;
      }

      expect(caughtObj).toBeInstanceOf(DriveImportError);
      const errObj = caughtObj as DriveImportError;
      expect(errObj.code).toBe("INVALID_HASH_FORMAT");
      expect(errObj.title).toBe("Invalid File Hash");
      expect(errObj.field).toBe("chunks[0].hash");
    });

    // -----------------------------------------------------------------------
    // 8.14 - 8.16: Protocol Injection & Server URL Defense
    // -----------------------------------------------------------------------
    it("8.14 rejects dangerous protocols for primary Blossom server", () => {
      const dangerousProtocols = [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "ftp://blossom.net",
      ];

      for (const proto of dangerousProtocols) {
        const payload = {
          ...makeValidPayload(),
          server: proto,
        };
        const url = `https://pages.formstr.app/#payload=${encodePayload(payload)}`;
        const res = parseDriveImportUrl(url);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBeInstanceOf(DriveImportError);
          expect(res.error.code).toBe("INVALID_URL");
        }
      }
    });

    it("8.15 rejects dangerous protocols in chunk server overrides with INVALID_URL", () => {
      const dangerousProtocols = [
        "javascript:evil()",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/shadow",
        "ftp://custom-blossom.net",
      ];

      for (const proto of dangerousProtocols) {
        const payload = {
          server: SERVER,
          key: VALID_KEY,
          chunks: [
            {
              hash: VALID_HASH,
              server: proto,
            },
          ],
        };

        let caught: unknown = null;
        try {
          normalizeDrivePayload(payload as DriveImportPayload);
        } catch (e) {
          caught = e;
        }

        expect(caught).toBeInstanceOf(DriveImportError);
        const err = caught as DriveImportError;
        expect(err.code).toBe("INVALID_URL");
        expect(err.field).toBe("chunks[0].server");
      }
    });

    it("8.16 accepts valid http/https chunk server overrides and normalizes trailing slashes", () => {
      const payload = {
        server: SERVER,
        key: VALID_KEY,
        chunks: [
          {
            hash: VALID_HASH,
            server: "https://custom-blossom.net///",
          },
        ],
      };

      const normalized = normalizeDrivePayload(payload as DriveImportPayload);
      expect(normalized.chunks?.[0].server).toBe("https://custom-blossom.net");
    });
  });
});
