import type { Event, EventTemplate } from "nostr-tools";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_DOC_METADATA } from "./kinds";
import { fetchMany } from "../dataLayer";

export interface DocMetadata {
  tags: string[];
  title?: string;
  viewKey?: string;
  editKey?: string;
  sharedAs?: string; // address of the shared (editKey-signed) copy
}

/**
 * High-water mark of `created_at` per document address.
 *
 * KIND_DOC_METADATA is parameterised-replaceable, so a relay stores an event
 * only if its `created_at` is strictly newer than the one it holds. `created_at`
 * has 1-second granularity, so two metadata writes in the same second (e.g.
 * rename + add a tag) collided and the relay silently dropped the second — the
 * just-added tag vanished on reload. Seeding this from fetched events and always
 * emitting `max(now, last + 1)` guarantees monotonic timestamps.
 */
const metaHighWater = new Map<string, number>();

function nextCreatedAt(address: string): number {
  const now = Math.floor(Date.now() / 1000);
  const next = Math.max(now, (metaHighWater.get(address) ?? 0) + 1);
  metaHighWater.set(address, next);
  return next;
}

export async function fetchAllDocMetadata(
  relays: string[],
  pubkey: string,
): Promise<Map<string, DocMetadata>> {
  const result = new Map<string, DocMetadata>();
  if (relays.length === 0 || !pubkey) return result;

  // Through the local relay: cache replay first, then the network — so already
  // persisted tags/titles are available offline, and fresh ones keep flowing.
  let events: Event[];
  try {
    events = await fetchMany(
      [{ kinds: [KIND_DOC_METADATA], authors: [pubkey] }],
      relays,
      5000,
    );
  } catch {
    return result;
  }
  if (events.length === 0) return result;

  events.sort((a, b) => b.created_at - a.created_at);

  let signer;
  try {
    signer = await signerManager.getSigner();
  } catch {
    return result;
  }
  if (!signer || !signer.nip44Decrypt) return result;

  const seen = new Set<string>();
  for (const event of events) {
    const dTag = event.tags.find((t: string[]) => t[0] === "d")?.[1];
    if (!dTag || seen.has(dTag)) continue;
    seen.add(dTag);

    // Seed the high-water mark even if the event is undecryptable.
    metaHighWater.set(dTag, Math.max(metaHighWater.get(dTag) ?? 0, event.created_at));

    try {
      const decrypted = await signer.nip44Decrypt(pubkey, event.content);
      result.set(dTag, JSON.parse(decrypted) as DocMetadata);
    } catch {
      // skip undecryptable events
    }
  }

  return result;
}

/**
 * Structural equality for two metadata records. Used to skip re-signing (and the
 * signer prompt it triggers) when a save wouldn't change anything. `tags` is
 * order-sensitive here — the app never reorders tags without an actual edit.
 */
export function metadataEqual(a: DocMetadata | undefined, b: DocMetadata | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.title !== b.title) return false;
  if (a.viewKey !== b.viewKey) return false;
  if (a.editKey !== b.editKey) return false;
  if (a.sharedAs !== b.sharedAs) return false;
  const at = a.tags ?? [];
  const bt = b.tags ?? [];
  if (at.length !== bt.length) return false;
  return at.every((t, i) => t === bt[i]);
}

export async function saveDocMetadata(
  address: string,
  metadata: DocMetadata,
  relays: string[],
): Promise<void> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer");

  const pubkey = await signer.getPublicKey();
  const encrypted = await signer.nip44Encrypt!(pubkey, JSON.stringify(metadata));

  const event: EventTemplate = {
    kind: KIND_DOC_METADATA,
    tags: [["d", address]],
    content: encrypted,
    created_at: nextCreatedAt(address),
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);
}
