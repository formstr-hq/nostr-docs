/**
 * src/features/driveImport/crypto/nip44Legacy.ts
 * Legacy NIP-44 v2 blob and chunk decryption (nip44-v2).
 *
 * Wire Format: 0x02 || nonce(32 bytes) || ciphertextWithTag(N + 16 bytes)
 * Derivation: HKDF-SHA256(IKM=conversationKey, salt=nonce, info="nip44-v2") -> 44 bytes
 *   - 32 bytes AES-256-GCM key
 *   - 12 bytes AES-GCM IV
 */

import { DriveImportError } from "../types";
import { deriveConversationKey } from "./nipFsSegment";

const NIP44_INFO = new TextEncoder().encode("nip44-v2");

/**
 * Derives the AES-256-GCM key and 12-byte IV from conversationKey and random 32-byte nonce.
 * Conforms to NIP-44 v2 HKDF-SHA256 subkey derivation.
 */
export async function deriveGcmKeyAndIv(
  conversationKey: Uint8Array,
  nonce: Uint8Array,
): Promise<{ aesKey: CryptoKey; iv: Uint8Array }> {
  if (conversationKey.length !== 32) {
    throw new DriveImportError(
      "INVALID_KEY_FORMAT",
      `Conversation key must be 32 bytes, got ${conversationKey.length}`,
      "Check decryption key",
      "Invalid Decryption Key",
      "conversationKey",
    );
  }
  if (nonce.length !== 32) {
    throw new DriveImportError(
      "CORRUPTED_SEGMENT",
      `NIP-44 nonce must be 32 bytes, got ${nonce.length}`,
      "Corrupted payload header",
      "Corrupted File Segment",
      "nonce",
    );
  }

  const baseKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: nonce as BufferSource, info: NIP44_INFO },
    baseKey,
    44 * 8,
  );

  const derived = new Uint8Array(derivedBits);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    derived.subarray(0, 32) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

  return {
    aesKey,
    iv: derived.subarray(32, 44),
  };
}

/**
 * Checks if decrypted bytes represent an ASCII Base64 string that was double-wrapped
 * in early Formstr Drive versions, and decodes it if so.
 */
export function tryUnwrapLegacyBase64(bytes: Uint8Array, expectedSize?: number): Uint8Array {
  if (bytes.length === 0) return bytes;

  // Quick check: all bytes must be valid base64 ASCII characters
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const isB64Char =
      (b >= 65 && b <= 90) || // A-Z
      (b >= 97 && b <= 122) || // a-z
      (b >= 48 && b <= 57) || // 0-9
      b === 43 || // +
      b === 47 || // /
      b === 61 || // =
      b === 10 || // \n
      b === 13; // \r
    if (!isB64Char) {
      return bytes;
    }
  }

  try {
    const text = new TextDecoder().decode(bytes).replace(/\s+/g, "");
    // Only attempt if text looks like base64 and length is multiple of 4
    if (/^[A-Za-z0-9+/=]+$/.test(text) && text.length % 4 === 0) {
      const decodedStr = atob(text);
      const decodedBytes = new Uint8Array(decodedStr.length);
      for (let i = 0; i < decodedStr.length; i++) {
        decodedBytes[i] = decodedStr.charCodeAt(i);
      }

      if (expectedSize !== undefined && expectedSize > 0) {
        if (decodedBytes.length === expectedSize) {
          return decodedBytes;
        }
      } else {
        return decodedBytes;
      }
    }
  } catch {
    // Decoding failed, keep raw bytes
  }

  return bytes;
}

/**
 * Decrypts a legacy NIP-44 v2 payload (wire format 0x02 || nonce || ct).
 */
export async function decryptNip44LegacyBytes(
  payload: Uint8Array,
  privateKeyHex: string,
  expectedSize?: number,
): Promise<Uint8Array> {
  // Wire format: 1 (version) + 32 (nonce) + 16 (tag) = 49 minimum bytes
  if (payload.length < 49) {
    throw new DriveImportError(
      "STREAM_TRUNCATED",
      `Legacy NIP-44 payload is too short: minimum 49 bytes (1 version + 32 nonce + 16 auth tag), got ${payload.length} bytes`,
      "File data is truncated or incomplete",
      "Download Interrupted",
      "payload",
    );
  }

  const version = payload[0];
  if (version !== 2) {
    throw new DriveImportError(
      "UNSUPPORTED_CIPHER",
      `Unsupported legacy encryption format: version ${version} (only version 2 is supported)`,
      "This file uses an unsupported encryption version",
      "Unsupported Encryption",
      "version",
    );
  }

  const nonce = payload.subarray(1, 33);
  const ciphertextWithTag = payload.subarray(33);
  const conversationKey = deriveConversationKey(privateKeyHex);

  try {
    const { aesKey, iv } = await deriveGcmKeyAndIv(conversationKey, nonce);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      aesKey,
      ciphertextWithTag as BufferSource,
    );
    const result = new Uint8Array(plaintext);
    return tryUnwrapLegacyBase64(result, expectedSize);
  } catch (error) {
    if (error instanceof DriveImportError) throw error;
    throw new DriveImportError(
      "DECRYPTION_FAILED",
      `Legacy NIP-44 decryption failed: tag mismatch or corrupted ciphertext (${error instanceof Error ? error.message : String(error)})`,
      "Verify decryption key and file integrity",
      "Decryption Failed",
      "ciphertext",
    );
  }
}

