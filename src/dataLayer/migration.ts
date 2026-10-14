/**
 * One-time, non-destructive migration of the legacy local document store
 * (`src/lib/localStore.ts`, IndexedDB `nostr-docs-local`) into the local relay's
 * own IndexedDB store.
 *
 * Permanent dual storage: unlike a normal migration, we never delete the
 * legacy store — it is the only owner of each document's `viewKey`/`editKey`/
 * flags (the local relay stores raw events, never keys). This only *seeds* the
 * relay cache so events already on the device are served by the new path too.
 * Reads union both sources (see `DocumentContext`), so anything in either store
 * remains visible forever. Writes continue to update both.
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
