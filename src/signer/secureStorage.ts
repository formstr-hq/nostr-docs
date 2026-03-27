// Secure storage abstraction for native platforms.
// Tauri (desktop): tauri-plugin-store (app data dir, sandboxed per-app)
// Capacitor (Android): capacitor-secure-storage-plugin (Android Keystore)

const NSEC_KEY = "formstr:nsec";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isCapacitor =
  typeof window !== "undefined" && "Capacitor" in window;

export const isNativePlatform = isTauri || isCapacitor;
export { isCapacitor };

export async function saveNsec(nsec: string): Promise<void> {
  if (isTauri) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("secure-store.json");
    await store.set(NSEC_KEY, nsec);
    await store.save();
  } else if (isCapacitor) {
    const { SecureStoragePlugin } = await import(
      "capacitor-secure-storage-plugin"
    );
    await SecureStoragePlugin.set({ key: NSEC_KEY, value: nsec });
  }
}

export async function loadNsec(): Promise<string | null> {
  if (isTauri) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("secure-store.json");
    return (await store.get<string>(NSEC_KEY)) ?? null;
  } else if (isCapacitor) {
    const { SecureStoragePlugin } = await import(
      "capacitor-secure-storage-plugin"
    );
    try {
      const { value } = await SecureStoragePlugin.get({ key: NSEC_KEY });
      return value;
    } catch {
      return null;
    }
  }
  return null;
}

export async function removeNsec(): Promise<void> {
  if (isTauri) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("secure-store.json");
    await store.delete(NSEC_KEY);
    await store.save();
  } else if (isCapacitor) {
    const { SecureStoragePlugin } = await import(
      "capacitor-secure-storage-plugin"
    );
    try {
      await SecureStoragePlugin.remove({ key: NSEC_KEY });
    } catch {
      // key may not exist
    }
  }
}
