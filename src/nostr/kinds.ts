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
