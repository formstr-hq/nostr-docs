// src/nostr/relayPresence.ts
//
// Per-relay presence checks for a page: "which of my relays actually hold this
// document?". The normal read path goes through the local relay (which
// aggregates relays and hides provenance), so this is an explicit *diagnostics*
// query — it asks each relay individually and reports who answers.
//
// Used by the page cards (AllPagesView) and the editor to show relay coverage
// and to offer a re-broadcast when a page is missing everywhere.

import type { Event } from "nostr-tools";
import { pool } from "./relayPool";

/** Address filter for a replaceable page, or an id filter for anything else. */
function presenceFilter(event: Event) {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  return dTag
    ? { kinds: [event.kind], authors: [event.pubkey], "#d": [dTag] }
    : { ids: [event.id] };
}

/** Stable cache key: the address for replaceable pages, else the event id. */
function presenceKey(event: Event): string {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  return dTag ? `${event.kind}:${event.pubkey}:${dTag}` : event.id;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { relays: string[]; at: number }>();

// Bound total concurrent relay queries so a grid full of cards can't open a
// socket per relay at once.
const MAX_CONCURRENT = 4;
let active = 0;
const waiters: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

/**
 * Which of `relays` currently hold `event`. Results are cached briefly (60s) so
 * a re-render or hover doesn't re-query; pass `{ force: true }` to bypass (e.g.
 * after a re-broadcast).
 */
export async function checkRelayPresence(
  event: Event,
  relays: string[],
  opts?: { timeoutMs?: number; force?: boolean },
): Promise<string[]> {
  const key = presenceKey(event);
  const cached = cache.get(key);
  if (!opts?.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.relays;
  }

  const filter = presenceFilter(event);
  const timeoutMs = opts?.timeoutMs ?? 5000;

  const results = await Promise.all(
    relays.map((relay) =>
      withSlot(async () => {
        try {
          const events = await pool.querySync([relay], filter, {
            maxWait: timeoutMs,
          });
          return events.length > 0 ? relay : null;
        } catch {
          return null;
        }
      }),
    ),
  );

  const present = results.filter((r): r is string => r !== null);
  cache.set(key, { relays: present, at: Date.now() });
  return present;
}

/** Drop cached presence (e.g. after re-broadcast, or on relay set change). */
export function clearRelayPresence(event?: Event): void {
  if (event) cache.delete(presenceKey(event));
  else cache.clear();
}

/** Bare host for display: "wss://relay.damus.io" → "relay.damus.io". */
export function relayHost(relay: string): string {
  try {
    return new URL(relay).host;
  } catch {
    return relay.replace(/^wss?:\/\//, "");
  }
}
