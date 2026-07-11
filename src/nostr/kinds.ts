// src/nostr/kinds.ts

/**
 * Replaceable parameterized event containing the FULL Markdown file.
 * Uses tag: ["d", <docId>]
 */
export const KIND_FILE = 33457;

/**
 * Ephemeral CRDT update events.
 * Content is NIP-44 encrypted (editKey conversation key) base64-encoded
 * y-protocols/sync wire messages (sync-step1/2 or update). Signed by a
 * per-tab session key, not the real signer. Uses tag: ["a", <docAddress>]
 * where docAddress = "33457:pubkey:dtag".
 */
export const KIND_CRDT_OP = 22457;

/**
 * Ephemeral presence/awareness events (cursor position, active collaborators).
 * Content is NIP-44 encrypted (editKey conversation key) base64-encoded
 * y-protocols/awareness updates. Signed by a per-tab session key. Uses tag:
 * ["a", <docAddress>] where docAddress = "33457:pubkey:dtag".
 */
export const KIND_PRESENCE = 24578;

/**
 * Per-document metadata event (tags/labels for organizing notes).
 * Uses tag: ["d", <address>] where address = "33457:pubkey:dtag"
 * Content is NIP-44 encrypted JSON: { tags: string[] }
 */
export const KIND_DOC_METADATA = 34579;

/**
 * Binds an ephemeral collaboration session key to the real pubkey behind it,
 * so collaborators can be identified/resolved to a profile despite live
 * CRDT ops and presence being signed by the session key, not the real key.
 * Addressable (not ephemeral): must remain discoverable by clients joining
 * a session after it was published. Signed by the real signer.
 * Uses tag: ["d", "<docAddress>:<sessionPubkey>"]
 * Content is NIP-44 encrypted (editKey conversation key) JSON:
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
