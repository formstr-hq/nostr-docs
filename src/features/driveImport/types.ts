/**
 * src/features/driveImport/types.ts
 * Canonical types and schemas for Formstr Drive payload ingestion and normalization.
 */

/**
 * Supported symmetric encryption ciphers:
 * - 'nip-fs-segment-v1': Modern NIP-FS segment cipher. Contiguous blob of 64KB segments,
 *   each encrypted with AES-256-GCM using raw conversation key and 12-byte counter nonce.
 * - 'nip44-v2': Legacy single-blob or multi-chunk cipher. 0x02 || nonce(32) || ciphertext,
 *   with AES-256-GCM key and IV derived via HKDF-SHA256.
 */
export type CipherType = "nip-fs-segment-v1" | "nip44-v2";

/**
 * Reference to an individual chunk in a multi-chunk file.
 */
export interface ChunkRef {
  /** SHA-256 hex string (64 characters) of chunk blob */
  hash: string;
  /** Size in bytes of this individual chunk blob (optional) */
  size?: number;
  /** Blossom server URL override for this chunk (optional) */
  server?: string;
}

/**
 * Raw inbound payload representation accommodating all format variations,
 * alias field names, and loose typing from deep link URLs.
 */
export interface DriveImportPayload {
  /** Primary Blossom server URL */
  server?: string;
  /** Legacy server array */
  servers?: string[];

  /** Blob SHA-256 hash (single-blob layout) */
  hash?: string;
  blobHash?: string;

  /** Chunk references (multi-chunk layout) - array of 64-hex strings or ChunkRef objects */
  chunks?: Array<string | ChunkRef>;

  /** Private decryption key (hex string) */
  key?: string;
  encryptionKey?: string;
  k?: string;

  /** Cipher identifier */
  cipher?: CipherType | string;
  encryptionAlgorithm?: string;

  /** File metadata */
  name?: string;
  type?: string;
  mimeType?: string;
  size?: number | string;
  chunkSize?: number | string;
  unencryptedFileHash?: string;
}

/**
 * Canonical normalized payload schema.
 * All downstream modules (M2 decryption, M3 TipTap import, M4 media previews)
 * rely exclusively on this strictly typed contract.
 */
export interface NormalizedDrivePayload {
  /** Canonical Blossom server URL (without trailing slash) */
  server: string;
  /** Single blob SHA-256 hash (if single-blob layout) */
  blobHash?: string;
  /** Array of resolved chunk references (if multi-chunk layout) */
  chunks?: ChunkRef[];
  /** 32-byte private key as 64-character lowercase hex string */
  privateKeyHex: string;
  /** Validated cipher type */
  cipher: CipherType;
  /** Guaranteed non-empty filename */
  name: string;
  /** Normalized lowercase MIME type */
  mimeType: string;
  /** Total file size in bytes (defaults to 0 if unknown) */
  size: number;
  /** Segment size in bytes (defaults to 65536) */
  chunkSize: number;
  /** Optional SHA-256 hash of unencrypted plaintext for post-decryption verification */
  unencryptedFileHash?: string;
}

/**
 * Structured ingestion error codes.
 */
export type IngestionErrorCode =
  | "MISSING_PAYLOAD"
  | "NO_PAYLOAD_FOUND"
  | "MALFORMED_URL"
  | "INVALID_URL"
  | "URI_DECODE_ERROR"
  | "EMPTY_PAYLOAD"
  | "MALFORMED_BASE64"
  | "INVALID_JSON"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_KEY_FORMAT"
  | "INVALID_SERVER_URL"
  | "INVALID_HASH_FORMAT"
  | "UNSUPPORTED_CIPHER"
  | "INVALID_NUMERIC_FIELD"
  | "CORRUPTED_CHUNKS_ARRAY"
  | "DECRYPTION_FAILED"
  | "INTEGRITY_CHECK_FAILED"
  | "BLOB_NOT_FOUND"
  | "BLOSSOM_AUTH_REQUIRED"
  | "BLOSSOM_AUTH_FAILED"
  | "NETWORK_ERROR"
  | "CORRUPTED_SEGMENT"
  | "STREAM_TRUNCATED"
  | "DOWNLOAD_ABORTED"
  | "CORRUPTED_DOCUMENT"
  | "UNSUPPORTED_DOCUMENT_FORMAT";

/**
 * Decrypted drive file content and metadata ready for document import or preview.
 */
export interface DecryptedDriveFile {
  /** Complete plaintext bytes of decrypted file */
  data: Uint8Array;
  /** Preserved or normalized file name */
  name: string;
  /** Preserved or detected MIME type */
  mimeType: string;
  /** Total byte length */
  size: number;
  /** Original normalized payload for provenance */
  originalPayload: NormalizedDrivePayload;
}

/**
 * Progression stages for multi-step download and decryption workflow.
 */
export type DecryptionProgressStage =
  | "parsing"
  | "fetching"
  | "decrypting"
  | "reassembling"
  | "verifying"
  | "complete"
  | "error";

/**
 * Real-time progress metrics for UI indicators.
 */
export interface DecryptionProgress {
  stage: DecryptionProgressStage;
  chunksCompleted: number;
  totalChunks: number;
  bytesReceived: number;
  totalBytes: number;
  errorMessage?: string;
}

/**
 * Minimal Nostr signer interface compatible with @formstr/signer, window.nostr,
 * and custom test signers.
 */
export interface NostrSignerLike {
  getPublicKey(): Promise<string>;
  signEvent(event: {
    kind: number;
    tags: string[][];
    content: string;
    created_at: number;
    pubkey?: string;
  }): Promise<{
    id?: string;
    sig?: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  }>;
}

/**
 * High-level classification categories for shared Drive files.
 */
export type FileTypeCategory =
  | "document"
  | "media-image"
  | "media-video"
  | "media-audio"
  | "media-pdf"
  | "generic-binary";

/**
 * Document subtypes the importer can convert.
 */
export type DocumentSubtype = "markdown" | "text" | "html" | "docx" | "unknown";

/**
 * Comprehensive classification descriptor used by UI routers and preview components.
 */
export interface FileClassification {
  /** Top-level category directing view routing */
  category: FileTypeCategory;
  /** Document subtype for converters */
  documentSubtype?: DocumentSubtype;
  /** True if format can be imported into collaborative document editor */
  isDocument: boolean;
  /** True if format is interactive media (image, video, audio, pdf) */
  isMedia: boolean;
  /** True if format can be previewed in-app without downloading */
  isPreviewable: boolean;
  /** Recommended primary user action */
  primaryAction: "import" | "preview" | "download";
  /** Human-readable button label */
  actionLabel: string;
  /** Resolved lowercase file extension (without leading dot) */
  fileExtension: string;
  /** Normalized lowercase MIME type */
  normalizedMimeType: string;
}

/**
 * Result of converting a Drive document: what the reader shows and what the editor saves.
 */
export interface DocumentImportResult {
  /** Unique collaborative document identifier */
  docId: string;
  /** Sanitized display title extracted from file name */
  title: string;
  /** Primary format representation */
  format: "markdown" | "html" | "text";
  /** Sanitized HTML for the reader */
  htmlContent: string;
  /** Markdown the Pages editor stores documents as (title heading first) */
  markdown: string;
  /** Normalized raw text content */
  rawText: string;
  /** Original file name */
  sourceFileName: string;
  /** Original MIME type */
  sourceMimeType: string;
  /** Total characters in text content */
  characterCount: number;
  /** Total words in text content */
  wordCount: number;
  /** Import timestamp (unix ms) */
  createdAt: number;
}

/**
 * Alias for IngestionErrorCode.
 */
export type DriveImportErrorCode = IngestionErrorCode;

/**
 * Structured details returned by DriveImportError.toJSON().
 * Never exposes raw secret keys or sensitive material.
 */
export interface DriveImportErrorDetails {
  code: IngestionErrorCode;
  field?: string;
  title: string;
  description: string;
  actionGuidance: string;
  actionableGuidance: string;
}

/**
 * Custom error class for all payload ingestion, decoding, and validation failures.
 * Encapsulates technical error codes and user-facing recovery guidance.
 */
export class DriveImportError extends Error {
  readonly code: IngestionErrorCode;
  readonly field?: string;
  readonly title: string;
  readonly description: string;
  readonly actionGuidance: string;
  readonly actionableGuidance: string;

  constructor(
    code: IngestionErrorCode,
    message: string,
    actionGuidance?: string,
    title?: string,
    field?: string
  ) {
    super(message);
    this.name = "DriveImportError";
    this.code = code;
    this.field = field;
    this.description = message;
    this.actionGuidance = actionGuidance ?? "Back to docs";
    this.actionableGuidance = this.actionGuidance;

    if (title) {
      this.title = title;
    } else {
      switch (code) {
        case "MISSING_PAYLOAD":
        case "NO_PAYLOAD_FOUND":
        case "EMPTY_PAYLOAD":
          this.title = "No File Found";
          break;
        case "MALFORMED_URL":
        case "INVALID_URL":
          this.title = "Invalid Link Structure";
          break;
        case "URI_DECODE_ERROR":
          this.title = "Corrupted Link Characters";
          break;
        case "MALFORMED_BASE64":
          this.title = "Damaged Share Link";
          break;
        case "INVALID_JSON":
          this.title = "Invalid File Descriptor";
          break;
        case "MISSING_REQUIRED_FIELD":
          this.title = "Incomplete File Details";
          break;
        case "INVALID_SERVER_URL":
          this.title = "Invalid Blossom Server";
          break;
        case "INVALID_KEY_FORMAT":
          this.title = "Invalid Decryption Key";
          break;
        case "INVALID_HASH_FORMAT":
          this.title = "Invalid File Hash";
          break;
        case "UNSUPPORTED_CIPHER":
          this.title = "Unsupported Encryption";
          break;
        case "INVALID_NUMERIC_FIELD":
          this.title = "Invalid File Size";
          break;
        case "CORRUPTED_CHUNKS_ARRAY":
          this.title = "Invalid Multi-Chunk Data";
          break;
        case "DECRYPTION_FAILED":
          this.title = "Decryption Failed";
          break;
        case "INTEGRITY_CHECK_FAILED":
          this.title = "Integrity Verification Failed";
          break;
        case "BLOB_NOT_FOUND":
          this.title = "File Not Found";
          break;
        case "BLOSSOM_AUTH_REQUIRED":
          this.title = "Authorization Required";
          break;
        case "BLOSSOM_AUTH_FAILED":
          this.title = "Authorization Failed";
          break;
        case "NETWORK_ERROR":
          this.title = "Network Connection Error";
          break;
        case "CORRUPTED_SEGMENT":
          this.title = "Corrupted File Segment";
          break;
        case "STREAM_TRUNCATED":
          this.title = "Download Interrupted";
          break;
        case "DOWNLOAD_ABORTED":
          this.title = "Download Cancelled";
          break;
        case "CORRUPTED_DOCUMENT":
          this.title = "Corrupted Document";
          break;
        case "UNSUPPORTED_DOCUMENT_FORMAT":
          this.title = "Unsupported Document";
          break;
        default:
          this.title = "Unable to Open Shared File";
          break;
      }
    }

    Object.setPrototypeOf(this, DriveImportError.prototype);
  }

  /**
   * Safe JSON representation for logging, telemetry, or UI display.
   * Strictly avoids private key leakage.
   */
  toJSON(): DriveImportErrorDetails {
    return {
      code: this.code,
      field: this.field,
      title: this.title,
      description: this.description,
      actionGuidance: this.actionGuidance,
      actionableGuidance: this.actionableGuidance,
    };
  }
}

/**
 * Backward compatibility alias for DriveImportError.
 */
export { DriveImportError as IngestionError };

/**
 * Result returned by ingestion parser functions.
 * Provides both boolean `ok` and `success` properties for universal interoperability.
 */
export type ParseResult =
  | {
      ok: true;
      success: true;
      payload: NormalizedDrivePayload;
    }
  | {
      ok: false;
      success: false;
      error: DriveImportError;
    };
