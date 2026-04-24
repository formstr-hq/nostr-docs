// src/nostr/kinds.ts

/**
 * Replaceable parameterized event containing the FULL Markdown file.
 * Uses tag: ["d", <docId>]
 */
export const KIND_FILE = 33457;

/**
 * Ephemeral CRDT update events.
 * These contain base64-encoded Yjs updates.
 */
export const KIND_CRDT_OP = 22457;

/**
 * Per-document metadata event (tags/labels for organizing notes).
 * Uses tag: ["d", <address>] where address = "33457:pubkey:dtag"
 * Content is NIP-44 encrypted JSON: { tags: string[] }
 */
export const KIND_DOC_METADATA = 34579;

/**
 * Private encrypted inline comment anchored to a document.
 * Non-replaceable: comments accumulate.
 * Content is NIP-44 encrypted (viewKey conversation key) flat tag array.
 */
export const KIND_COMMENT = 1494;

/**
 * Poll event (NIP-88 style usage as implemented by Pollerama).
 */
export const KIND_POLL = 1068;

/**
 * Poll response event kinds.
 * 1018 is the primary kind in Pollerama; 1070 is legacy/alternate support.
 */
export const KIND_POLL_RESPONSE = 1018;
export const KIND_POLL_RESPONSE_ALT = 1070;
