/**
 * src/features/driveImport/crypto/reassemble.ts
 * Multi-chunk reassembly, plaintext SHA-256 integrity verification, and unified decryption orchestrator.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "nostr-tools/utils";
import {
  DriveImportError,
  type DecryptedDriveFile,
  type NormalizedDrivePayload,
} from "../types";
import { decryptNipFsSegmentBlob, decryptSegment, deriveConversationKey } from "./nipFsSegment";
import { decryptNip44LegacyBytes } from "./nip44Legacy";

/**
 * Validates the SHA-256 hash of decrypted plaintext against expected unencryptedFileHash.
 * If expectedHash is omitted or empty, verification passes as a no-op.
 */
export function verifyUnencryptedFileHash(plaintext: Uint8Array, expectedHash?: string): void {
  if (!expectedHash) return;

  const cleanExpected = expectedHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanExpected)) {
    throw new DriveImportError(
      "INVALID_HASH_FORMAT",
      `Expected unencryptedFileHash must be 64 hexadecimal characters, got "${expectedHash}"`,
      "File metadata contains invalid hash",
      "Invalid File Hash",
      "unencryptedFileHash",
    );
  }

  const computedHash = bytesToHex(sha256(plaintext));
  if (computedHash !== cleanExpected) {
    throw new DriveImportError(
      "INTEGRITY_CHECK_FAILED",
      `Plaintext integrity verification failed: expected hash ${cleanExpected}, got ${computedHash}`,
      "Decrypted file content did not match declared hash. Data may be altered or corrupted.",
      "Integrity Verification Failed",
      "unencryptedFileHash",
    );
  }
}

/**
 * Reassembles an array of decrypted chunk byte arrays into a single contiguous buffer.
 * Enforces sequential ordering and trims trailing padding to declaredSize if specified.
 */
export function reassembleChunks(
  decryptedChunks: Uint8Array[],
  declaredSize: number,
): Uint8Array {
  if (!Array.isArray(decryptedChunks) || decryptedChunks.length === 0) {
    throw new DriveImportError(
      "CORRUPTED_CHUNKS_ARRAY",
      "Cannot reassemble empty chunks array",
      "No file data available",
      "Invalid Multi-Chunk Data",
      "chunks",
    );
  }

  // Calculate total received byte length
  let totalReceived = 0;
  for (const chunk of decryptedChunks) {
    totalReceived += chunk.length;
  }

  const targetSize = declaredSize > 0 ? declaredSize : totalReceived;
  const result = new Uint8Array(targetSize);

  let writeOffset = 0;
  for (let i = 0; i < decryptedChunks.length; i++) {
    const chunk = decryptedChunks[i];
    if (writeOffset >= targetSize) {
      break; // Already filled declared size
    }

    const bytesToCopy = Math.min(chunk.length, targetSize - writeOffset);
    result.set(chunk.subarray(0, bytesToCopy), writeOffset);
    writeOffset += bytesToCopy;
  }

  if (declaredSize > 0 && writeOffset < declaredSize) {
    throw new DriveImportError(
      "STREAM_TRUNCATED",
      `Reassembled chunks yielded ${writeOffset} bytes, which is shorter than declared file size ${declaredSize} bytes`,
      "One or more chunks were truncated or missing. Please retry.",
      "Download Interrupted",
      "chunks",
    );
  }

  return result;
}

/**
 * Universal decryption orchestrator for both nip-fs-segment-v1 and nip44-v2.
 * Accepts either a single downloaded blob or an array of chunk blobs.
 * Executes decryption, sequential reassembly, and SHA-256 hash verification.
 */
export async function decryptDrivePayload(
  payload: NormalizedDrivePayload,
  fetchedBlobs: Uint8Array | Uint8Array[],
): Promise<DecryptedDriveFile> {
  let plaintext: Uint8Array;

  const isMultiChunk = Array.isArray(fetchedBlobs);

  if (payload.cipher === "nip-fs-segment-v1") {
    if (isMultiChunk) {
      // Multi-chunk NIP-FS segments
      const chunks = fetchedBlobs as Uint8Array[];
      const blobKey = deriveConversationKey(payload.privateKeyHex);
      const decChunks: Uint8Array[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const dec = await decryptSegment(chunks[i], blobKey, i, isLast);
        decChunks.push(dec);
      }
      plaintext = reassembleChunks(decChunks, payload.size);
    } else {
      // Single-blob segmented stream
      const blob = fetchedBlobs as Uint8Array;
      plaintext = await decryptNipFsSegmentBlob(
        blob,
        payload.privateKeyHex,
        payload.size,
        payload.chunkSize || 65536,
      );
    }
  } else if (payload.cipher === "nip44-v2") {
    if (isMultiChunk) {
      // Multi-chunk legacy NIP-44
      const chunks = fetchedBlobs as Uint8Array[];
      const decChunks: Uint8Array[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const dec = await decryptNip44LegacyBytes(chunks[i], payload.privateKeyHex);
        decChunks.push(dec);
      }
      plaintext = reassembleChunks(decChunks, payload.size);
    } else {
      // Single-blob legacy NIP-44
      const blob = fetchedBlobs as Uint8Array;
      plaintext = await decryptNip44LegacyBytes(blob, payload.privateKeyHex, payload.size);
    }
  } else {
    throw new DriveImportError(
      "UNSUPPORTED_CIPHER",
      `Unsupported cipher algorithm: "${payload.cipher}"`,
      "File encryption format is not supported",
      "Unsupported Encryption",
      "cipher",
    );
  }

  // Enforce unencrypted file hash integrity check if present
  verifyUnencryptedFileHash(plaintext, payload.unencryptedFileHash);

  return {
    data: plaintext,
    name: payload.name,
    mimeType: payload.mimeType,
    size: plaintext.length,
    originalPayload: payload,
  };
}
