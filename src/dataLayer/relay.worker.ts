/**
 * Worker entry for the nostr-docs local relay.
 *
 * Thin platform shell around `RelayService` (shipped by @formstr/local-relay):
 * wires the real Worker globals (`self`), the default WebSocket factory, and an
 * app-scoped IndexedDB store. Spawned from the main thread via
 * `new Worker(new URL("./relay.worker.ts", import.meta.url), { type: "module" })`.
 *
 * Everything network-facing in the app goes through this worker; the main
 * thread only declares interests and publishes.
 */
import {
  RelayService,
  selfChannel,
  IndexedDBStorage,
  defaultPrunePolicy,
} from "@formstr/local-relay";

export const NOSTR_DOCS_DB_NAMESPACE = "nostr-docs";

const base = selfChannel(
  self as unknown as {
    postMessage: (m: unknown) => void;
    onmessage: ((e: MessageEvent) => void) | null;
  },
);

/**
 * Retention. The library default protects kinds 0/3/10002 and the 10000-series
 * lists, with a 7-day TTL for everything else and a 50k hard cap — which would
 * silently prune the user's own documents and their tags/titles after a week.
 * We protect every kind the app treats as durable and give published copies a
 * long TTL. Ephemeral CRDT ops (22457) live in the 20000–29999 range, so
 * EventDB never stores them and they need no entry here.
 */
const prunePolicy = defaultPrunePolicy();
const DAY = 24 * 60 * 60;
for (const kind of [
  33457, // encrypted document (KIND_FILE) — never prune; it's the user's data
  34579, // per-document metadata: tags/title/keys (KIND_DOC_METADATA)
  1494, // inline comments (KIND_COMMENT)
  34580, // comment resolutions (KIND_COMMENT_RESOLUTION)
  30023, // published long-form article (KIND_LONGFORM)
  30817, // published community NIP (KIND_COMMUNITY_NIP)
  5, // NIP-09 deletion requests — keep so deleted docs can't reappear
]) {
  prunePolicy.protectedKinds.add(kind);
}
prunePolicy.defaultTtlSeconds = 30 * DAY;
prunePolicy.maxEvents = 200_000;

const service = new RelayService({
  channel: base,
  storage: new IndexedDBStorage(NOSTR_DOCS_DB_NAMESPACE),
  // The policy MUST be nested under `persistence` — RelayService forwards only
  // `opts.persistence` to the Persistence that owns the periodic prune.
  persistence: { prunePolicy },
});

// Hydrate from IndexedDB, then begin write-through + pruning. Interests
// declared during boot can EOSE on an empty store and miss the hydrated cache,
// so we post `hydrated` afterwards for the main thread to re-declare against.
void service
  .start()
  .then(() => {
    base.post({ kind: "hydrated" });
  })
  .catch((e) => {
    // Surface a failed boot instead of an unhandled rejection so the main
    // thread can degrade gracefully (e.g. fall back to the network pool).
    base.post({
      kind: "bootError",
      message: e instanceof Error ? e.message : String(e),
    });
  });

export {};
