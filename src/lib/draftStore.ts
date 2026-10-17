/**
 * Session-scoped store for the single in-progress draft (the `/new` scratch
 * page). A draft has no document address until it is saved, so it cannot live
 * in the per-document local store.
 *
 * Why this exists: logging in (or out) remounts the account-scoped subtree
 * (`AuthedApp`'s key), which tears down the editor. Without this stash a draft
 * typed while logged out vanished the moment you signed in. Backed by
 * `sessionStorage` so it also survives a reload within the tab, and is cleared
 * once the draft is saved or emptied.
 */
const KEY = "formstr:unsaved-draft";

export interface StoredDraft {
  markdown: string;
  /** Mirrors the draft's "device only" toggle so it is preserved too. */
  localOnly: boolean;
}

export function saveDraft(draft: StoredDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable / quota exceeded — the draft just won't survive a
    // remount. Never fatal.
  }
}

export function loadDraft(): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft> | null;
    if (!parsed || typeof parsed.markdown !== "string") return null;
    return { markdown: parsed.markdown, localOnly: !!parsed.localOnly };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
