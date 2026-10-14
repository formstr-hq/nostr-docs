/**
 * One-time, non-destructive seed of the local relay's IndexedDB store from the
 * legacy local document store (`src/lib/localStore.ts`, IndexedDB
 * `nostr-docs-local`).
 *
 * We never delete or rewrite the legacy store: rows written before events moved
 * to the local relay keep their `event` payload and stay readable (read-only
 * back-compat). The legacy store now owns per-document keys/flags only; new
 * events are written to the local relay, never to `nostr-docs-local`. This seed
 * merely copies already-on-device events into the relay cache so they are served
 * by the new path too. Reads union both sources (see `DocumentContext`).
 *
 * Every step is best-effort: a failure (IDB eviction, private mode, a corrupt
 * row) is logged and skipped, never thrown — tags/documents must keep loading.
 */
import type { DataLayer } from "@formstr/local-relay";
import type { Event as NostrEvent } from "nostr-tools";
import { loadAllLocalEvents } from "../lib/localStore";

const MIGRATION_FLAG = "nostr-docs:local-relay-migrated:v1";

export function hasMigratedLegacyStore(): boolean {
  try {
    return localStorage.getItem(MIGRATION_FLAG) === "1";
  } catch {
    return false;
  }
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    /* private mode / storage disabled — retry next session, harmless */
  }
}

export async function runLegacyMigration(dataLayer: DataLayer): Promise<void> {
  if (hasMigratedLegacyStore()) return;

  try {
    const entries = await loadAllLocalEvents().catch(() => []);

    const byId = new Map<string, NostrEvent>();
    for (const entry of entries) {
      const event = entry?.event as NostrEvent | undefined;
      if (event?.id) byId.set(event.id, event);
    }

    if (byId.size > 0) {
      try {
        dataLayer.addEvents(Array.from(byId.values()));
      } catch (e) {
        console.warn("[dataLayer] legacy migration ingest failed:", e);
        return; // don't mark done — retry next boot
      }
    }

    markMigrated();
  } catch (e) {
    console.warn("[dataLayer] legacy migration skipped:", e);
  }
}
