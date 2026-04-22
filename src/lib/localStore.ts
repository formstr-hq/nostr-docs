import type { Event } from "nostr-tools";

const DB_NAME = "nostr-docs-local";
const STORE_NAME = "events";
const DB_VERSION = 1;

export interface LocalStoredEvent {
  address: string; // "33457:pubkey:dtag" — primary key
  event: Event; // Full signed, encrypted nostr event
  viewKey?: string; // For NIP-44 decryption via viewKey path
  editKey?: string; // For signing future updates
  pendingBroadcast: boolean; // true = not yet confirmed published to relays
  savedAt: number; // Unix ms timestamp
  trashedAt?: number; // Unix ms — set when moved to trash, absent when active
  localOnly?: boolean; // true = encrypted locally only, never published to relays
}

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

/**
 * Persist a signed event locally. Only overwrites an existing entry if the
 * new event is strictly newer (higher created_at). This prevents a stale relay
 * event from reverting a locally-edited newer version.
 */
export async function storeLocalEvent(entry: LocalStoredEvent): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(entry.address);
    getReq.onsuccess = () => {
      const existing = getReq.result as LocalStoredEvent | undefined;
      if (existing && existing.event.created_at >= entry.event.created_at) {
        resolve();
        return;
      }
      // Preserve an explicit localOnly flag set on this device so a newer
      // relay event can't silently re-enable syncing.
      const toStore: LocalStoredEvent = {
        ...entry,
        localOnly: entry.localOnly ?? existing?.localOnly,
      };
      const putReq = store.put(toStore);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Load all active (non-trashed) events. Called on app start for offline-first hydration. */
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

/** Load all trashed events for the Trash view. */
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
      entry.pendingBroadcast = false;
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Move a document to trash (sets trashedAt). The NIP-09 relay deletion is handled separately. */
export async function trashLocalEvent(address: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(address);
    getReq.onsuccess = () => {
      const entry = getReq.result as LocalStoredEvent | undefined;
      if (!entry) { resolve(); return; }
      entry.trashedAt = Date.now();
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Restore a trashed document by clearing trashedAt. */
export async function restoreLocalEvent(address: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(address);
    getReq.onsuccess = () => {
      const entry = getReq.result as LocalStoredEvent | undefined;
      if (!entry) { resolve(); return; }
      delete entry.trashedAt;
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Set or clear the localOnly flag for a stored event.
 * When clearing (switching to synced), also marks pendingBroadcast=true
 * so the event is re-broadcast on next startup.
 */
export async function setLocalOnlyFlag(
  address: string,
  localOnly: boolean,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(address);
    getReq.onsuccess = () => {
      const entry = getReq.result as LocalStoredEvent | undefined;
      if (!entry) { resolve(); return; }
      entry.localOnly = localOnly || undefined; // keep undefined instead of false to avoid polluting old entries
      // Note: we do NOT set pendingBroadcast=true when clearing localOnly.
      // Device-only events are stored unsigned (sig: ""), so they cannot be
      // published as-is. The user must save again to create a fresh signed event.
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Permanently remove a stored event from IndexedDB. */
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
