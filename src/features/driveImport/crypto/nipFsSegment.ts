/**
 * src/features/driveImport/crypto/nipFsSegment.ts
 * Modern NIP-FS segment cipher implementation (nip-fs-segment-v1).
 *
 * Implements seekable segment encryption and decryption using AES-256-GCM.
 * Each segment frame consists of ciphertext followed by a 16-byte authentication tag.
 * The 12-byte nonce is derived deterministically from the segment counter (11 bytes big-endian)
 * and an isLast flag byte (0x01 on the final segment, 0x00 otherwise).
 */

import { nip44, getPublicKey } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { DriveImportError } from "../types";

const segmentKeyCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();

/**
 * Derives a 32-byte conversation key from a 64-character private key hex string.
 * Self-derivation computes ECDH shared secret between the private key and its corresponding
 * public key, extracted via HKDF with salt "nip44-v2".
 */
export function deriveConversationKey(privateKeyHex: string): Uint8Array {
  try {
    const secretKey = hexToBytes(privateKeyHex.trim());
    if (secretKey.length !== 32) {
      throw new DriveImportError(
        "INVALID_KEY_FORMAT",
        `Private key must be 32 bytes (64 hex characters), got ${secretKey.length} bytes`,
        "Check decryption key",
        "Invalid Decryption Key",
        "privateKeyHex",
      );
    }
    const pubkey = getPublicKey(secretKey);
    return nip44.v2.utils.getConversationKey(secretKey, pubkey);
  } catch (error) {
    if (error instanceof DriveImportError) throw error;
    throw new DriveImportError(
      "INVALID_KEY_FORMAT",
      `Failed to derive conversation key: ${error instanceof Error ? error.message : String(error)}`,
      "Check decryption key",
      "Invalid Decryption Key",
      "privateKeyHex",
    );
  }
}

/**
 * Builds the NIP-FS per-segment 12-byte nonce:
 * - Bytes 0..10 (11 bytes): Big-endian segment counter index.
 * - Byte 11 (1 byte): 0x01 if isLast is true, 0x00 otherwise.
 */
export function buildSegmentNonce(index: number, isLast: boolean): Uint8Array {
  if (!Number.isInteger(index) || index < 0) {
    throw new DriveImportError(
      "CORRUPTED_SEGMENT",
      `Segment index must be a non-negative integer, got ${index}`,
      "Corrupted file metadata",
      "Corrupted File Segment",
      "index",
    );
  }

  const nonce = new Uint8Array(12);
  let remaining = index;
  for (let i = 10; i >= 0; i--) {
    nonce[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }

  if (remaining > 0) {
    throw new DriveImportError(
      "CORRUPTED_SEGMENT",
      `Segment index too large to encode in 11 bytes: ${index}`,
      "Segment index overflow",
      "Corrupted File Segment",
      "index",
    );
  }

  nonce[11] = isLast ? 1 : 0;
  return nonce;
}

/**
 * Imports a 32-byte blob key as an AES-GCM CryptoKey for WebCrypto.
 * Caches key promises via WeakMap to avoid redundant imports across segments.
 */
export function importSegmentKey(blobKey: Uint8Array): Promise<CryptoKey> {
  if (blobKey.length !== 32) {
    return Promise.reject(
      new DriveImportError(
        "INVALID_KEY_FORMAT",
        `Blob key must be exactly 32 bytes, got ${blobKey.length}`,
        "Check decryption key",
        "Invalid Decryption Key",
        "blobKey",
      ),
    );
  }

  let keyPromise = segmentKeyCache.get(blobKey);
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      blobKey as BufferSource,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    segmentKeyCache.set(blobKey, keyPromise);
    keyPromise.catch(() => segmentKeyCache.delete(blobKey));
  }
  return keyPromise;
}

/**
 * Computes the total number of segments for a file of `size` bytes under `chunkSize`.
 * Always at least 1 (an empty 0-byte file has exactly 1 empty segment).
 */
export function segmentCount(size: number, chunkSize: number): number {
  if (size < 0) return 1;
  if (chunkSize <= 0) return 1;
  return Math.max(1, Math.ceil(size / chunkSize));
}

/**
 * Decrypts a single NIP-FS segment frame.
 * Frame must contain ciphertext followed by 16-byte AES-GCM authentication tag.
 */
export async function decryptSegment(
  frame: Uint8Array,
  blobKey: Uint8Array,
  index: number,
  isLast: boolean,
): Promise<Uint8Array> {
  if (frame.length < 16) {
    throw new DriveImportError(
      "STREAM_TRUNCATED",
      `Segment frame too short: minimum 16 bytes (auth tag), got ${frame.length} bytes`,
      "File segment truncated",
      "Download Interrupted",
      `segment[${index}]`,
    );
  }

  try {
    const aesKey = await importSegmentKey(blobKey);
    const nonce = buildSegmentNonce(index, isLast);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aesKey,
      frame as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw new DriveImportError(
      "CORRUPTED_SEGMENT",
      `Segment ${index} decryption failed: authentication tag mismatch or corrupted data (${error instanceof Error ? error.message : String(error)})`,
      "Verify decryption key and file integrity",
      "Corrupted File Segment",
      `segment[${index}]`,
    );
  }
}

/**
 * Decrypts a contiguous single-blob encrypted under nip-fs-segment-v1.
 * Slices the blob into segment frames, verifies nonces, decrypts each frame sequentially,
 * and concatenates into the recovered plaintext.
 */
export async function decryptNipFsSegmentBlob(
  blob: Uint8Array,
  privateKeyHex: string,
  declaredSize: number,
  chunkSize = 65536,
): Promise<Uint8Array> {
  if (declaredSize < 0) {
    throw new DriveImportError(
      "INVALID_NUMERIC_FIELD",
      `File size cannot be negative: ${declaredSize}`,
      "Check file metadata",
      "Invalid File Size",
      "size",
    );
  }
  if (chunkSize <= 0) {
    throw new DriveImportError(
      "INVALID_NUMERIC_FIELD",
      `Chunk size must be greater than zero: ${chunkSize}`,
      "Check chunk size",
      "Invalid File Size",
      "chunkSize",
    );
  }

  const total = segmentCount(declaredSize, chunkSize);
  const expectedBlobLen = declaredSize + 16 * total;

  if (blob.length < expectedBlobLen) {
    throw new DriveImportError(
      "STREAM_TRUNCATED",
      `Encrypted blob is truncated: expected ${expectedBlobLen} bytes for ${declaredSize} bytes file with ${total} segments, got ${blob.length} bytes`,
      "Download was interrupted. Please retry.",
      "Download Interrupted",
      "blob",
    );
  }

  if (blob.length > expectedBlobLen) {
    throw new DriveImportError(
      "CORRUPTED_SEGMENT",
      `Encrypted blob contains ${blob.length - expectedBlobLen} unexpected trailing bytes past the last segment`,
      "File may be corrupted or tampered with",
      "Corrupted File Segment",
      "blob",
    );
  }

  const blobKey = deriveConversationKey(privateKeyHex);
  const result = new Uint8Array(declaredSize);
  let readOffset = 0;
  let writeOffset = 0;

  for (let i = 0; i < total; i++) {
    const isLast = i === total - 1;
    const plainLen = isLast ? declaredSize - chunkSize * (total - 1) : chunkSize;
    const frameLen = plainLen + 16;
    const frame = blob.subarray(readOffset, readOffset + frameLen);
    readOffset += frameLen;

    const decSegment = await decryptSegment(frame, blobKey, i, isLast);
    result.set(decSegment, writeOffset);
    writeOffset += decSegment.length;
  }

  return result;
}

