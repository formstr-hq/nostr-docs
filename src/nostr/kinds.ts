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
 * Decentrallized Collaboration Invite.
 * Used as a NIP-17 Rumor Kind to send document access to other accounts.
 */
export const KIND_SHARE_INVITE = 211234;
