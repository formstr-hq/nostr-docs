import { useMemo } from "react";
import MiniSearch, { type SearchResult } from "minisearch";
import type { Event } from "nostr-tools";

export type DocumentVersion = {
  event: Event;
  decryptedContent: string;
};

export type DocumentHistory = {
  versions: DocumentVersion[];
};

export type DocOrigin = "personal" | "shared" | "visited";

export type DocSearchHit = {
  address: string;
  origin: DocOrigin;
  score: number;
  terms: string[];
};

type IndexEntry = {
  id: string;
  origin: DocOrigin;
  title: string;
  content: string;
  tags: string;
};

export const heuristicTitle = (content: string, maxLength = 120): string => {
  const firstLine = content.split("\n").find((l) => l.trim()) ?? "";
  return firstLine.replace(/^#+\s*/, "").slice(0, maxLength).trim();
};

const buildIndex = (
  sources: {
    personal: Map<string, DocumentHistory>;
    shared: Map<string, DocumentHistory>;
    visited: Map<string, DocumentHistory>;
  },
  docTitles: Map<string, string>,
  docTags: Map<string, string[]>,
): MiniSearch<IndexEntry> => {
  const index = new MiniSearch<IndexEntry>({
    fields: ["title", "content", "tags"],
    storeFields: ["origin"],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: "AND",
    },
  });

  const seen = new Set<string>();
  const addAll = (map: Map<string, DocumentHistory>, origin: DocOrigin) => {
    for (const [address, history] of map) {
      if (seen.has(address)) continue;
      const latest = history.versions.at(-1);
      if (!latest) continue;
      const content = latest.decryptedContent ?? "";
      const customTitle = docTitles.get(address) ?? "";
      const title = customTitle || heuristicTitle(content) || "Untitled";
      const tags = (docTags.get(address) ?? []).join(" ");
      index.add({ id: address, origin, title, content, tags });
      seen.add(address);
    }
  };

  // Order matters: personal wins if an address appears in multiple maps.
  addAll(sources.personal, "personal");
  addAll(sources.shared, "shared");
  addAll(sources.visited, "visited");

  return index;
};

export const useDocSearch = (
  personal: Map<string, DocumentHistory>,
  shared: Map<string, DocumentHistory>,
  visited: Map<string, DocumentHistory>,
  docTitles: Map<string, string>,
  docTags: Map<string, string[]>,
  query: string,
): DocSearchHit[] | null => {
  const index = useMemo(
    () => buildIndex({ personal, shared, visited }, docTitles, docTags),
    [personal, shared, visited, docTitles, docTags],
  );

  return useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const results = index.search(q) as (SearchResult & { origin: DocOrigin })[];
    return results.map((r) => ({
      address: r.id as string,
      origin: r.origin,
      score: r.score,
      terms: r.terms,
    }));
  }, [index, query]);
};

export type SnippetSegment = { text: string; match: boolean };

/**
 * Build a short context snippet around the first occurrence of any matched
 * term in `content`. Returns segments tagged with `match: true` for the
 * highlighted spans so the renderer can wrap them. Returns null if no term
 * is found (fall back to a content preview).
 */
export const buildSnippet = (
  content: string,
  terms: string[],
  radius = 60,
): SnippetSegment[] | null => {
  if (!content || terms.length === 0) return null;
  const lower = content.toLowerCase();

  // Pick the earliest match across all terms.
  let earliest = -1;
  let earliestTerm = "";
  for (const t of terms) {
    const idx = lower.indexOf(t.toLowerCase());
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
      earliestTerm = t;
    }
  }
  if (earliest === -1) return null;

  const start = Math.max(0, earliest - radius);
  const end = Math.min(content.length, earliest + earliestTerm.length + radius);
  let slice = content.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) slice = "… " + slice;
  if (end < content.length) slice = slice + " …";

  // Split slice into segments using all matched terms (case-insensitive).
  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = slice.split(re);
  const termSet = new Set(terms.map((t) => t.toLowerCase()));
  return parts
    .filter((p) => p.length > 0)
    .map((p) => ({ text: p, match: termSet.has(p.toLowerCase()) }));
};
