import type { Event } from "nostr-tools";

const DB_NAME = "nostr-docs-local";
const STORE_NAME = "events";
const DB_VERSION = 1;

/**
 * Per-document local *state*: the keys and flags relays never hold. This is now
 * the only thing the legacy `nostr-docs-local` store owns.
 *
 * Event payloads are NOT stored here any more. The local relay
 * (`@formstr/local-relay`) is the single owner of events; callers cache them via
 * `dataLayer.cacheLocalEvents`. `LocalStoredEvent.event` survives only so rows
 * written before this rule can still be read for one-time migration — never
 * write it.
 */
export interface LocalDocState {
  address: string; // "33457:pubkey:dtag" — primary key
  viewKey?: string; // For NIP-44 decryption via viewKey path
  editKey?: string; // For signing future updates
  pendingBroadcast?: boolean; // true = not yet confirmed published to relays
  savedAt: number; // Unix ms timestamp
  trashedAt?: number; // Unix ms — set when moved to trash, absent when active
  localOnly?: boolean; // true = encrypted locally only, never published to relays
  visited?: boolean; // true = a page opened via a shared link (someone else's doc)
  /** created_at of the newest event this state was derived from — used to
   *  ignore stale relay events so they can't revert a newer local edit. */
  lastEventCreatedAt?: number;
}

/** Legacy read shape. `event` is present only on rows written before events
 *  moved to the local relay. Read-only; never write a new one. */
export type LocalStoredEvent = LocalDocState & { event?: Event };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "address" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Read-modify-write a single row. No-op when the address is unknown. */
async function updateState(
  address: string,
  mutate: (entry: LocalStoredEvent) => void,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(address);
    getReq.onsuccess = () => {
      const entry = getReq.result as LocalStoredEvent | undefined;
      if (!entry) {
        resolve();
        return;
      }
      mutate(entry);
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Persist per-document keys/flags.
 *
 * NEVER stores an event payload — that is the local relay's job. Provided
 * fields are merged over the existing row; `undefined` leaves the stored value
 * untouched. A `lastEventCreatedAt` older than the stored value is ignored so a
 * stale relay event can't clobber newer local state (offline saves, flags).
 */
export async function saveLocalDocState(state: LocalDocState): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(state.address);
    getReq.onsuccess = () => {
      const existing = getReq.result as LocalStoredEvent | undefined;

      if (
        state.lastEventCreatedAt !== undefined &&
        existing?.lastEventCreatedAt !== undefined &&
        existing.lastEventCreatedAt > state.lastEventCreatedAt
      ) {
        resolve(); // stale update — leave newer local state intact
        return;
      }

      // Carry forward any legacy `event` untouched; never introduce one.
      const merged: LocalStoredEvent = {
        ...(existing ?? {}),
        address: state.address,
        savedAt: state.savedAt,
      };
      if (state.viewKey !== undefined) merged.viewKey = state.viewKey;
      if (state.editKey !== undefined) merged.editKey = state.editKey;
      if (state.pendingBroadcast !== undefined) merged.pendingBroadcast = state.pendingBroadcast;
      if (state.localOnly !== undefined) merged.localOnly = state.localOnly;
      if (state.visited !== undefined) merged.visited = state.visited;
      if (state.trashedAt !== undefined) merged.trashedAt = state.trashedAt;
      if (state.lastEventCreatedAt !== undefined) merged.lastEventCreatedAt = state.lastEventCreatedAt;

      const putReq = store.put(merged);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Load all active (non-trashed) rows. Events in old rows are read-only. */
export async function loadAllLocalEvents(): Promise<LocalStoredEvent[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () =>
      resolve((req.result as LocalStoredEvent[]).filter((e) => !e.trashedAt));
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load all active visited pages (opened via a shared link). Used to repopulate
 * the Visited tab on reload — these persist regardless of login state.
 */
export async function loadVisitedEvents(): Promise<LocalStoredEvent[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () =>
      resolve((req.result as LocalStoredEvent[]).filter((e) => e.visited && !e.trashedAt));
    req.onerror = () => reject(req.error);
  });
}

/** Clear the visited flag for an address — used when promoting it to Shared. */
export async function clearVisitedFlag(address: string): Promise<void> {
  await updateState(address, (entry) => {
    delete entry.visited;
  });
}

/** Load all trashed rows for the Trash view. */
export async function loadTrashedEvents(): Promise<LocalStoredEvent[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () =>
      resolve((req.result as LocalStoredEvent[]).filter((e) => !!e.trashedAt));
    req.onerror = () => reject(req.error);
  });
}

/** Mark an event as successfully broadcast to at least one relay. */
export async function markBroadcast(address: string): Promise<void> {
  await updateState(address, (entry) => {
    entry.pendingBroadcast = false;
  });
}

/** Move a document to trash (sets trashedAt). The NIP-09 relay deletion is handled separately. */
export async function trashLocalEvent(address: string): Promise<void> {
  await updateState(address, (entry) => {
    entry.trashedAt = Date.now();
  });
}

/** Restore a trashed document by clearing trashedAt. */
export async function restoreLocalEvent(address: string): Promise<void> {
  await updateState(address, (entry) => {
    delete entry.trashedAt;
  });
}

/**
 * Set or clear the localOnly flag for a stored row.
 * Device-only events are stored unsigned (sig: ""), so they cannot be
 * published as-is. The user must save again to create a fresh signed event.
 */
export async function setLocalOnlyFlag(
  address: string,
  localOnly: boolean,
): Promise<void> {
  await updateState(address, (entry) => {
    if (localOnly) entry.localOnly = true;
    else delete entry.localOnly;
  });
}

/** Permanently remove a stored row (keys/flags). Events live in the local relay. */
export async function removeLocalEvent(address: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(address);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
