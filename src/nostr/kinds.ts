// src/nostr/kinds.ts

/**
 * Legacy encrypted document: NIP-44-encrypted Markdown.
 *
 * Kept for backward compatibility. Existing pages and public/shared links use
 * this kind, and we must never change the meaning of its `content` field.
 * Uses tag: ["d", <docId>].
 */
export const KIND_FILE = 33457;

/**
 * Rich encrypted document: NIP-44-encrypted ProseMirror JSON.
 *
 * This is the default for new documents going forward. The content is a
 * versioned payload:
 *
 *   { "format": "prosemirror-json", "version": 1, "doc": <ProseMirror JSON> }
 *
 * Same addressing as KIND_FILE: ["d", <docId>] plus the capability-derived
 * ["a", <room>] tag for shared documents. KIND_FILE remains readable (and
 * writable for legacy pages) so old links and other clients keep working.
 */
export const KIND_RICH_DOCUMENT = 33458;

/** Every kind that stores an editable document body. */
export const DOCUMENT_KINDS = [KIND_FILE, KIND_RICH_DOCUMENT] as const;

export function isDocumentKind(kind: number): boolean {
  return kind === KIND_FILE || kind === KIND_RICH_DOCUMENT;
}

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
 * Binds a per-tab collaboration session key to the real pubkey behind it. This
 * event is NOT published; it is the token embedded in the (viewKey-encrypted)
 * payload of each CRDT op / presence event, so relays never see the real key.
 * Uses tag: ["d", "<room>:<sessionPubkey>"]
 * Content is plaintext JSON { realPubkey, expiresAt } (it is already inside an
 * encrypted payload).
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
