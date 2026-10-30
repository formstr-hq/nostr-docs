import { describe, it, expect } from "vitest";
import {
  parseDriveImportUrl,
} from "./helpers/driveFixtures";
import {
  parseDrivePayload,
  decodeBase64Json,
  normalizeDrivePayload,
} from "../../src/features/driveImport/parsePayload";
import {
  DriveImportError,
  type DriveImportPayload,
} from "../../src/features/driveImport/types";

describe("Adversarial Stress Suite: parsePayload & parseDriveImportUrl", () => {
  const VALID_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const VALID_HASH = "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae";
  const SERVER = "https://blossom.primal.net";

  const makeValidPayload = () => ({
    server: SERVER,
    hash: VALID_HASH,
    key: VALID_KEY,
    name: "test.md",
  });

  const encodePayload = (obj: unknown): string => {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  };

  // =========================================================================
  // CATEGORY 1: Base64 Padding & Character Corruptions
  // =========================================================================
  describe("Category 1: Adversarial Base64 Padding & Corruption", () => {
    it("handles standard base64 without padding (mod 2 and mod 3)", () => {
      const b64 = encodePayload(makeValidPayload());
      const unpadded = b64.replace(/=+$/, "");
      const url = `https://pages.formstr.app/#payload=${unpadded}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(true);
    });

    it("gracefully catches truncated base64 of length % 4 === 1", () => {
      const b64 = encodePayload(makeValidPayload());
      const unpadded = b64.replace(/=+$/, "");
      // Force length % 4 === 1
      const truncated = unpadded.slice(0, 5);
      const url = `https://pages.formstr.app/#payload=${truncated}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(DriveImportError);
        expect(res.error.code).toBe("MALFORMED_BASE64");
      }
    });

    it("gracefully handles invalid characters inside base64 string", () => {
      const invalidChars = ["!!!@@@###", "abcde===fgh", "====", "AAAA====", "a b c d"];
      for (const str of invalidChars) {
        const url = `https://pages.formstr.app/#payload=${str}`;
        const res = parseDriveImportUrl(url);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBeInstanceOf(DriveImportError);
        }
      }
    });

    it("handles URL-safe base64 with spaces substituted for '+'", () => {
      const b64 = encodePayload(makeValidPayload());
      const spaceCorrupted = b64.replace(/\+/g, " ");
      const url = `https://pages.formstr.app/#payload=${spaceCorrupted}`;
      const res = parseDriveImportUrl(url);
      expect(res.ok).toBe(true);
    });
  });

  // =========================================================================
  // CATEGORY 2: Truncated & Malformed JSON
  // =========================================================================
  describe("Category 2: Truncated & Malformed JSON", () => {
    it("handles truncated JSON safely with INVALID_JSON error", () => {
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

    it("rejects non-object JSON values (primitives, arrays, null)", () => {
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
  });

  // =========================================================================
  // CATEGORY 3: Null Bytes & Control Characters
  // =========================================================================
  describe("Category 3: Null Bytes & Control Characters", () => {
    it("sanitizes null bytes from filename", () => {
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

    it("rejects null bytes in server URL with INVALID_URL", () => {
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
  });

  // =========================================================================
  // CATEGORY 4: Prototype Pollution & Object Tampering
  // =========================================================================
  describe("Category 4: Prototype Pollution Attempts", () => {
    it("does not pollute Object.prototype when payload contains __proto__ or constructor", () => {
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
      // Verify global Object.prototype was NOT polluted
      expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
      expect((Object.prototype as unknown as Record<string, unknown>).admin).toBeUndefined();
    });
  });

  // =========================================================================
  // CATEGORY 5: Type Fuzzing & Unhandled Crash Reproduction
  // =========================================================================
  describe("Category 5: Type Fuzzing & Defensive Robustness", () => {
    it("safely rejects non-string server (number/boolean/array) with DriveImportError without crashing", () => {
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

    it("safely rejects non-string input to parseDrivePayload with MISSING_PAYLOAD", () => {
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

    it("rejects invalid blob hash with INVALID_HASH_FORMAT and 'Invalid File Hash' title", () => {
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

    it("rejects invalid chunk hash with INVALID_HASH_FORMAT and 'Invalid File Hash' title", () => {
      const payload = {
        server: SERVER,
        key: VALID_KEY,
        chunks: ["bad-chunk-hash"],
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
      expect(err.field).toBe("chunks[0]");
    });
  });

  // =========================================================================
  // CATEGORY 6: Malformed URLs & Protocol Injection
  // =========================================================================
  describe("Category 6: Protocol Injection & URL Sanitization", () => {
    it("rejects dangerous protocols for primary Blossom server", () => {
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

    it("rejects dangerous protocols in chunk server overrides with INVALID_URL", () => {
      const payload = {
        server: SERVER,
        key: VALID_KEY,
        chunks: [
          {
            hash: VALID_HASH,
            server: "javascript:evil()",
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
    });

    it("accepts valid HTTP/HTTPS chunk server overrides and normalizes slashes", () => {
      const payload = {
        server: SERVER,
        key: VALID_KEY,
        chunks: [
          {
            hash: VALID_HASH,
            server: "https://blossom-backup.net///",
          },
        ],
      };

      const normalized = normalizeDrivePayload(payload as DriveImportPayload);
      expect(normalized.chunks?.[0].server).toBe("https://blossom-backup.net");
    });
  });
});
