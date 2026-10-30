/**
 * tests/driveImport/helpers/driveFixtures.ts
 * Fixture builders for the import tests. Pages only ever DECRYPTS Drive files, so the
 * matching encryptors live here rather than in the shipped bundle.
 */

import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import {
  buildSegmentNonce,
  deriveConversationKey,
  importSegmentKey,
  segmentCount,
} from "../../../src/features/driveImport/crypto/nipFsSegment";
import { deriveGcmKeyAndIv } from "../../../src/features/driveImport/crypto/nip44Legacy";
import { parseDrivePayload } from "../../../src/features/driveImport/parsePayload";
import {
  DriveImportError,
  type NostrSignerLike,
  type ParseResult,
} from "../../../src/features/driveImport/types";

/**
 * Encrypts a single plaintext segment using AES-256-GCM.
 * Produces ciphertext concatenated with 16-byte authentication tag.
 */
export async function encryptSegment(
  plaintext: Uint8Array,
  blobKey: Uint8Array,
  index: number,
  isLast: boolean,
): Promise<Uint8Array> {
  const aesKey = await importSegmentKey(blobKey);
  const nonce = buildSegmentNonce(index, isLast);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    aesKey,
    plaintext as BufferSource,
  );
  return new Uint8Array(ciphertext);
}

/**
 * Encrypts an entire plaintext byte array into a contiguous nip-fs-segment-v1 blob.
 * Utility for vector generation and symmetric round-trip testing.
 */
export async function encryptNipFsSegmentBlob(
  plaintext: Uint8Array,
  privateKeyHex: string,
  chunkSize = 65536,
): Promise<Uint8Array> {
  const blobKey = deriveConversationKey(privateKeyHex);
  const total = segmentCount(plaintext.length, chunkSize);
  const frames: Uint8Array[] = [];
  let totalEncLen = 0;

  for (let i = 0; i < total; i++) {
    const isLast = i === total - 1;
    const offset = i * chunkSize;
    const plainLen = isLast ? plaintext.length - offset : chunkSize;
    const segPlain = plaintext.subarray(offset, offset + plainLen);
    const encFrame = await encryptSegment(segPlain, blobKey, i, isLast);
    frames.push(encFrame);
    totalEncLen += encFrame.length;
  }

  const out = new Uint8Array(totalEncLen);
  let writeOffset = 0;
  for (const frame of frames) {
    out.set(frame, writeOffset);
    writeOffset += frame.length;
  }

  return out;
}

/**
 * Encrypts raw plaintext into a legacy NIP-44 v2 payload (0x02 || nonce || ct).
 * Used for vector generation and round-trip verification.
 */
export async function encryptNip44LegacyBytes(
  plaintext: Uint8Array,
  privateKeyHex: string,
  nonce?: Uint8Array,
): Promise<Uint8Array> {
  const finalNonce = nonce ?? crypto.getRandomValues(new Uint8Array(32));
  if (finalNonce.length !== 32) {
    throw new Error(`Nonce must be 32 bytes, got ${finalNonce.length}`);
  }

  const conversationKey = deriveConversationKey(privateKeyHex);
  const { aesKey, iv } = await deriveGcmKeyAndIv(conversationKey, finalNonce);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    plaintext as BufferSource,
  );

  const payload = new Uint8Array(1 + 32 + ciphertext.byteLength);
  payload[0] = 2; // Version 2
  payload.set(finalNonce, 1);
  payload.set(new Uint8Array(ciphertext), 33);
  return payload;
}

/**
 * Parses and validates a Kind 24242 Nostr authorization header.
 * Utility for verification, debugging, and mock server testing.
 */
export function parseKind24242AuthHeader(authHeader: string): {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
  sig?: string;
  id?: string;
} {
  const trimmed = authHeader.trim();
  if (!trimmed.startsWith("Nostr ")) {
    throw new DriveImportError(
      "BLOSSOM_AUTH_FAILED",
      `Invalid Authorization header scheme: must start with "Nostr ", got "${trimmed.substring(0, 10)}"`,
      "Malformed authorization header",
      "Authorization Failed",
      "header",
    );
  }

  const b64 = trimmed.substring(6).trim();
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const event = JSON.parse(json);

    if (event.kind !== 24242) {
      throw new DriveImportError(
        "BLOSSOM_AUTH_FAILED",
        `Expected kind 24242 auth event, got kind ${event.kind}`,
        "Incorrect event kind",
        "Authorization Failed",
        "kind",
      );
    }

    return event;
  } catch (error) {
    if (error instanceof DriveImportError) throw error;
    throw new DriveImportError(
      "BLOSSOM_AUTH_FAILED",
      `Failed to decode Nostr auth header: ${error instanceof Error ? error.message : String(error)}`,
      "Corrupted authorization header",
      "Authorization Failed",
      "header",
    );
  }
}

/**
 * Creates an in-memory ephemeral Nostr signer.
 * Convenient for testing or signing without a browser extension.
 */
export function createEphemeralSigner(
  secretKeyHex?: string,
): NostrSignerLike & { secretKeyHex: string } {
  const secretKey = secretKeyHex
    ? hexToBytes(secretKeyHex.trim())
    : generateSecretKey();
  const hex = bytesToHex(secretKey);
  const pubkey = getPublicKey(secretKey);

  return {
    secretKeyHex: hex,
    async getPublicKey(): Promise<string> {
      return pubkey;
    },
    async signEvent(event: {
      kind: number;
      tags: string[][];
      content: string;
      created_at: number;
      pubkey?: string;
    }) {
      const template = {
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        created_at: event.created_at,
      };
      const signed = finalizeEvent(template, secretKey);
      return signed;
    },
  };
}

/**
 * URL parser returning a structured ParseResult without throwing exceptions.
 */
export function parseDriveImportUrl(rawUrl?: string): ParseResult {
  try {
    let input: string;
    if (typeof rawUrl === "string") {
      input = rawUrl;
    } else if (rawUrl === undefined || rawUrl === null) {
      input = typeof window !== "undefined" && window.location ? window.location.href : "";
    } else {
      throw new DriveImportError("MISSING_PAYLOAD", "No URL or payload string provided");
    }
    const payload = parseDrivePayload(input);
    return {
      ok: true,
      success: true,
      payload,
    };
  } catch (err) {
    if (err instanceof DriveImportError) {
      return {
        ok: false,
        success: false,
        error: err,
      };
    }
    const fallbackError = new DriveImportError(
      "INVALID_URL",
      err instanceof Error ? err.message : String(err)
    );
    return {
      ok: false,
      success: false,
      error: fallbackError,
    };
  }
}
