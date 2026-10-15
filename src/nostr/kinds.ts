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
 * Ephemeral presence/awareness events (cursor position, active collaborators).
 * Content is NIP-44 encrypted (viewKey conversation key) base64-encoded
 * y-protocols/awareness updates. Signed by a per-tab session key. Uses
 * tag: ["a", <root address>].
 */
export const KIND_PRESENCE = 24578;

/**
 * Per-author durable Yjs checkpoint for a v2 shared document. Parameterised
 * replaceable on (author, d) where d = the document's root address.
 * Content is NIP-44 encrypted (viewKey) base64 of a Yjs state update. Kept in a
 * dedicated kind so kind 33457 content stays plain Markdown (no format change).
 */
export const KIND_YJS_CHECKPOINT = 34582;

/**
 * Binds a per-tab collaboration session key to the real pubkey behind it, so
 * collaborators can be identified despite live ops being signed by the session
 * key. Addressable (must remain discoverable). Signed by the real signer.
 * Uses tag: ["d", "<root address>:<sessionPubkey>"]
 * Content is NIP-44 encrypted (viewKey conversation key) JSON:
 * { realPubkey: string, expiresAt: number }
 */
export const KIND_SESSION_ATTESTATION = 34581;

/**
 * Private encrypted inline comment anchored to a document.
 * Non-replaceable: comments accumulate.
 * Content is NIP-44 encrypted (viewKey conversation key) flat tag array.
 */
export const KIND_COMMENT = 1494;

/**
 * Parameterized replaceable resolution state for a comment.
 * One resolution per (pubkey, d-tag) pair — latest event wins.
 * Uses tag: ["d", <commentEventId>]
 */
export const KIND_COMMENT_RESOLUTION = 34580;
