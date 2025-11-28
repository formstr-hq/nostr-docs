// src/nostr/relayPool.ts

import { SimplePool } from "nostr-tools";

/**
 * A small wrapper so the rest of the app doesn't directly depend on SimplePool.
 * Allows us to swap transport (e.g., Blossom later) without rewriting components.
 */

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

export const pool = new SimplePool();
