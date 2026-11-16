/**
 * Viewport presentation for the page canvas. This is a view preference, not
 * document content: a fixed page preserves the document's real geometry
 * (page size, margins, columns) and scrolls horizontally when the viewport is
 * narrower; responsive reflows the page for the available width.
 */
export type PageViewMode = "fixed" | "responsive";

const STORAGE_KEY = "formstr:page-view-mode";

export function loadPageViewMode(): PageViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "responsive"
      ? "responsive"
      : "fixed";
  } catch {
    return "fixed";
  }
}

export function savePageViewMode(mode: PageViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // View preference only — never fatal.
  }
}
