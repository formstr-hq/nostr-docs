/**
 * src/features/driveImport/blossom/fetchBlob.ts
 * Robust Blossom HTTP client with Kind 24242 auto-authentication,
 * multi-chunk fetching, streaming progress, and unified error mapping.
 */

import {
  DriveImportError,
  type DecryptedDriveFile,
  type DecryptionProgress,
  type NormalizedDrivePayload,
  type NostrSignerLike,
} from "../types";
import { decryptDrivePayload } from "../crypto/reassemble";
import { createKind24242AuthHeader } from "./auth";

export interface FetchBlobOptions {
  /** Precomputed Nostr authorization header (e.g. "Nostr <base64>") */
  authHeader?: string;
  /** Signer instance for automatic retry upon 401/403 challenge */
  signer?: NostrSignerLike;
  /** Download progress callback reporting bytes received and total */
  onProgress?: (bytesReceived: number, totalBytes: number) => void;
  /** AbortSignal for user cancellation */
  signal?: AbortSignal;
  /** Request timeout in milliseconds (defaults to 60,000ms) */
  timeoutMs?: number;
}

export interface FetchAndDecryptOptions {
  /** Nostr signer for Kind 24242 authentication */
  signer?: NostrSignerLike;
  /** High-level workflow progress callback */
  onProgress?: (progress: DecryptionProgress) => void;
  /** AbortSignal for user cancellation */
  signal?: AbortSignal;
}

/**
 * Normalizes and strips trailing slashes from Blossom server URLs.
 */
function cleanServerUrl(server: string): string {
  return server.trim().replace(/\/+$/, "");
}

/**
 * Downloads a raw binary blob from a Blossom server.
 * Handles timeouts, network errors, 404 missing blobs, streaming progress,
 * and 401/403 challenge-response authorization via Kind 24242 Nostr events.
 */
export async function fetchBlossomBlob(
  server: string,
  hash: string,
  options?: FetchBlobOptions,
): Promise<Uint8Array> {
  const cleanServer = cleanServerUrl(server);
  const cleanHash = hash.trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(cleanHash)) {
    throw new DriveImportError(
      "INVALID_HASH_FORMAT",
      `Invalid blob hash: must be 64 hexadecimal characters, got "${hash}"`,
      "Check file hash in link",
      "Invalid File Hash",
      "hash",
    );
  }

  if (options?.signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  const url = `${cleanServer}/${cleanHash}`;
  const headers: Record<string, string> = {};
  if (options?.authHeader) {
    headers["Authorization"] = options.authHeader;
  }

  let response: Response;
  const timeoutMs = options?.timeoutMs ?? 60000;

  try {
    // Create timeout signal linked to caller's abort signal
    const controller = new AbortController();
    const timerId = setTimeout(() => {
      controller.abort(new DOMException(`Blossom request timed out after ${timeoutMs}ms`, "TimeoutError"));
    }, timeoutMs);

    const onAbort = () => controller.abort(options?.signal?.reason);
    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timerId);
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  } catch (error) {
    if (options?.signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new DriveImportError(
        "NETWORK_ERROR",
        `Request to ${cleanServer} timed out after ${timeoutMs / 1000} seconds`,
        "Storage server is slow or unresponsive. Please retry.",
        "Network Connection Error",
        "server",
      );
    }
    if (error instanceof TypeError) {
      throw new DriveImportError(
        "NETWORK_ERROR",
        `Failed to connect to storage server at ${cleanServer}. The server may be offline or blocking requests (CORS error).`,
        "Check network connection or try an alternate server",
        "Network Connection Error",
        "server",
      );
    }
    throw error;
  }

  // Handle 401 Unauthorized / 403 Forbidden with automatic Nostr Kind 24242 retry
  if ((response.status === 401 || response.status === 403) && options?.signer && !options?.authHeader) {
    try {
      const authHeader = await createKind24242AuthHeader(options.signer, cleanHash, "get");
      return await fetchBlossomBlob(server, hash, {
        ...options,
        authHeader, // Retry once with signed auth header
      });
    } catch (authError) {
      if (authError instanceof DriveImportError) throw authError;
      throw new DriveImportError(
        "BLOSSOM_AUTH_FAILED",
        `Blossom authorization failed for server ${cleanServer}: ${authError instanceof Error ? authError.message : String(authError)}`,
        "Nostr authorization denied or failed",
        "Authorization Failed",
        "auth",
      );
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw new DriveImportError(
      "BLOSSOM_AUTH_REQUIRED",
      `Storage server ${cleanServer} requires authorization to download this file (HTTP ${response.status})`,
      "Please connect your Nostr account with access permissions",
      "Authorization Required",
      "auth",
    );
  }

  if (response.status === 404) {
    throw new DriveImportError(
      "BLOB_NOT_FOUND",
      `File blob "${cleanHash}" not found on storage server ${cleanServer} (HTTP 404)`,
      "The file may have been deleted or expired on the server",
      "File Not Found",
      "hash",
    );
  }

  if (!response.ok) {
    throw new DriveImportError(
      "NETWORK_ERROR",
      `Storage server ${cleanServer} returned HTTP error ${response.status}: ${response.statusText || "Unknown error"}`,
      "Server error occurred. Please try again later.",
      "Network Connection Error",
      "server",
    );
  }

  // Stream body with onProgress reporting if body reader is available
  if (options?.onProgress && response.body) {
    const totalBytes = Number(response.headers.get("content-length")) || 0;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      if (options?.signal?.aborted) {
        await reader.cancel();
        throw new DOMException("Download aborted", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      if (value && value.length > 0) {
        chunks.push(value);
        received += value.length;
        options.onProgress(received, totalBytes);
      }
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  const arrayBuf = await response.arrayBuffer();
  return new Uint8Array(arrayBuf);
}

/**
 * End-to-end driver: fetches all required blobs from Blossom (single-blob or multi-chunk),
 * decrypts them using the configured cipher, reassembles chunks, and verifies SHA-256 hash.
 */
export async function fetchAndDecryptDriveFile(
  payload: NormalizedDrivePayload,
  options?: FetchAndDecryptOptions,
): Promise<DecryptedDriveFile> {
  const signal = options?.signal;
  const onProgress = options?.onProgress;

  if (signal?.aborted) {
    throw new DOMException("Download aborted", "AbortError");
  }

  onProgress?.({
    stage: "parsing",
    chunksCompleted: 0,
    totalChunks: payload.chunks?.length || 1,
    bytesReceived: 0,
    totalBytes: payload.size,
  });

  const isMultiChunk = Array.isArray(payload.chunks) && payload.chunks.length > 0;

  if (!isMultiChunk) {
    // Single-blob layout
    const targetHash = payload.blobHash;
    if (!targetHash) {
      throw new DriveImportError(
        "MISSING_REQUIRED_FIELD",
        "Payload does not specify a blobHash or chunks array",
        "Invalid file link",
        "Incomplete File Details",
        "blobHash",
      );
    }

    onProgress?.({
      stage: "fetching",
      chunksCompleted: 0,
      totalChunks: 1,
      bytesReceived: 0,
      totalBytes: payload.size,
    });

    const blob = await fetchBlossomBlob(payload.server, targetHash, {
      signer: options?.signer,
      signal,
      onProgress: (received, total) => {
        onProgress?.({
          stage: "fetching",
          chunksCompleted: 0,
          totalChunks: 1,
          bytesReceived: received,
          totalBytes: total || payload.size,
        });
      },
    });

    onProgress?.({
      stage: "decrypting",
      chunksCompleted: 0,
      totalChunks: 1,
      bytesReceived: blob.length,
      totalBytes: payload.size,
    });

    const decryptedFile = await decryptDrivePayload(payload, blob);

    onProgress?.({
      stage: "complete",
      chunksCompleted: 1,
      totalChunks: 1,
      bytesReceived: blob.length,
      totalBytes: payload.size,
    });

    return decryptedFile;
  }

  // Multi-chunk layout
  const chunkRefs = payload.chunks!;
  const totalChunks = chunkRefs.length;
  const fetchedBlobs: Uint8Array[] = [];
  let accumulatedBytes = 0;

  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }

    const chunkRef = chunkRefs[i];
    const chunkServer = chunkRef.server || payload.server;

    onProgress?.({
      stage: "fetching",
      chunksCompleted: i,
      totalChunks,
      bytesReceived: accumulatedBytes,
      totalBytes: payload.size,
    });

    const chunkBlob = await fetchBlossomBlob(chunkServer, chunkRef.hash, {
      signer: options?.signer,
      signal,
      onProgress: (received) => {
        onProgress?.({
          stage: "fetching",
          chunksCompleted: i,
          totalChunks,
          bytesReceived: accumulatedBytes + received,
          totalBytes: payload.size,
        });
      },
    });

    fetchedBlobs.push(chunkBlob);
    accumulatedBytes += chunkBlob.length;
  }

  onProgress?.({
    stage: "decrypting",
    chunksCompleted: totalChunks,
    totalChunks,
    bytesReceived: accumulatedBytes,
    totalBytes: payload.size,
  });

  const decryptedFile = await decryptDrivePayload(payload, fetchedBlobs);

  onProgress?.({
    stage: "complete",
    chunksCompleted: totalChunks,
    totalChunks,
    bytesReceived: accumulatedBytes,
    totalBytes: payload.size,
  });

  return decryptedFile;
}
