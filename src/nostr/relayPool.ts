// src/nostr/relayPool.ts

import { SimplePool } from "nostr-tools";

/**
 * A small wrapper so the rest of the app doesn't directly depend on SimplePool.
 * Allows us to swap transport (e.g., Blossom later) without rewriting components.
 */

/**
 * Relays the app reads/writes by default. In production this is the hardcoded
 * list below. For e2e tests we point the whole app at a local in-memory relay
 * by setting VITE_DEFAULT_RELAYS (comma-separated) — it is unset in production,
 * so this has no effect on real builds.
 */
const relayOverride = import.meta.env.VITE_DEFAULT_RELAYS as string | undefined;

export const DEFAULT_RELAYS = relayOverride
  ? relayOverride.split(",").map((r) => r.trim()).filter(Boolean)
  : [
      "wss://relay.damus.io",
      "wss://relay.primal.net",
      "wss://nos.lol",
    ];

export const pool = new SimplePool();

/** True if at least one of the given relays currently has an open connection. */
export function hasLiveRelayConnectivity(relays: string[]): boolean {
  const status = pool.listConnectionStatus();
  return relays.some((url) => status.get(url));
}
