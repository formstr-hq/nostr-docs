import type { TextSuggestModelEntry, TextSuggestPrefs } from "./types";

export function makeModelId(url: string): `custom:${string}` {
  const slug = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .slice(0, 80);
  return `custom:${slug}-${Date.now().toString(36)}`;
}

export function resolveActiveModel(
  prefs: TextSuggestPrefs,
): TextSuggestModelEntry | null {
  if (!prefs.activeModelId) return null;
  return prefs.models.find((m) => m.id === prefs.activeModelId) ?? null;
}

export function suggestedLabel(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ?? url;
  } catch {
    return url;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
