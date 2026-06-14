import { isCapacitor } from "../../signer/secureStorage";

const IDB_NAME = "formstr-dictation-models-v1";
const IDB_STORE = "models";
const MODEL_DIR = "dictation-models";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key: string): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => {
          const val = req.result as
            | Uint8Array
            | ArrayBuffer
            | Blob
            | undefined;
          if (!val) return resolve(null);
          if (val instanceof Uint8Array) return resolve(val);
          if (val instanceof ArrayBuffer) return resolve(new Uint8Array(val));
          if (val instanceof Blob)
            val.arrayBuffer().then((b) => resolve(new Uint8Array(b)));
          else resolve(null);
        };
        req.onerror = () => reject(req.error);
      })
      .catch(reject);
  });
}

function idbPut(key: string, value: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        // Wrap as Blob: structured clone of a Blob serializes a file
        // reference, so large values bypass the ~1 GB per-entry
        // structured-clone size cap (hit by Whisper large models in Firefox).
        const stored = new Blob([value]);
        tx.objectStore(IDB_STORE).put(stored, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
      .catch(reject);
  });
}

function idbDelete(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
      .catch(reject);
  });
}

function idbClear(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function idbHas(key: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).getKey(key);
        req.onsuccess = () => resolve(req.result !== undefined);
        req.onerror = () => reject(req.error);
      })
      .catch(reject);
  });
}

export interface DownloadProgress {
  bytes: number;
  total: number;
}

export type ProgressFn = (p: DownloadProgress) => void;

async function fetchWithProgress(
  url: string,
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Model download failed: ${response.status}`);
  }
  const totalHeader = response.headers.get("Content-Length");
  const total = totalHeader ? parseInt(totalHeader, 10) : 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ bytes: buf.byteLength, total: buf.byteLength });
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({ bytes: received, total });
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function capDownloadModel(
  url: string,
  storageKey: string,
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const path = `${MODEL_DIR}/${storageKey}.bin`;

  try {
    const stat = await Filesystem.stat({ path, directory: Directory.Data });
    if (stat.size > 0) {
      const read = await Filesystem.readFile({
        path,
        directory: Directory.Data,
      });
      const base64 = typeof read.data === "string" ? read.data : "";
      return base64ToBytes(base64);
    }
  } catch {
    // not present — download
  }

  try {
    await Filesystem.mkdir({
      path: MODEL_DIR,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // already exists
  }

  const bytes = await fetchWithProgress(url, onProgress);
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data: bytesToBase64(bytes),
  });
  return bytes;
}

async function idbGetOrDownload(
  url: string,
  storageKey: string,
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  try {
    const existing = await idbGet(storageKey);
    if (existing) return existing;
  } catch {
    // IndexedDB unavailable — fall through to download w/o cache
  }
  const bytes = await fetchWithProgress(url, onProgress);
  try {
    await idbPut(storageKey, bytes);
  } catch {
    // best effort — return bytes even if persistence failed
  }
  return bytes;
}

export async function getModelBytes(
  url: string,
  storageKey: string,
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  if (isCapacitor) {
    return capDownloadModel(url, storageKey, onProgress);
  }
  return idbGetOrDownload(url, storageKey, onProgress);
}

export async function storeModelBytes(
  storageKey: string,
  bytes: Uint8Array,
): Promise<void> {
  if (isCapacitor) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    try {
      await Filesystem.mkdir({
        path: MODEL_DIR,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // already exists
    }
    await Filesystem.writeFile({
      path: `${MODEL_DIR}/${storageKey}.bin`,
      directory: Directory.Data,
      data: bytesToBase64(bytes),
    });
    return;
  }
  await idbPut(storageKey, bytes);
}

export async function hasCachedModel(
  _url: string,
  storageKey: string,
): Promise<boolean> {
  // The whisper worker runs in a Web Worker where `window` is undefined, so
  // it never takes the Capacitor branch — it always writes to IndexedDB.
  // That means on Android the model can live in either Capacitor Filesystem
  // (downloaded by the setup dialog on the main thread) or IndexedDB
  // (downloaded by the worker). Check both so the UI doesn't lie.
  if (isCapacitor) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const stat = await Filesystem.stat({
        path: `${MODEL_DIR}/${storageKey}.bin`,
        directory: Directory.Data,
      });
      if (stat.size > 0) return true;
    } catch {
      // not present in Capacitor FS — fall through to IDB
    }
  }
  try {
    return await idbHas(storageKey);
  } catch {
    return false;
  }
}

export async function clearCachedModel(
  _url: string,
  storageKey: string,
): Promise<void> {
  // Clear both stores — see hasCachedModel for why both can hold the file.
  if (isCapacitor) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.deleteFile({
        path: `${MODEL_DIR}/${storageKey}.bin`,
        directory: Directory.Data,
      });
    } catch {
      // not present
    }
  }
  try {
    await idbDelete(storageKey);
  } catch {
    // ignore
  }
}

export async function clearAllCachedModels(): Promise<void> {
  if (isCapacitor) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.rmdir({
        path: MODEL_DIR,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // ignore
    }
  }
  try {
    await idbClear();
  } catch {
    // ignore
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
