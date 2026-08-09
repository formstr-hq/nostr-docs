// Publish a page as a public Nostr article.
//
// Two targets are supported:
//   - NIP-23 long-form (kind 30023)
//   - Community NIP (kind 30817) — markdown content, `d`/`title`/`k` tags.
//
// The page's markdown carries app-specific nodes that don't render off-app, and
// its images are encrypted blobs no public reader can decrypt. Building the
// article therefore rewrites the markdown: app nodes are stripped/linkified, and
// every private image is fetched, decrypted, and re-uploaded as a PUBLIC blob so
// the article is self-contained. Progress is streamed step-by-step so the UI can
// show the work happening instead of a blocking spinner.

import type { EventTemplate } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { signerManager } from "../signer";
import { publishEvent } from "../nostr/publish";
import { decryptFile, sha256Hex } from "./fileEncryption";
import { uploadToBlossom } from "../blossom/client";
import { makeTag } from "./makeTag";

export const KIND_LONGFORM = 30023;
export const KIND_COMMUNITY_NIP = 30817;

export type PublishTarget = "longform" | "communityNip";

export type StepStatus = "running" | "done" | "error";

export interface BuildStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface BuiltArticle {
  content: string;
  warnings: string[];
}

interface BuildOptions {
  markdown: string;
  blossomServers: string[];
  /** Emitted as each step starts and resolves; same id is reused for updates. */
  onStep?: (step: BuildStep) => void;
}

const ENCRYPTED_FILE_RE = /<encrypted-file\b([^>]*)><\/encrypted-file>/g;
const FORM_NODE_RE = /<nostr-form\b([^>]*)><\/nostr-form>/g;

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : "";
}

/**
 * Rewrite the page markdown into a portable public article: strip app-only
 * form nodes, and decrypt + re-upload every private image as a public blob.
 * Tables are left as the GFM the markdown serializer already emits.
 */
export async function buildArticleContent({
  markdown,
  blossomServers,
  onStep,
}: BuildOptions): Promise<BuiltArticle> {
  const warnings: string[] = [];
  let content = markdown;

  // ── Forms: replace the app-only node with a plain nostr: link (or drop it) ──
  const formMatches = [...content.matchAll(FORM_NODE_RE)];
  if (formMatches.length > 0) {
    onStep?.({ id: "forms", label: `Converting ${formMatches.length} embedded form(s)`, status: "running" });
    content = content.replace(FORM_NODE_RE, (_full, attrs: string) => {
      const naddr = attr(attrs, "data-naddr");
      if (!naddr) return "";
      const ref = naddr.startsWith("naddr") ? `nostr:${naddr}` : naddr;
      return `[Embedded form ↗](${ref})`;
    });
    onStep?.({ id: "forms", label: `Converted ${formMatches.length} embedded form(s)`, status: "done" });
  }

  // ── Private images: fetch → decrypt → re-upload as public → rewrite URL ──
  const fileMatches = [...content.matchAll(ENCRYPTED_FILE_RE)];
  for (let i = 0; i < fileMatches.length; i++) {
    const [full, attrs] = fileMatches[i];
    const src = attr(attrs, "data-src");
    const key = attr(attrs, "data-key");
    const nonce = attr(attrs, "data-nonce");
    const filename = decodeURIComponent(attr(attrs, "data-filename") || "image");
    const stepId = `img-${i}`;
    const label = `Publishing image ${i + 1}/${fileMatches.length}: ${filename}`;
    onStep?.({ id: stepId, label, status: "running" });

    try {
      if (!src || !key || !nonce) throw new Error("missing key material");
      const res = await fetch(src);
      if (!res.ok) throw new Error(`fetch failed (HTTP ${res.status})`);
      const encrypted = await res.arrayBuffer();
      const decrypted = new Uint8Array(await decryptFile(encrypted, key, nonce));
      const hash = await sha256Hex(decrypted);
      const publicUrl = await uploadToBlossom(blossomServers, decrypted, hash);
      // Function replacer so `$` in URLs/filenames isn't treated as a pattern.
      content = content.replace(full, () => `![${filename}](${publicUrl})`);
      onStep?.({ id: stepId, label: `Published image: ${filename}`, status: "done" });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not publish image "${filename}": ${detail}`);
      // Leave a visible placeholder rather than a broken encrypted tag.
      content = content.replace(full, () => `*(image unavailable: ${filename})*`);
      onStep?.({ id: stepId, label: `Failed to publish image: ${filename}`, status: "error", detail });
    }
  }

  return { content: content.trim(), warnings };
}

/** First markdown image URL in the content, if any — used to suggest a banner. */
export function firstImageUrl(markdown: string): string | undefined {
  return markdown.match(/!\[[^\]]*\]\(([^)\s]+)/)?.[1];
}

/** Upload an image file as a PUBLIC (unencrypted) blossom blob — e.g. a banner. */
export async function uploadPublicImage(
  file: File,
  blossomServers: string[],
): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(data);
  return uploadToBlossom(blossomServers, data, hash);
}

/** URL-safe slug from a title; falls back to a short random id. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `page-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PublishArticleOptions {
  target: PublishTarget;
  title: string;
  summary?: string;
  /** Banner/header image URL — NIP-23 `image` tag (long-form only). */
  image?: string;
  content: string;
  /** Hashtags/topics — published as `t` tags on both kinds. */
  hashtags?: string[];
  /** `["k", kind, name]` entries — community-NIP only. */
  kTags?: [string, string][];
  /**
   * Explicit addressable identifier. Pass the original `d` tag when editing an
   * already-published article so the update REPLACES it instead of creating a
   * new one (even if the title, and thus its slug, changed). Omit for new posts.
   */
  dTag?: string;
  relays: string[];
}

export interface PublishedArticle {
  naddr: string;
  address: string;
}

/** Build, sign, and publish the article event. Returns its naddr for sharing. */
export async function publishArticleEvent({
  target,
  title,
  summary,
  image,
  content,
  hashtags = [],
  kTags = [],
  dTag: fixedDTag,
  relays,
}: PublishArticleOptions): Promise<PublishedArticle> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer available");
  const pubkey = await signer.getPublicKey();

  const kind = target === "longform" ? KIND_LONGFORM : KIND_COMMUNITY_NIP;
  // Editing keeps the original identifier so the update replaces the post. A new
  // post gets a readable slug PLUS a random suffix: two articles that happen to
  // share a title (or the same page published twice) then get distinct
  // addresses instead of one silently overwriting the other.
  const dTag = fixedDTag || `${slugify(title)}-${makeTag(3)}`;

  const tags: string[][] = [["d", dTag], ["title", title]];
  if (target === "longform") {
    if (summary) tags.push(["summary", summary]);
    if (image) tags.push(["image", image]);
    tags.push(["published_at", String(Math.floor(Date.now() / 1000))]);
  } else {
    for (const [k, name] of kTags) tags.push(["k", k, name]);
  }
  // Hashtags (deduped, normalized) as `t` tags — supported by both kinds.
  const seenTopics = new Set<string>();
  for (const raw of hashtags) {
    const topic = raw.trim().replace(/^#/, "").toLowerCase();
    if (topic && !seenTopics.has(topic)) {
      seenTopics.add(topic);
      tags.push(["t", topic]);
    }
  }

  const template: EventTemplate = {
    kind,
    tags,
    content,
    created_at: Math.floor(Date.now() / 1000),
  };

  const signed = await signer.signEvent(template);
  await publishEvent(signed, relays);

  const naddr = nip19.naddrEncode({ identifier: dTag, pubkey, kind, relays });
  return { naddr, address: `${kind}:${pubkey}:${dTag}` };
}
