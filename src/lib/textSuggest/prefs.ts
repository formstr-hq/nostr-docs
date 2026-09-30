import { DEFAULT_PREFS, type TextSuggestPrefs } from "./types";

const PREFS_KEY = "formstr:textSuggest:prefs";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isCapacitor =
  typeof window !== "undefined" && "Capacitor" in window;

// Model files only live for the current page session. A browser cannot reopen
// a user-selected File after reload without asking the user again.
let sessionModels: TextSuggestPrefs["models"] = [];
let sessionActiveModelId: TextSuggestPrefs["activeModelId"] = null;

function defaultsWithSessionModels(): TextSuggestPrefs {
  return {
    ...DEFAULT_PREFS,
    models: sessionModels,
    activeModelId: sessionActiveModelId,
  };
}

function safeMerge(parsed: unknown): TextSuggestPrefs {
  if (!parsed || typeof parsed !== "object") return defaultsWithSessionModels();
  const p = parsed as Partial<TextSuggestPrefs>;
  return {
    enabled: Boolean(p.enabled),
    models: sessionModels,
    activeModelId: sessionActiveModelId,
    debounceMs:
      typeof p.debounceMs === "number" ? p.debounceMs : DEFAULT_PREFS.debounceMs,
    maxTokens:
      typeof p.maxTokens === "number" ? p.maxTokens : DEFAULT_PREFS.maxTokens,
    temperature:
      typeof p.temperature === "number"
        ? p.temperature
        : DEFAULT_PREFS.temperature,
    setupDismissed: Boolean(p.setupDismissed),
  };
}

export async function loadPrefs(): Promise<TextSuggestPrefs> {
  if (isTauri) {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("text-suggest.json");
      const raw = await store.get<TextSuggestPrefs>(PREFS_KEY);
      return safeMerge(raw);
    } catch {
      return defaultsWithSessionModels();
    }
  }
  if (isCapacitor) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key: PREFS_KEY });
      return safeMerge(value ? JSON.parse(value) : null);
    } catch {
      return defaultsWithSessionModels();
    }
  }
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return safeMerge(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultsWithSessionModels();
  }
}

export async function savePrefs(prefs: TextSuggestPrefs): Promise<void> {
  sessionModels = prefs.models;
  sessionActiveModelId = prefs.activeModelId;

  // Persist behavior settings, but never persist model references. Object URLs
  // are invalid after reload and the GGUF must be selected again.
  const persistedPrefs: TextSuggestPrefs = {
    ...prefs,
    models: [],
    activeModelId: null,
  };

  if (isTauri) {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("text-suggest.json");
      await store.set(PREFS_KEY, persistedPrefs);
      await store.save();
    } catch {
      // ignore
    }
    return;
  }
  if (isCapacitor) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({
        key: PREFS_KEY,
        value: JSON.stringify(persistedPrefs),
      });
    } catch {
      // ignore
    }
    return;
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(persistedPrefs));
  } catch {
    // ignore
  }
}
