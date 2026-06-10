/**
 * Lightweight HuggingFace model search for community whisper.cpp ggml models.
 * Returns repos that look like they host a `*.bin` whisper.cpp model.
 * The HF API is public/free and does not require auth for model listing.
 */

interface HFApiModel {
  id: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  tags?: string[];
}

interface HFRepoSibling {
  rfilename: string;
  size?: number;
}

interface HFRepoDetail {
  id: string;
  siblings?: HFRepoSibling[];
  cardData?: { language?: string | string[] };
}

export interface HFModelResult {
  repoId: string;
  filename: string;
  url: string;
  sizeBytes: number;
  downloads: number;
  language: string | undefined;
  likes: number;
}

const HF_API = "https://huggingface.co/api";

function inferLanguage(detail: HFRepoDetail): string | undefined {
  const card = detail.cardData?.language;
  if (Array.isArray(card)) return card[0];
  if (typeof card === "string") return card;
  return undefined;
}

function looksLikeGgml(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".bin")) return false;
  // common whisper.cpp ggml model naming
  return (
    lower.includes("ggml") ||
    lower.includes("whisper") ||
    lower.includes("q5_") ||
    lower.includes("q4_") ||
    lower.includes("q8_")
  );
}

export async function searchHuggingFace(
  query: string,
  signal?: AbortSignal,
): Promise<HFModelResult[]> {
  const q = query.trim();
  if (!q) return [];
  const search = encodeURIComponent(`whisper ggml ${q}`.trim());
  const listResp = await fetch(
    `${HF_API}/models?search=${search}&sort=downloads&direction=-1&limit=15`,
    { signal },
  );
  if (!listResp.ok) {
    throw new Error(`HuggingFace search failed: ${listResp.status}`);
  }
  const list: HFApiModel[] = await listResp.json();
  const results: HFModelResult[] = [];

  for (const repo of list) {
    try {
      const detailResp = await fetch(
        `${HF_API}/models/${encodeURIComponent(repo.id)}`,
        { signal },
      );
      if (!detailResp.ok) continue;
      const detail: HFRepoDetail = await detailResp.json();
      const ggmlFiles = (detail.siblings ?? []).filter((s) =>
        looksLikeGgml(s.rfilename),
      );
      if (!ggmlFiles.length) continue;
      const lang = inferLanguage(detail);
      for (const f of ggmlFiles) {
        results.push({
          repoId: repo.id,
          filename: f.rfilename,
          url: `https://huggingface.co/${repo.id}/resolve/main/${f.rfilename}`,
          sizeBytes: f.size ?? 0,
          downloads: repo.downloads ?? 0,
          language: lang,
          likes: repo.likes ?? 0,
        });
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      // skip this repo on error
    }
  }
  return results;
}
