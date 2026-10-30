/**
 * src/features/driveImport/parsePayload.ts
 * Ingestion, decoding, normalization, and URL sanitization for Formstr Drive deep links.
 */

import type {
  ChunkRef,
  CipherType,
  DriveImportPayload,
  NormalizedDrivePayload,
} from "./types";
import { DriveImportError } from "./types";

const HEX_64_REGEX = /^[0-9a-f]{64}$/;
const SECP256K1_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const DEFAULT_CHUNK_SIZE = 65536; // 64 KB per NIP-FS specification

/**
 * Validates that a server URL string is a valid absolute HTTP or HTTPS URL,
 * and returns it with trailing slashes stripped.
 * Throws DriveImportError("INVALID_URL") on failure.
 */
function validateAndCleanServerUrl(rawUrl: string, fieldName: string): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim() || rawUrl.includes("\0")) {
    throw new DriveImportError(
      "INVALID_URL",
      `Server must be a valid HTTP or HTTPS URL: ${String(rawUrl)}`,
      "Blossom server address must be a valid URL.",
      undefined,
      fieldName
    );
  }

  const trimmed = rawUrl.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new DriveImportError(
      "INVALID_URL",
      `Server must be a valid HTTP or HTTPS URL: ${trimmed}`,
      "Blossom server address must be a valid URL.",
      undefined,
      fieldName
    );
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new DriveImportError(
      "INVALID_URL",
      `Server must be a valid HTTP or HTTPS URL: ${trimmed}`,
      "Blossom servers must use HTTP or HTTPS.",
      undefined,
      fieldName
    );
  }

  return trimmed.replace(/\/+$/, "");
}

/**
 * Maps common file extensions to standardized MIME types.
 */
export function getMimeTypeFromFilename(name: string): string {
  if (typeof name !== "string" || !name.trim()) return "application/octet-stream";
  const lower = name.toLowerCase().trim();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/**
 * Decodes a raw or URL-encoded base64 string containing JSON.
 * Robust against:
 * 1. Percent-encoding (e.g. from encodeURIComponent)
 * 2. URL-safe base64 characters ('-' -> '+', '_' -> '/')
 * 3. Space characters inserted by URL query parsers decoding unencoded '+'
 * 4. Missing '=' padding
 * 5. Multi-byte UTF-8 character sequences
 */
export function decodeBase64Json(rawInput: string): unknown {
  if (!rawInput || typeof rawInput !== "string") {
    throw new DriveImportError(
      "EMPTY_PAYLOAD",
      "Payload string is empty or missing",
      "Please verify the share link."
    );
  }

  let cleaned = rawInput.trim();
  if (!cleaned) {
    throw new DriveImportError(
      "EMPTY_PAYLOAD",
      "Base64 payload string is empty",
      "Please verify the share link."
    );
  }

  // 1. Decode percent-encoding if present.
  // If malformed percent sequence (e.g. invalid URL-encoding or raw '%'),
  // catch and continue with raw string so base64 validator can handle it.
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Malformed percent-encoding: proceed with un-decoded string
  }

  // 2. Normalize spaces back to '+' (URLSearchParams artifact)
  cleaned = cleaned.replace(/ /g, "+");

  // 3. Normalize URL-safe RFC 4648 base64 characters to standard base64
  cleaned = cleaned.replace(/-/g, "+").replace(/_/g, "/");

  // 4. Correct padding: strip existing padding to measure authentic length
  const unpadded = cleaned.replace(/=+$/, "");
  const mod = unpadded.length % 4;
  if (mod === 1) {
    throw new DriveImportError(
      "MALFORMED_BASE64",
      "Base64 payload length is invalid (length % 4 === 1)",
      "The share link is truncated. Ensure the complete link was copied."
    );
  }
  if (mod === 2) {
    cleaned = unpadded + "==";
  } else if (mod === 3) {
    cleaned = unpadded + "=";
  } else {
    cleaned = unpadded;
  }

  // 5. Validate base64 characters strictly
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new DriveImportError(
      "MALFORMED_BASE64",
      "Invalid base64 characters in payload",
      "The share link appears corrupted. Please re-copy the link from Formstr Drive."
    );
  }

  // 6. Decode base64 to binary string
  let binaryString: string;
  try {
    binaryString = atob(cleaned);
  } catch (e) {
    throw new DriveImportError(
      "MALFORMED_BASE64",
      `Base64 decoding failed: ${(e as Error).message}`,
      "The share link appears corrupted. Please re-copy the link from Formstr Drive."
    );
  }

  // 7. Decode UTF-8 bytes to JSON string preserving multi-byte international characters
  let jsonString: string;
  try {
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    jsonString = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    throw new DriveImportError(
      "MALFORMED_BASE64",
      `Invalid UTF-8 byte sequence in decoded payload: ${(e as Error).message}`,
      "The decoded payload is not valid UTF-8 text."
    );
  }

  // 8. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new DriveImportError(
      "INVALID_JSON",
      `JSON parsing failed: ${(e as Error).message}`,
      "Ensure the link was generated by Formstr Drive and has not been edited."
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DriveImportError(
      "INVALID_JSON",
      "Decoded payload is not a valid JSON object",
      "Ensure the link was generated by Formstr Drive."
    );
  }

  return parsed;
}

/**
 * Normalizes raw payload fields into canonical NormalizedDrivePayload.
 */
export function normalizeDrivePayload(raw: DriveImportPayload): NormalizedDrivePayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DriveImportError(
      "INVALID_JSON",
      "Payload is not a valid JSON object",
      "Ensure the link was generated by Formstr Drive."
    );
  }

  // 1. Blossom Server Validation
  let rawServerCandidate = "";
  if (typeof raw.server === "string") {
    rawServerCandidate = raw.server;
  } else if (Array.isArray(raw.servers) && typeof raw.servers[0] === "string") {
    rawServerCandidate = raw.servers[0];
  } else if (raw.server !== undefined && raw.server !== null) {
    throw new DriveImportError(
      "INVALID_URL",
      `Server must be a valid HTTP or HTTPS URL: ${String(raw.server)}`,
      "Blossom server address must be a valid URL.",
      undefined,
      "server"
    );
  } else if (raw.servers !== undefined && raw.servers !== null) {
    throw new DriveImportError(
      "INVALID_URL",
      `Servers must be an array of URL strings: ${String(raw.servers)}`,
      "Blossom server address must be a valid URL.",
      undefined,
      "servers"
    );
  }

  const rawServer = rawServerCandidate.trim();
  if (!rawServer) {
    throw new DriveImportError(
      "MISSING_REQUIRED_FIELD",
      "Missing required field: server",
      "The import link is missing a Blossom server URL.",
      undefined,
      "server"
    );
  }

  const cleanServer = validateAndCleanServerUrl(rawServer, "server");

  // 2. Decryption Key Validation
  const keyCandidate = raw.key ?? raw.encryptionKey ?? raw.k;
  if (keyCandidate === undefined || keyCandidate === null) {
    throw new DriveImportError(
      "MISSING_REQUIRED_FIELD",
      "Missing required decryption key",
      "The share link is missing the file decryption key.",
      undefined,
      "encryptionKey"
    );
  }

  if (typeof keyCandidate !== "string" || !keyCandidate.trim()) {
    if (typeof keyCandidate === "string" && !keyCandidate.trim()) {
      throw new DriveImportError(
        "MISSING_REQUIRED_FIELD",
        "Missing required decryption key",
        "The share link is missing the file decryption key.",
        undefined,
        "encryptionKey"
      );
    }
    throw new DriveImportError(
      "INVALID_KEY_FORMAT",
      "Decryption key must be 64 hexadecimal characters",
      "Decryption keys must be 64 hexadecimal characters. Check that the link was not cut short.",
      undefined,
      "encryptionKey"
    );
  }

  const cleanKey = keyCandidate.trim().replace(/^0x/i, "").toLowerCase();
  if (!HEX_64_REGEX.test(cleanKey)) {
    throw new DriveImportError(
      "INVALID_KEY_FORMAT",
      "Decryption key must be 64 hexadecimal characters",
      "Decryption keys must be 64 hexadecimal characters. Check that the link was not cut short.",
      undefined,
      "encryptionKey"
    );
  }

  // Curve range check: 0 < key < secp256k1 order
  try {
    const keyInt = BigInt("0x" + cleanKey);
    if (keyInt === 0n || keyInt >= SECP256K1_ORDER) {
      throw new DriveImportError(
        "INVALID_KEY_FORMAT",
        "Decryption key scalar is invalid for secp256k1 curve",
        "The private key in the link is invalid.",
        undefined,
        "encryptionKey"
      );
    }
  } catch (e) {
    if (e instanceof DriveImportError) throw e;
    throw new DriveImportError(
      "INVALID_KEY_FORMAT",
      "Decryption key scalar is invalid",
      "The private key in the link is invalid.",
      undefined,
      "encryptionKey"
    );
  }

  // 3. Blob Hash vs Chunks Validation
  const blobHashCandidate = raw.blobHash ?? raw.hash;
  let normalizedBlobHash: string | undefined = undefined;

  if (blobHashCandidate !== undefined && blobHashCandidate !== null) {
    if (typeof blobHashCandidate !== "string") {
      throw new DriveImportError(
        "INVALID_HASH_FORMAT",
        "Blob hash must be 64 hexadecimal characters",
        "The file identifier in the link is corrupted.",
        undefined,
        "blobHash"
      );
    }
    const trimmedCandidate = blobHashCandidate.trim();
    if (trimmedCandidate !== "") {
      const trimmedHash = trimmedCandidate.replace(/^0x/i, "").toLowerCase();
      if (!HEX_64_REGEX.test(trimmedHash)) {
        throw new DriveImportError(
          "INVALID_HASH_FORMAT",
          "Blob hash must be 64 hexadecimal characters",
          "The file identifier in the link is corrupted.",
          undefined,
          "blobHash"
        );
      }
      normalizedBlobHash = trimmedHash;
    }
  }

  let normalizedChunks: ChunkRef[] | undefined = undefined;
  if (raw.chunks !== undefined && raw.chunks !== null) {
    if (!Array.isArray(raw.chunks)) {
      throw new DriveImportError(
        "CORRUPTED_CHUNKS_ARRAY",
        "Chunks must be an array of chunk hashes or objects",
        "The file chunk list is corrupted.",
        undefined,
        "chunks"
      );
    }

    if (raw.chunks.length > 0) {
      normalizedChunks = raw.chunks.map((item, index) => {
        if (typeof item === "string") {
          const cHash = item.trim().replace(/^0x/i, "").toLowerCase();
          if (!HEX_64_REGEX.test(cHash)) {
            throw new DriveImportError(
              "INVALID_HASH_FORMAT",
              `Chunk at index ${index} has invalid hash format`,
              "One of the file chunk identifiers is corrupted.",
              undefined,
              `chunks[${index}]`
            );
          }
          return { hash: cHash };
        } else if (item && typeof item === "object" && !Array.isArray(item) && typeof item.hash === "string") {
          const cHash = item.hash.trim().replace(/^0x/i, "").toLowerCase();
          if (!HEX_64_REGEX.test(cHash)) {
            throw new DriveImportError(
              "INVALID_HASH_FORMAT",
              `Chunk at index ${index} has invalid hash format`,
              "One of the file chunk identifiers is corrupted.",
              undefined,
              `chunks[${index}].hash`
            );
          }

          let chunkSize: number | undefined = undefined;
          if (item.size !== undefined && item.size !== null) {
            const parsedChunkSize = typeof item.size === "number" ? item.size : Number(item.size);
            if (Number.isFinite(parsedChunkSize) && parsedChunkSize >= 0) {
              chunkSize = Math.floor(parsedChunkSize);
            }
          }

          let chunkServer: string | undefined = undefined;
          if (item.server !== undefined && item.server !== null) {
            if (typeof item.server !== "string") {
              throw new DriveImportError(
                "INVALID_URL",
                `Chunk at index ${index} server must be a valid HTTP or HTTPS URL: ${String(item.server)}`,
                "Blossom server address must be a valid URL.",
                undefined,
                `chunks[${index}].server`
              );
            }
            const trimmedChunkServer = item.server.trim();
            if (trimmedChunkServer) {
              chunkServer = validateAndCleanServerUrl(trimmedChunkServer, `chunks[${index}].server`);
            }
          }

          return {
            hash: cHash,
            size: chunkSize,
            server: chunkServer,
          };
        } else {
          throw new DriveImportError(
            "CORRUPTED_CHUNKS_ARRAY",
            `Chunk at index ${index} is invalid`,
            "The file chunk list is corrupted.",
            undefined,
            `chunks[${index}]`
          );
        }
      });
    }
  }

  if (!normalizedBlobHash && (!normalizedChunks || normalizedChunks.length === 0)) {
    throw new DriveImportError(
      "MISSING_REQUIRED_FIELD",
      "Payload must specify either hash/blobHash or chunks",
      "The share link is missing the file data address.",
      undefined,
      "blobHash"
    );
  }

  // 4. Cipher Determination & Validation
  const cipherCandidate = raw.cipher ?? raw.encryptionAlgorithm;
  let normalizedCipher: CipherType;

  if (cipherCandidate !== undefined && cipherCandidate !== null) {
    if (typeof cipherCandidate !== "string") {
      throw new DriveImportError(
        "UNSUPPORTED_CIPHER",
        `Unsupported cipher: ${String(cipherCandidate)}`,
        `Supported ciphers are 'nip-fs-segment-v1' and 'nip44-v2'.`,
        undefined,
        "cipher"
      );
    }
    const lowerCipher = cipherCandidate.trim().toLowerCase();
    if (!lowerCipher) {
      normalizedCipher = normalizedChunks && normalizedChunks.length > 0 ? "nip44-v2" : "nip-fs-segment-v1";
    } else if (lowerCipher === "nip-fs-segment-v1" || lowerCipher === "aes-gcm" || lowerCipher === "aes-256-gcm") {
      normalizedCipher = "nip-fs-segment-v1";
    } else if (lowerCipher === "nip44-v2" || lowerCipher === "nip-44" || lowerCipher === "nip44") {
      normalizedCipher = "nip44-v2";
    } else {
      throw new DriveImportError(
        "UNSUPPORTED_CIPHER",
        `Unsupported cipher: ${cipherCandidate}`,
        `Supported ciphers are 'nip-fs-segment-v1' and 'nip44-v2'.`,
        undefined,
        "cipher"
      );
    }
  } else {
    // Inferred default: single blob -> nip-fs-segment-v1, multi-chunk -> nip44-v2
    normalizedCipher = normalizedChunks && normalizedChunks.length > 0 ? "nip44-v2" : "nip-fs-segment-v1";
  }

  // 5. Metadata Normalization
  let name = "Untitled";
  if (raw.name && typeof raw.name === "string" && raw.name.trim()) {
    name = raw.name.trim().replace(/\0/g, "").replace(/[/\\]+/g, "_").replace(/^\.+/, "").trim();
    if (!name) name = "Untitled";
  }

  const explicitMime = raw.mimeType ?? raw.type;
  let mimeType = "application/octet-stream";
  if (explicitMime && typeof explicitMime === "string" && explicitMime.trim()) {
    mimeType = explicitMime.trim().split(";")[0].trim().toLowerCase();
  } else if (name && name !== "Untitled") {
    mimeType = getMimeTypeFromFilename(name);
  }

  let size = 0;
  if (typeof raw.size === "number" || typeof raw.size === "string") {
    const parsedSize = typeof raw.size === "string" ? Number(raw.size.trim()) : raw.size;
    if (Number.isFinite(parsedSize)) {
      if (parsedSize < 0) {
        throw new DriveImportError(
          "INVALID_NUMERIC_FIELD",
          "File size cannot be negative",
          "File size cannot be negative.",
          undefined,
          "size"
        );
      }
      size = Math.floor(parsedSize);
    }
  }

  let chunkSize = DEFAULT_CHUNK_SIZE;
  if (typeof raw.chunkSize === "number" || typeof raw.chunkSize === "string") {
    const parsedChunkSize = typeof raw.chunkSize === "string" ? Number(raw.chunkSize.trim()) : raw.chunkSize;
    if (Number.isFinite(parsedChunkSize)) {
      if (parsedChunkSize <= 0) {
        throw new DriveImportError(
          "INVALID_NUMERIC_FIELD",
          "Chunk size must be greater than zero",
          "Chunk size must be greater than zero.",
          undefined,
          "chunkSize"
        );
      }
      chunkSize = Math.floor(parsedChunkSize);
    }
  }

  let unencryptedFileHash: string | undefined = undefined;
  if (raw.unencryptedFileHash !== undefined && raw.unencryptedFileHash !== null) {
    if (typeof raw.unencryptedFileHash !== "string") {
      throw new DriveImportError(
        "INVALID_HASH_FORMAT",
        "Unencrypted file hash must be 64 hexadecimal characters",
        "The unencrypted file hash in the link is corrupted.",
        undefined,
        "unencryptedFileHash"
      );
    }
    const cleanUfh = raw.unencryptedFileHash.trim().replace(/^0x/i, "").toLowerCase();
    if (cleanUfh !== "") {
      if (!HEX_64_REGEX.test(cleanUfh)) {
        throw new DriveImportError(
          "INVALID_HASH_FORMAT",
          "Unencrypted file hash must be 64 hexadecimal characters",
          "The unencrypted file hash in the link is corrupted.",
          undefined,
          "unencryptedFileHash"
        );
      }
      unencryptedFileHash = cleanUfh;
    }
  }

  const normalized: NormalizedDrivePayload = {
    server: cleanServer,
    ...(normalizedBlobHash !== undefined ? { blobHash: normalizedBlobHash } : {}),
    ...(normalizedChunks !== undefined ? { chunks: normalizedChunks } : {}),
    privateKeyHex: cleanKey,
    cipher: normalizedCipher,
    name,
    mimeType,
    size,
    chunkSize,
    unencryptedFileHash,
  };

  return normalized;
}

/**
 * Extracts payload string from URL hash fragment if present.
 */
function extractFromHash(hashString: string): string | null {
  if (!hashString || typeof hashString !== "string") return null;
  const trimmed = hashString.replace(/^#+/, "");

  if (trimmed.toLowerCase().startsWith("payload=")) {
    const ampIndex = trimmed.indexOf("&");
    return ampIndex === -1 ? trimmed.slice(8) : trimmed.slice(8, ampIndex);
  }

  const queryIndex = trimmed.indexOf("?");
  if (queryIndex !== -1) {
    const hashParams = new URLSearchParams(trimmed.slice(queryIndex + 1));
    for (const [key, value] of hashParams.entries()) {
      if (key.toLowerCase() === "payload") return value;
    }
  }

  return null;
}

/**
 * Main ingestion entrypoint: extracts and parses payload from full URL, hash, or query string.
 * Throws DriveImportError on invalid input.
 */
export function parseDrivePayload(urlOrString: string): NormalizedDrivePayload {
  if (urlOrString === null || urlOrString === undefined || typeof urlOrString !== "string" || !urlOrString.trim()) {
    throw new DriveImportError("MISSING_PAYLOAD", "No URL or payload string provided");
  }

  const baseOrigin =
    typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : "https://pages.formstr.app";

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlOrString, baseOrigin);
  } catch {
    throw new DriveImportError("INVALID_URL", "Invalid URL string provided");
  }

  // 1. Channel 1: Hash Fragment (#payload=<b64>)
  const hashPayload = extractFromHash(parsedUrl.hash);
  if (hashPayload !== null) {
    if (!hashPayload.trim()) {
      throw new DriveImportError("MISSING_PAYLOAD", "Empty payload parameter in hash fragment");
    }
    const decodedObj = decodeBase64Json(hashPayload);
    return normalizeDrivePayload(decodedObj as DriveImportPayload);
  }

  // 2. Channel 2: Single Query Parameter (?payload=<b64>)
  let queryPayload: string | null = null;
  for (const [key, val] of parsedUrl.searchParams.entries()) {
    if (key.toLowerCase() === "payload") {
      queryPayload = val;
      break;
    }
  }
  if (queryPayload !== null) {
    if (!queryPayload.trim()) {
      throw new DriveImportError("MISSING_PAYLOAD", "Empty payload parameter in query string");
    }
    const decodedObj = decodeBase64Json(queryPayload);
    return normalizeDrivePayload(decodedObj as DriveImportPayload);
  }

  // 3. Channel 3: Exploded Query Parameters (?server=...&hash=...&key=...)
  const getParam = (name: string): string | null => {
    const lower = name.toLowerCase();
    for (const [key, val] of parsedUrl.searchParams.entries()) {
      if (key.toLowerCase() === lower) return val;
    }
    return null;
  };

  const server = getParam("server");
  const key =
    getParam("key") ??
    getParam("encryptionKey") ??
    getParam("k");
  const hashParam =
    getParam("hash") ?? getParam("blobHash");
  const chunksParam = getParam("chunks");

  if (server || key || hashParam || chunksParam) {
    let chunks: Array<string | ChunkRef> | undefined = undefined;
    if (chunksParam) {
      const trimmed = chunksParam.trim();
      if (trimmed.startsWith("[")) {
        try {
          chunks = JSON.parse(trimmed);
        } catch {
          chunks = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
        }
      } else {
        chunks = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    const explodedPayload: DriveImportPayload = {
      server: server ?? "",
      key: key ?? undefined,
      hash: hashParam ?? undefined,
      chunks,
      cipher: (getParam("cipher") as CipherType) ?? undefined,
      encryptionAlgorithm: getParam("encryptionAlgorithm") ?? undefined,
      name: getParam("name") ?? undefined,
      mimeType: getParam("mimeType") ?? undefined,
      type: getParam("type") ?? undefined,
      size: getParam("size") ?? undefined,
      chunkSize: getParam("chunkSize") ?? undefined,
      unencryptedFileHash: getParam("unencryptedFileHash") ?? undefined,
    };

    return normalizeDrivePayload(explodedPayload);
  }

  // No drive payload identified
  throw new DriveImportError("MISSING_PAYLOAD", "No drive payload found in URL");
}

/**
 * Sanitizes URL in window.history immediately after parsing to prevent private key leakage.
 * Replaces browser history state cleanly without triggering reloads.
 */
export function sanitizeImportUrl(currentUrl?: string): void {
  if (typeof window === "undefined" || !window.history || !window.history.replaceState) {
    return;
  }

  const target =
    typeof currentUrl === "string" && currentUrl.trim()
      ? currentUrl.trim()
      : typeof window !== "undefined" && window.location
      ? window.location.href
      : "https://pages.formstr.app";

  try {
    const baseOrigin =
      typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null"
        ? window.location.origin
        : "https://pages.formstr.app";
    const url = new URL(target, baseOrigin);
    const cleanUrl = `${url.origin}${url.pathname}`;
    window.history.replaceState(
      {},
      (typeof document !== "undefined" ? document.title : "") || "",
      cleanUrl
    );
  } catch {
    // Graceful fallback in sandboxed environments
  }
}

/**
 * Canonical and alias exports for URL sanitization.
 */
export const sanitizeDriveImportUrl = sanitizeImportUrl;

