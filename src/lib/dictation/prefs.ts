import { DEFAULT_PREFS, type DictationPrefs } from "./types";

const PREFS_KEY = "formstr:dictation:prefs";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isCapacitor =
  typeof window !== "undefined" && "Capacitor" in window;

function safeMerge(parsed: unknown): DictationPrefs {
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFS };
  const p = parsed as Partial<DictationPrefs>;
  return {
    modelId: p.modelId ?? DEFAULT_PREFS.modelId,
    language: p.language ?? DEFAULT_PREFS.language,
    customModels: Array.isArray(p.customModels) ? p.customModels : [],
    setupComplete: Boolean(p.setupComplete),
  };
}

export async function loadPrefs(): Promise<DictationPrefs> {
  if (isTauri) {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("dictation.json");
      const raw = await store.get<DictationPrefs>(PREFS_KEY);
      return safeMerge(raw);
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }
  if (isCapacitor) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key: PREFS_KEY });
      return safeMerge(value ? JSON.parse(value) : null);
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return safeMerge(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: DictationPrefs): Promise<void> {
  if (isTauri) {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("dictation.json");
      await store.set(PREFS_KEY, prefs);
      await store.save();
    } catch {
      // ignore
    }
    return;
  }
  if (isCapacitor) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(prefs) });
    } catch {
      // ignore
    }
    return;
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
