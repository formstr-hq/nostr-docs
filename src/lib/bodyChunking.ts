import type { JSONContent } from "@tiptap/core";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { sha256Hex } from "../utils/fileEncryption";
import {
  fetchEncryptedBytes,
  uploadEncryptedBytes,
  type EncryptedBlobRef,
} from "./encryptedBlob";
import {
  parseDocumentContent,
  richDocumentToPlainText,
  serializeRichDocument,
  serializeRichDocumentManifest,
  type BodyChunkRef,
  type BodyManifest,
  type OoxmlSource,
  type ParsedDocumentContent,
} from "./documentFormat";

/** Keep inline while the serialized envelope is comfortably below relay caps. */
export const INLINE_ENVELOPE_LIMIT = 72_000;

const CHUNK_MIN = 16 * 1024;
const CHUNK_MAX = 256 * 1024;
const CHUNK_MASK = 0xffff; // ~64 KiB average with a content-defined boundary

export interface PreparedRichDocument {
  content: string;
  bodyManifest?: BodyManifest;
  blossomKey?: string;
}

function titleAndPreview(doc: JSONContent): { title: string; preview: string } {
  const text = richDocumentToPlainText(doc);
  const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
  return {
    title: firstLine.trim().slice(0, 120),
    preview: text.replace(/\s+/g, " ").trim().slice(0, 500),
  };
}

/**
 * Content-defined chunking. Fixed-size chunks shift every boundary after an
 * edit; a rolling hash keeps unchanged chunks stable so edits only replace the
 * chunks that actually changed.
 */
export function chunkBytes(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  let hash = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    hash = (((hash << 1) + hash + bytes[index]) >>> 0) >>> 0;
    const size = index - start + 1;
    const boundary =
      size >= CHUNK_MIN && (hash & CHUNK_MASK) === 0;
    const atEnd = index === bytes.length - 1;
    if (boundary || size >= CHUNK_MAX || atEnd) {
      chunks.push(bytes.slice(start, index + 1));
      start = index + 1;
      hash = 0;
    }
  }

  return chunks;
}

function bodyBytes(doc: JSONContent): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ format: "prosemirror-json-body", version: 1, doc }),
  );
}

function previousChunkMap(previous?: BodyManifest): Map<string, BodyChunkRef> {
  const map = new Map<string, BodyChunkRef>();
  for (const chunk of previous?.chunks ?? []) {
    if (chunk.plainHash && chunk.plainSize != null) {
      map.set(`${chunk.plainHash}:${chunk.plainSize}`, chunk);
    }
  }
  return map;
}

/**
 * Store a rich document inline when small, or as encrypted content-defined
 * Blossom chunks when large. Chunk refs are reused when their plaintext hash is
 * unchanged, so autosave only uploads changed chunks.
 */
export async function prepareRichDocumentForStorage(
  doc: JSONContent,
  options: {
    ooxml?: OoxmlSource;
    servers: string[];
    localOnly?: boolean;
    previous?: BodyManifest;
    blossomKey?: string;
  },
): Promise<PreparedRichDocument> {
  const inline = serializeRichDocument(doc, options.ooxml);
  const inlineBytes = new TextEncoder().encode(inline).byteLength;

  // Local-only pages never leave the device. Once a published page has been
  // promoted to chunked storage, keep it there even if it later shrinks; this
  // avoids oscillating around the threshold and invalidating readers/caches.
  if (options.localOnly || options.servers.length === 0) {
    return { content: inline };
  }
  if (!options.previous && inlineBytes <= INLINE_ENVELOPE_LIMIT) {
    return { content: inline };
  }

  const blossomKey =
    options.blossomKey ?? bytesToHex(generateSecretKey());
  const authSecret = hexToBytes(blossomKey);
  const previous = previousChunkMap(options.previous);
  const chunks = chunkBytes(bodyBytes(doc));
  const refs: BodyChunkRef[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const plainHash = await sha256Hex(chunk);
    const plainSize = chunk.byteLength;
    const reusable = previous.get(`${plainHash}:${plainSize}`);
    if (reusable) {
      refs.push({ ...reusable, plainHash, plainSize });
      continue;
    }
    const ref: EncryptedBlobRef = await uploadEncryptedBytes(
      options.servers,
      chunk,
      "application/json",
      `page-body-${index}.json`,
      authSecret,
    );
    refs.push({ ...ref, plainHash, plainSize });
  }

  const { title, preview } = titleAndPreview(doc);
  const bodyManifest: BodyManifest = {
    version: 1,
    chunks: refs,
    plaintextBytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  };

  return {
    content: serializeRichDocumentManifest({
      title,
      preview,
      bodyManifest,
      ooxml: options.ooxml,
      blossomKey,
    }),
    bodyManifest,
    blossomKey,
  };
}

/** Resolve a chunked body into the canonical rich document. */
export async function resolveRichDocument(
  raw: string,
): Promise<ParsedDocumentContent> {
  const parsed = parseDocumentContent(raw);
  if (parsed.kind !== "rich" || !parsed.bodyManifest) return parsed;

  const parts = await Promise.all(
    parsed.bodyManifest.chunks.map((chunk) => fetchEncryptedBytes(chunk)),
  );
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }

  const decoded = JSON.parse(new TextDecoder().decode(body)) as {
    doc?: JSONContent;
  };
  if (!decoded.doc) throw new Error("Stored page body is missing its document");
  return { ...parsed, doc: decoded.doc };
}
