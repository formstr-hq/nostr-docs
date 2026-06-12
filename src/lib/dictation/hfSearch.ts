/**
 * HuggingFace model search for community whisper.cpp ggml models.
 *
 * Uses `filter=whisper&filter=ggml` to restrict to the whisper.cpp ggml pool
 * (otherwise HF's substring `search` over arbitrary repo IDs returns junk or
 * nothing for common terms like "english" / "japanese"). `full=true` returns
 * siblings inline, so we avoid an N+1 round trip per repo.
 *
 * The HF API is public and does not require auth for model listing.
 */

interface HFRepoSibling {
  rfilename: string;
  size?: number;
}

interface HFApiModel {
  id: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  tags?: string[];
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

// ISO 639-1 codes that whisper supports. Used to pull a language hint out of
// the repo tags when cardData.language is missing (it usually is).
const LANG_CODES = new Set([
  "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca",
  "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms",
  "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la",
  "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn",
  "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
  "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be",
  "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn",
  "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha",
  "ba", "jw", "su",
]);

function inferLanguage(repo: HFApiModel): string | undefined {
  const card = repo.cardData?.language;
  if (Array.isArray(card) && card.length) return card[0];
  if (typeof card === "string") return card;
  // Fall back to a 2-letter language code present in the tag list.
  for (const tag of repo.tags ?? []) {
    if (LANG_CODES.has(tag)) return tag;
  }
  return undefined;
}

function looksLikeWhisperGgml(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".bin")) return false;
  // whisper.cpp convention: ggml-<name>[-<quant>].bin. A few repos drop the
  // prefix but keep "whisper" in the filename.
  return lower.startsWith("ggml-") || lower.includes("whisper");
}

/**
 * Search the whisper+ggml pool on HuggingFace. Empty query returns the top
 * models by downloads (browse mode).
 */
export async function searchHuggingFace(
  query: string,
  signal?: AbortSignal,
): Promise<HFModelResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({
    filter: "whisper",
    sort: "downloads",
    direction: "-1",
    limit: "30",
    full: "true",
  });
  // URLSearchParams turns repeated keys into &filter=whisper&filter=ggml
  params.append("filter", "ggml");
  if (q) params.set("search", q);

  const listResp = await fetch(`${HF_API}/models?${params.toString()}`, {
    signal,
  });
  if (!listResp.ok) {
    throw new Error(`HuggingFace search failed: ${listResp.status}`);
  }
  const list: HFApiModel[] = await listResp.json();
  const results: HFModelResult[] = [];

  for (const repo of list) {
    const ggmlFiles = (repo.siblings ?? []).filter((s) =>
      looksLikeWhisperGgml(s.rfilename),
    );
    if (!ggmlFiles.length) continue;
    const lang = inferLanguage(repo);
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
  }
  return results;
}
