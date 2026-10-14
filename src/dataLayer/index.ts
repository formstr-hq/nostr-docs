/**
 * nostr-docs data layer.
 *
 * The single transport for the app. Everything network-facing goes through a
 * `@formstr/local-relay` Web Worker "local relay": components declare interests
 * (`observe`) and `publish`, and the worker owns every connection decision.
 * This replaces the imperative `SimplePool` in `src/nostr/relayPool.ts`.
 *
 * Initialised lazily on first use so importing this module never spawns a
 * worker (keeps tests/SSR safe). If the worker fails to boot we fall back to
 * the plain `SimplePool` so the app keeps working (see `usingFallback`).
 */
import {
  DataLayer,
  LocalRelayClient,
  workerChannel,
  setDataLayer as installDataLayer,
  type Channel,
  type Event as RelayEvent,
  type Filter,
} from "@formstr/local-relay";
import type { Event as NostrEvent, EventTemplate } from "nostr-tools";
import { signerManager } from "../signer";
import { DEFAULT_RELAYS, pool } from "../nostr/relayPool";
import { runLegacyMigration } from "./migration";

export type { Filter };
export type Event = NostrEvent;

/** A disposable subscription — the `close()` twin of an `ObserveHandle`. */
export interface Subscription {
  close: () => void;
}

// ── Boot state ──────────────────────────────────────────────────────────────

let instance: DataLayer | null = null;
let client: LocalRelayClient | null = null;
let bootError: string | null = null;
let usingFallback = false;
let hydrated = false;

const hydratedListeners = new Set<() => void>();

/** Sign a worker-initiated (NIP-42 AUTH) template. Reads must not prompt login. */
const signForAuth = async (template: EventTemplate): Promise<RelayEvent | null> => {
  if (!signerManager.hasSigner()) return null;
  try {
    const signer = await signerManager.getSigner();
    return (await signer.signEvent(template)) as RelayEvent;
  } catch {
    return null;
  }
};

/** Sign a template for publishing — may prompt login (write path). */
const signForPublish = async (template: EventTemplate): Promise<RelayEvent> => {
  const signer = await signerManager.getSigner();
  return (await signer.signEvent(template)) as RelayEvent;
};

function createInstance(): DataLayer {
  const worker = new Worker(new URL("./relay.worker.ts", import.meta.url), {
    type: "module",
  });

  // Watch the worker boundary for boot signals (`hydrated` / `bootError`) that
  // sit outside the nostr protocol; everything else is passed to the client.
  const base = workerChannel(worker);
  const channel: Channel = {
    post: (m) => base.post(m),
    close: () => base.close(),
    onMessage: (handler) =>
      base.onMessage((m) => {
        const kind = (m as { kind?: string } | null)?.kind;
        if (kind === "hydrated") {
          hydrated = true;
          hydratedListeners.forEach((cb) => cb());
        } else if (kind === "bootError") {
          bootError = (m as { message?: string }).message ?? "unknown";
          console.error("[dataLayer] local relay failed to start:", bootError);
        }
        handler(m);
      }),
  };

  worker.onerror = (e) => {
    bootError = e.message || "worker error";
    console.error("[dataLayer] local relay worker error:", bootError);
  };

  const relayClient = new LocalRelayClient(channel, { onSignRequest: signForAuth });
  client = relayClient;
  relayClient.setUserRelays(DEFAULT_RELAYS);

  const dataLayer = new DataLayer({ client: relayClient, sign: signForPublish });
  installDataLayer(dataLayer);

  // Keep the worker's scope pointed at the active account, retargeting only on a
  // real pubkey change (signerManager fires several notifies per login/unlock).
  let lastActivePubkey: string | null | undefined = undefined;
  const applyActiveAccount = () => {
    const pubkey = signerManager.getActiveAccount()?.pubkey ?? null;
    if (pubkey === lastActivePubkey) return;
    lastActivePubkey = pubkey;
    relayClient.setActiveAccount(pubkey);
  };
  applyActiveAccount();
  signerManager.onChange(applyActiveAccount);

  // Non-destructive, one-time seed of the local relay from the legacy store.
  void runLegacyMigration(dataLayer);

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") relayClient.pause();
      else relayClient.resume();
    });
  }

  return dataLayer;
}

/** The shared DataLayer, created on first use. Throws only if the worker could
 *  not be constructed at all — callers should prefer the helper functions. */
export function getDataLayer(): DataLayer {
  if (!instance) {
    try {
      instance = createInstance();
    } catch (e) {
      bootError = e instanceof Error ? e.message : String(e);
      usingFallback = true;
      console.error("[dataLayer] falling back to SimplePool:", bootError);
      throw e;
    }
  }
  return instance;
}

/** True once the worker has hydrated its IndexedDB cache. */
export function isHydrated(): boolean {
  return hydrated;
}

/** Message from a failed worker boot, or null. */
export function getBootError(): string | null {
  return bootError;
}

/** Subscribe to the worker's post-hydration signal (fired once per boot). */
export function onRelayHydrated(cb: () => void): () => void {
  if (hydrated) {
    cb();
    return () => {};
  }
  hydratedListeners.add(cb);
  return () => hydratedListeners.delete(cb);
}

// ── Public helpers ──────────────────────────────────────────────────────────

function relayList(relays?: string[]): string[] {
  return relays && relays.length > 0 ? relays : DEFAULT_RELAYS;
}

/**
 * Declare a live interest. Returns a `close()`-able handle. On a worker boot
 * failure this degrades to a `SimplePool` subscription.
 */
export function subscribe(
  filters: Filter[],
  handlers: { onEvent: (event: NostrEvent) => void; onEose?: () => void },
  relays?: string[],
): Subscription {
  let dl: DataLayer | null = null;
  try {
    dl = getDataLayer();
  } catch {
    dl = null;
  }

  if (dl && !usingFallback) {
    const handle = dl.observe(filters, handlers, { relays });
    return { close: () => handle.unobserve() };
  }

  // Fallback: one SimplePool subscription per filter, fanned in.
  const subs = filters.map((filter) =>
    pool.subscribeMany(relayList(relays), filter, {
      onevent: handlers.onEvent,
      oneose: handlers.onEose,
    }),
  );
  return { close: () => subs.forEach((s) => s.close()) };
}

/**
 * One-shot network read of the newest event matching `filters`.
 *
 * The DataLayer's `onEose` is the end of the LOCAL cache replay, not the
 * network, and live events arrive after it. So we must not simply resolve on
 * `onEose` (an empty cache would resolve immediately and miss the network), nor
 * block the full timeout when nothing matches. Instead: settle shortly after
 * the last match; on cache EOSE with no match, wait a bounded network window.
 */
export function fetchOne(
  filters: Filter[],
  relays?: string[],
  timeoutMs = 8000,
): Promise<NostrEvent | null> {
  let dl: DataLayer | null = null;
  try {
    dl = getDataLayer();
  } catch {
    dl = null;
  }
  if (!dl || usingFallback) {
    return pool
      .querySync(relayList(relays), filters[0])
      .then((events) =>
        events.sort((a, b) => b.created_at - a.created_at)[0] ?? null,
      )
      .catch(() => null);
  }

  return new Promise((resolve) => {
    let best: NostrEvent | null = null;
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (settleTimer) clearTimeout(settleTimer);
      handle.unobserve();
      resolve(best);
    };
    const handle = dl.observe(
      filters,
      {
        onEvent: (event) => {
          if (!best || event.created_at > best.created_at) best = event;
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, FETCH_SETTLE_MS);
        },
        onEose: () => {
          if (!best && !settleTimer) {
            settleTimer = setTimeout(finish, FETCH_NETWORK_GRACE_MS);
          }
        },
      },
      { relays },
    );
    const hardTimer = setTimeout(finish, timeoutMs);
  });
}

/** One-shot network read of every event matching `filters`. */
export function fetchMany(
  filters: Filter[],
  relays?: string[],
  timeoutMs = 8000,
): Promise<NostrEvent[]> {
  let dl: DataLayer | null = null;
  try {
    dl = getDataLayer();
  } catch {
    dl = null;
  }
  if (!dl || usingFallback) {
    return Promise.all(
      filters.map((f) =>
        pool.querySync(relayList(relays), f).catch(() => [] as NostrEvent[]),
      ),
    ).then((lists) => {
      const byId = new Map<string, NostrEvent>();
      lists.flat().forEach((e) => byId.set(e.id, e));
      return Array.from(byId.values());
    });
  }

  return new Promise((resolve) => {
    const byId = new Map<string, NostrEvent>();
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (settleTimer) clearTimeout(settleTimer);
      handle.unobserve();
      resolve(Array.from(byId.values()));
    };
    const handle = dl.observe(
      filters,
      {
        onEvent: (event) => {
          byId.set(event.id, event);
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, FETCH_SETTLE_MS);
        },
        onEose: () => {
          if (byId.size === 0 && !settleTimer) {
            settleTimer = setTimeout(finish, FETCH_NETWORK_GRACE_MS);
          }
        },
      },
      { relays },
    );
    const hardTimer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Cache-only read (no network). Used for the dual-read storage path: whatever
 * the local relay already holds, served synchronously from IndexedDB.
 */
export function fetchCachedMany(filters: Filter[]): Promise<NostrEvent[]> {
  let dl: DataLayer | null = null;
  try {
    dl = getDataLayer();
  } catch {
    dl = null;
  }
  if (!dl || usingFallback) return Promise.resolve([]);

  return new Promise((resolve) => {
    const byId = new Map<string, NostrEvent>();
    const handle = dl.observe(
      filters,
      {
        onEvent: (event) => byId.set(event.id, event),
        onEose: () => {
          handle.unobserve();
          resolve(Array.from(byId.values()));
        },
      },
      { localOnly: true },
    );
    // Cache replay is immediate; guard with a short cap in case of a slow boot.
    setTimeout(() => {
      handle.unobserve();
      resolve(Array.from(byId.values()));
    }, 1500);
  });
}

/** Publish, waiting for all target relays to settle (resolve or fail). */
export async function publishEvent(
  event: NostrEvent,
  relays?: string[],
): Promise<void> {
  let dl: DataLayer | null = null;
  try {
    dl = getDataLayer();
  } catch {
    dl = null;
  }
  if (dl && !usingFallback) {
    try {
      await dl.publishEvent(event, relays ? { relays } : undefined);
      return;
    } catch (e) {
      console.error("[dataLayer] publish failed, trying pool:", e);
    }
  }
  await Promise.allSettled(pool.publish(relayList(relays), event));
}

/** Publish, rejecting when no relay accepted the event. */
export async function publishEventStrict(
  event: NostrEvent,
  relays?: string[],
): Promise<void> {
  let dl: DataLayer | null = null;
  try {
    dl = getDataLayer();
  } catch {
    dl = null;
  }
  if (dl && !usingFallback) {
    let result;
    try {
      result = await dl.publishEvent(event, relays ? { relays } : undefined);
    } catch (e) {
      console.error("[dataLayer] strict publish error, trying pool:", e);
      result = null;
    }
    if (result) {
      if (result.accepted > 0) return;
      // No relay accepted. A timeout/unreachable target becomes durable outbox
      // debt the worker retries later — queued, not failed. Only a terminal
      // `rejected` (OK false) from every target is a real failure.
      const retryable = result.relayResults.some(
        (o) => o.status === "timeout" || o.status === "failed",
      );
      if (retryable) return;
      if (result.relayResults.length > 0) {
        throw new Error("Event was rejected by every relay");
      }
      // No targets at all — fall through to the plain pool.
    }
  }
  const results = await Promise.allSettled(pool.publish(relayList(relays), event));
  if (!results.some((r) => r.status === "fulfilled")) {
    throw new Error("Event was not accepted by any relay");
  }
}

/** Update the relay set the worker reads from (routing-policy input). */
export function setUserRelays(relays: string[]): void {
  if (client && !usingFallback) client.setUserRelays(relays);
}

/**
 * Publish and report per-relay outcomes (for UIs that show accepted/rejected
 * relay lists). Falls back to a plain pool when the worker is unavailable.
 */
export async function publishEventResults(
  event: NostrEvent,
  relays?: string[],
): Promise<{ relay: string; accepted: boolean }[]> {
  let dl: DataLayer | null = null;
  try {
    dl = getDataLayer();
  } catch {
    dl = null;
  }
  if (dl && !usingFallback) {
    try {
      const result = await dl.publishEvent(event, relays ? { relays } : undefined);
      return result.relayResults.map((o) => ({
        relay: o.relay,
        accepted: o.status === "accepted",
      }));
    } catch (e) {
      console.error("[dataLayer] publish failed, trying pool:", e);
    }
  }
  const list = relayList(relays);
  const settled = await Promise.allSettled(pool.publish(list, event));
  return settled.map((r, i) => ({ relay: list[i], accepted: r.status === "fulfilled" }));
}

/** Which relays the worker has seen an event on (relay hints / provenance). */
export async function seenOn(eventId: string): Promise<string[]> {
  if (!client || usingFallback) return [];
  try {
    return await client.seenOn(eventId);
  } catch {
    return [];
  }
}

/** The raw client, for advanced wiring (relay health, diagnostics). */
export function getClient(): LocalRelayClient | null {
  return client;
}

/** Timing knobs mirrored from the sibling apps' proven one-shot reader. */
const FETCH_SETTLE_MS = 500;
const FETCH_NETWORK_GRACE_MS = 2500;
