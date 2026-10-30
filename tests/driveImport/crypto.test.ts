/**
 * tests/driveImport/crypto.test.ts
 * Comprehensive unit and test-vector suite for Formstr Drive dual-cipher decryption engine.
 *
 * Covers:
 * 1. nip-fs-segment-v1: Segment encryption, decryption, nonce generation, and multi-segment geometry.
 * 2. nip44-v2: Legacy HKDF derivation, single-blob & chunk decryption, version checks, and Base64 unwrap.
 * 3. Multi-chunk reassembly, padding trimming, and sequential order.
 * 4. SHA-256 plaintext integrity verification (unencryptedFileHash).
 * 5. Authoritative cryptographic test vectors from Section 6 of spec miner analysis.
 */

import {
  encryptNip44LegacyBytes,
  encryptNipFsSegmentBlob,
  encryptSegment,
} from "./helpers/driveFixtures";
import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import {
  buildSegmentNonce,
  decryptNipFsSegmentBlob,
  decryptSegment,
  deriveConversationKey,
  importSegmentKey,
  segmentCount,
} from "../../src/features/driveImport/crypto/nipFsSegment";
import {
  decryptNip44LegacyBytes,
  deriveGcmKeyAndIv,
  tryUnwrapLegacyBase64,
} from "../../src/features/driveImport/crypto/nip44Legacy";
import {
  decryptDrivePayload,
  reassembleChunks,
  verifyUnencryptedFileHash,
} from "../../src/features/driveImport/crypto/reassemble";
import {
  DriveImportError,
  type NormalizedDrivePayload,
} from "../../src/features/driveImport/types";

describe("Milestone 2: Dual-Cipher Decryption Engine", () => {
  const TEST_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const TEST_SERVER = "https://blossom.primal.net";

  // =========================================================================
  // GROUP 1: NIP-FS Segment Nonce Construction & Mathematics
  // =========================================================================
  describe("1. NIP-FS Segment Nonces & Key Derivation", () => {
    it("1.1 derives deterministic 32-byte conversation key from private key hex", () => {
      const convKey = deriveConversationKey(TEST_KEY_HEX);
      expect(convKey).toBeInstanceOf(Uint8Array);
      expect(convKey.length).toBe(32);

      // Subsequent call produces identical bytes
      const convKey2 = deriveConversationKey(TEST_KEY_HEX);
      expect(bytesToHex(convKey)).toBe(bytesToHex(convKey2));
    });

    it("1.2 rejects malformed private key hex strings", () => {
      expect(() => deriveConversationKey("too-short")).toThrow(DriveImportError);
      expect(() => deriveConversationKey("z".repeat(64))).toThrow(DriveImportError);
    });

    it("1.3 constructs exact 12-byte nonce for segment 0 with isLast=true (Test Vector Nonce)", () => {
      const nonce = buildSegmentNonce(0, true);
      expect(nonce.length).toBe(12);
      expect(bytesToHex(nonce)).toBe("000000000000000000000001");
    });

    it("1.4 constructs exact 12-byte nonce for segment 0 with isLast=false", () => {
      const nonce = buildSegmentNonce(0, false);
      expect(bytesToHex(nonce)).toBe("000000000000000000000000");
    });

    it("1.5 constructs exact 12-byte nonce for segment 1 with isLast=true", () => {
      const nonce = buildSegmentNonce(1, true);
      expect(bytesToHex(nonce)).toBe("000000000000000000000101");
    });

    it("1.6 encodes multi-byte segment indices accurately without 32-bit bitwise truncation", () => {
      const nonce = buildSegmentNonce(0x10203, false);
      expect(bytesToHex(nonce)).toBe("000000000000000001020300");
    });

    it("1.7 rejects negative segment indices", () => {
      expect(() => buildSegmentNonce(-1, false)).toThrow(DriveImportError);
    });

    it("1.8 imports 32-byte blob key as WebCrypto AES-GCM CryptoKey with caching", async () => {
      const blobKey = deriveConversationKey(TEST_KEY_HEX);
      const key1 = await importSegmentKey(blobKey);
      const key2 = await importSegmentKey(blobKey);
      expect(key1).toBe(key2);
      expect(key1.algorithm.name).toBe("AES-GCM");
    });

    it("1.9 calculates correct segment counts across size boundaries", () => {
      expect(segmentCount(0, 65536)).toBe(1);
      expect(segmentCount(1, 65536)).toBe(1);
      expect(segmentCount(65536, 65536)).toBe(1);
      expect(segmentCount(65537, 65536)).toBe(2);
      expect(segmentCount(131072, 65536)).toBe(2);
      expect(segmentCount(25, 16)).toBe(2);
    });
  });

  // =========================================================================
  // GROUP 2: Modern Segment Cipher (nip-fs-segment-v1) Test Vectors & Roundtrip
  // =========================================================================
  describe("2. Modern Segment Cipher (nip-fs-segment-v1)", () => {
    it("2.1 encrypts and decrypts single segment matching Test Vector 1", async () => {
      const blobKey = deriveConversationKey(TEST_KEY_HEX);
      const plaintext = new TextEncoder().encode("Formstr Drive Deep Link Import");
      expect(plaintext.length).toBe(30);

      // Encrypt segment 0, isLast = true
      const frame = await encryptSegment(plaintext, blobKey, 0, true);
      expect(frame.length).toBe(30 + 16); // 46 bytes

      // Decrypt segment 0, isLast = true
      const decrypted = await decryptSegment(frame, blobKey, 0, true);
      expect(decrypted).toEqual(plaintext);
      expect(new TextDecoder().decode(decrypted)).toBe("Formstr Drive Deep Link Import");
    });

    it("2.2 fails decryption when isLast flag is inverted (wrong counter nonce)", async () => {
      const blobKey = deriveConversationKey(TEST_KEY_HEX);
      const plaintext = new TextEncoder().encode("Authentication Tag Guard");
      const frame = await encryptSegment(plaintext, blobKey, 0, true);

      // Decrypting with isLast = false must fail authentication tag check
      await expect(decryptSegment(frame, blobKey, 0, false)).rejects.toThrow(DriveImportError);
    });

    it("2.3 fails decryption when segment index is altered", async () => {
      const blobKey = deriveConversationKey(TEST_KEY_HEX);
      const plaintext = new TextEncoder().encode("Index Guard");
      const frame = await encryptSegment(plaintext, blobKey, 0, false);

      // Decrypting as segment 1 must fail
      await expect(decryptSegment(frame, blobKey, 1, false)).rejects.toThrow(DriveImportError);
    });

    it("2.4 fails decryption when ciphertext byte is tampered with", async () => {
      const blobKey = deriveConversationKey(TEST_KEY_HEX);
      const plaintext = new TextEncoder().encode("Tamper Guard");
      const frame = await encryptSegment(plaintext, blobKey, 0, true);

      // Flip one bit in ciphertext
      frame[5] ^= 0x01;
      await expect(decryptSegment(frame, blobKey, 0, true)).rejects.toThrow(DriveImportError);
    });

    it("2.5 handles multi-segment geometry matching Test Vector 2 (25 bytes with 16 byte chunk)", async () => {
      const plaintext = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        17, 18, 19, 20, 21, 22, 23, 24, 25,
      ]);
      expect(plaintext.length).toBe(25);

      const chunkSize = 16;
      const encryptedBlob = await encryptNipFsSegmentBlob(plaintext, TEST_KEY_HEX, chunkSize);

      // Total size: (16 + 16) + (9 + 16) = 32 + 25 = 57 bytes
      expect(encryptedBlob.length).toBe(57);

      const recovered = await decryptNipFsSegmentBlob(encryptedBlob, TEST_KEY_HEX, 25, chunkSize);
      expect(recovered).toEqual(plaintext);
    });

    it("2.6 decrypts empty file (0 bytes) as 16-byte tag frame", async () => {
      const emptyPlaintext = new Uint8Array(0);
      const encryptedBlob = await encryptNipFsSegmentBlob(emptyPlaintext, TEST_KEY_HEX, 65536);
      expect(encryptedBlob.length).toBe(16); // Only auth tag

      const recovered = await decryptNipFsSegmentBlob(encryptedBlob, TEST_KEY_HEX, 0, 65536);
      expect(recovered.length).toBe(0);
    });

    it("2.7 rejects truncated single-blob stream with STREAM_TRUNCATED error", async () => {
      const plaintext = new TextEncoder().encode("Complete Plaintext Data");
      const encryptedBlob = await encryptNipFsSegmentBlob(plaintext, TEST_KEY_HEX, 65536);

      // Truncate by 5 bytes
      const truncated = encryptedBlob.subarray(0, encryptedBlob.length - 5);
      await expect(decryptNipFsSegmentBlob(truncated, TEST_KEY_HEX, plaintext.length, 65536)).rejects.toThrow(
        DriveImportError,
      );
    });

    it("2.8 rejects single-blob stream with trailing overrun bytes with CORRUPTED_SEGMENT error", async () => {
      const plaintext = new TextEncoder().encode("Legitimate Payload");
      const encryptedBlob = await encryptNipFsSegmentBlob(plaintext, TEST_KEY_HEX, 65536);

      // Append 10 rogue bytes
      const overgrown = new Uint8Array(encryptedBlob.length + 10);
      overgrown.set(encryptedBlob, 0);
      overgrown.set(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]), encryptedBlob.length);

      await expect(decryptNipFsSegmentBlob(overgrown, TEST_KEY_HEX, plaintext.length, 65536)).rejects.toThrow(
        DriveImportError,
      );
    });
  });

  // =========================================================================
  // GROUP 3: Legacy NIP-44 v2 Cipher Test Vectors & Decryption
  // =========================================================================
  describe("3. Legacy NIP-44 v2 Cipher", () => {
    it("3.1 derives AES key and IV using HKDF-SHA256 matching Test Vector 3", async () => {
      const convKey = deriveConversationKey(TEST_KEY_HEX);
      const nonce = hexToBytes("a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf");
      expect(nonce.length).toBe(32);

      const { aesKey, iv } = await deriveGcmKeyAndIv(convKey, nonce);
      expect(aesKey.algorithm.name).toBe("AES-GCM");
      expect(iv.length).toBe(12);
    });

    it("3.2 encrypts and decrypts Test Vector 3 payload (Hello Formstr Legacy NIP44)", async () => {
      const plaintext = new TextEncoder().encode("Hello Formstr Legacy NIP44");
      expect(plaintext.length).toBe(26);
      const nonce = hexToBytes("a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf");

      const wirePayload = await encryptNip44LegacyBytes(plaintext, TEST_KEY_HEX, nonce);

      // Wire format: 1 (version) + 32 (nonce) + 26 (ct) + 16 (tag) = 75 bytes
      expect(wirePayload.length).toBe(75);
      expect(wirePayload[0]).toBe(2);
      expect(bytesToHex(wirePayload.subarray(1, 33))).toBe(
        "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf",
      );

      const decrypted = await decryptNip44LegacyBytes(wirePayload, TEST_KEY_HEX);
      expect(new TextDecoder().decode(decrypted)).toBe("Hello Formstr Legacy NIP44");
    });

    it("3.3 rejects legacy payload with unsupported version byte (e.g. version 1)", async () => {
      const plaintext = new TextEncoder().encode("Test version rejection");
      const wirePayload = await encryptNip44LegacyBytes(plaintext, TEST_KEY_HEX);

      wirePayload[0] = 1; // Corrupt version to 1
      await expect(decryptNip44LegacyBytes(wirePayload, TEST_KEY_HEX)).rejects.toThrow(
        DriveImportError,
      );
    });

    it("3.4 rejects truncated legacy payload (< 49 bytes)", async () => {
      const shortPayload = new Uint8Array(48);
      shortPayload[0] = 2;
      await expect(decryptNip44LegacyBytes(shortPayload, TEST_KEY_HEX)).rejects.toThrow(
        DriveImportError,
      );
    });

    it("3.5 unwraps legacy double-wrapped base64 strings when expectedSize matches", () => {
      const rawText = "Secret plain document";
      const b64 = btoa(rawText);
      const b64Bytes = new TextEncoder().encode(b64);

      const unwrapped = tryUnwrapLegacyBase64(b64Bytes, rawText.length);
      expect(new TextDecoder().decode(unwrapped)).toBe(rawText);
    });

    it("3.6 preserves genuine binary data without corrupting non-base64 bytes", () => {
      const binaryData = new Uint8Array([0x00, 0xff, 0x88, 0x77, 0x42]);
      const result = tryUnwrapLegacyBase64(binaryData);
      expect(result).toEqual(binaryData);
    });
  });

  // =========================================================================
  // GROUP 4: Multi-Chunk Reassembly & Padding Trimming
  // =========================================================================
  describe("4. Multi-Chunk Sequential Reassembly", () => {
    it("4.1 reassembles multiple chunks in strict sequential order", () => {
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5]);
      const chunk3 = new Uint8Array([6, 7, 8, 9]);

      const merged = reassembleChunks([chunk1, chunk2, chunk3], 9);
      expect(merged).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });

    it("4.2 trims trailing padding when declared size is less than chunk sum", () => {
      const chunk1 = new Uint8Array([10, 20, 30, 40]);
      const chunk2 = new Uint8Array([50, 60, 0, 0]); // 2 bytes padding

      const merged = reassembleChunks([chunk1, chunk2], 6);
      expect(merged).toEqual(new Uint8Array([10, 20, 30, 40, 50, 60]));
      expect(merged.length).toBe(6);
    });

    it("4.3 throws STREAM_TRUNCATED when chunks yield fewer bytes than declared size", () => {
      const chunk1 = new Uint8Array([1, 2]);
      expect(() => reassembleChunks([chunk1], 10)).toThrow(DriveImportError);
    });

    it("4.4 throws CORRUPTED_CHUNKS_ARRAY on empty chunks array", () => {
      expect(() => reassembleChunks([], 5)).toThrow(DriveImportError);
    });
  });

  // =========================================================================
  // GROUP 5: SHA-256 Plaintext Integrity Verification
  // =========================================================================
  describe("5. SHA-256 Plaintext Integrity Verification", () => {
    it("5.1 passes cleanly when computed hash matches expected unencryptedFileHash", () => {
      const data = new TextEncoder().encode("Integrity verified document");
      const expectedHash = bytesToHex(sha256(data));

      expect(() => verifyUnencryptedFileHash(data, expectedHash)).not.toThrow();
    });

    it("5.2 passes as no-op when unencryptedFileHash is undefined or empty", () => {
      const data = new TextEncoder().encode("No hash provided");
      expect(() => verifyUnencryptedFileHash(data, undefined)).not.toThrow();
      expect(() => verifyUnencryptedFileHash(data, "")).not.toThrow();
    });

    it("5.3 throws INTEGRITY_CHECK_FAILED when plaintext does not match expected hash", () => {
      const data = new TextEncoder().encode("Authentic content");
      const tamperedExpected = "0".repeat(64);

      expect(() => verifyUnencryptedFileHash(data, tamperedExpected)).toThrow(DriveImportError);
      try {
        verifyUnencryptedFileHash(data, tamperedExpected);
      } catch (e: any) {
        expect(e.code).toBe("INTEGRITY_CHECK_FAILED");
        expect(e.title).toBe("Integrity Verification Failed");
      }
    });

    it("5.4 throws INVALID_HASH_FORMAT when expected hash is not 64 hex characters", () => {
      const data = new TextEncoder().encode("Any content");
      expect(() => verifyUnencryptedFileHash(data, "not-a-valid-hex-hash")).toThrow(DriveImportError);
    });
  });

  // =========================================================================
  // GROUP 6: Unified Decrypt Orchestrator (decryptDrivePayload)
  // =========================================================================
  describe("6. Unified Decrypt Orchestrator (decryptDrivePayload)", () => {
    it("6.1 decrypts single-blob nip-fs-segment-v1 payload", async () => {
      const plaintext = new TextEncoder().encode("# Markdown Title\n\nNotes from meeting.");
      const encBlob = await encryptNipFsSegmentBlob(plaintext, TEST_KEY_HEX, 65536);
      const expectedHash = bytesToHex(sha256(plaintext));

      const payload: NormalizedDrivePayload = {
        server: TEST_SERVER,
        blobHash: bytesToHex(sha256(encBlob)),
        privateKeyHex: TEST_KEY_HEX,
        cipher: "nip-fs-segment-v1",
        name: "notes.md",
        mimeType: "text/markdown",
        size: plaintext.length,
        chunkSize: 65536,
        unencryptedFileHash: expectedHash,
      };

      const result = await decryptDrivePayload(payload, encBlob);
      expect(result.name).toBe("notes.md");
      expect(result.mimeType).toBe("text/markdown");
      expect(result.size).toBe(plaintext.length);
      expect(new TextDecoder().decode(result.data)).toBe("# Markdown Title\n\nNotes from meeting.");
    });

    it("6.2 decrypts multi-chunk nip44-v2 payload", async () => {
      const part1 = new TextEncoder().encode("Part One Data. ");
      const part2 = new TextEncoder().encode("Part Two Data.");
      const fullPlaintext = new TextEncoder().encode("Part One Data. Part Two Data.");

      const encChunk1 = await encryptNip44LegacyBytes(part1, TEST_KEY_HEX);
      const encChunk2 = await encryptNip44LegacyBytes(part2, TEST_KEY_HEX);

      const payload: NormalizedDrivePayload = {
        server: TEST_SERVER,
        chunks: [
          { hash: bytesToHex(sha256(encChunk1)) },
          { hash: bytesToHex(sha256(encChunk2)) },
        ],
        privateKeyHex: TEST_KEY_HEX,
        cipher: "nip44-v2",
        name: "document.txt",
        mimeType: "text/plain",
        size: fullPlaintext.length,
        chunkSize: 65536,
      };

      const result = await decryptDrivePayload(payload, [encChunk1, encChunk2]);
      expect(result.name).toBe("document.txt");
      expect(result.size).toBe(fullPlaintext.length);
      expect(new TextDecoder().decode(result.data)).toBe("Part One Data. Part Two Data.");
    });
  });
});
