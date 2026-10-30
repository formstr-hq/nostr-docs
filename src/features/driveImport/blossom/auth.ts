/**
 * src/features/driveImport/blossom/auth.ts
 * Blossom Kind 24242 Nostr HTTP Authorization Header generation.
 *
 * Implements BUD-01, BUD-11, and NIP-98 authentication:
 * Creates an ephemeral Nostr event of kind 24242 with tags:
 *   - ["t", "get"] (verb)
 *   - ["x", "<sha256>"] (hash scoping, supporting multiple hashes)
 *   - ["expiration", "<unix_seconds>"]
 * Encodes as: Authorization: Nostr <base64-json-event>
 */

import { DriveImportError, type NostrSignerLike } from "../types";

/**
 * Creates a signed Nostr Kind 24242 authorization header string.
 */
export async function createKind24242AuthHeader(
  signer: NostrSignerLike,
  hashOrHashes: string | string[],
  verb: "get" | "upload" | "delete" = "get",
  expirationSeconds = 60,
): Promise<string> {
  try {
    const pubkey = await signer.getPublicKey();
    const now = Math.floor(Date.now() / 1000);

    const tags: string[][] = [
      ["t", verb],
      ["expiration", String(now + Math.max(10, expirationSeconds))],
    ];

    if (Array.isArray(hashOrHashes)) {
      if (hashOrHashes.length === 0) {
        throw new DriveImportError(
          "BLOSSOM_AUTH_FAILED",
          "Cannot create Blossom auth event without target blob hash",
          "Signer requires target hash",
          "Authorization Failed",
          "hashes",
        );
      }
      for (const h of hashOrHashes) {
        tags.push(["x", h.toLowerCase().trim()]);
      }
    } else {
      tags.push(["x", hashOrHashes.toLowerCase().trim()]);
    }

    const primaryHash = Array.isArray(hashOrHashes) ? hashOrHashes[0] : hashOrHashes;
    const content = `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${primaryHash}`;

    const unsignedEvent = {
      kind: 24242,
      pubkey,
      created_at: now,
      tags,
      content,
    };

    const signedEvent = await signer.signEvent(unsignedEvent);
    const json = JSON.stringify(signedEvent);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return `Nostr ${b64}`;
  } catch (error) {
    if (error instanceof DriveImportError) throw error;
    throw new DriveImportError(
      "BLOSSOM_AUTH_FAILED",
      `Failed to sign Blossom Kind 24242 auth event: ${error instanceof Error ? error.message : String(error)}`,
      "Nostr signature was cancelled or failed",
      "Authorization Failed",
      "auth",
    );
  }
}

