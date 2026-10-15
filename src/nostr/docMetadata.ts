import type { Event, EventTemplate } from "nostr-tools";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_DOC_METADATA } from "./kinds";
import { fetchMany } from "../dataLayer";
import {
  decryptWithViewKey,
  encryptWithViewKey,
  rosterDTag,
  type DocMember,
  type DocMode,
} from "./sharedDoc";

export interface DocMetadata {
  tags: string[];
  title?: string;
  viewKey?: string;
  editKey?: string;
  sharedAs?: string; // address of the shared (editKey-signed) copy
  /** Present (2) only on the owner's viewKey-encrypted roster for a group doc. */
  v?: number;
  /** v2 access mode for content versions. */
  mode?: DocMode;
  /** v2 group-doc roster: authorized authors and roles. */
  members?: DocMember[];
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
  viewKeys?: Map<string, string>,
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
      let decrypted: string;
      try {
        // Self-encrypted: the per-user metadata we have always written.
        decrypted = await signer.nip44Decrypt(pubkey, event.content);
      } catch {
        // v2: the owner's shareable roster is encrypted with the document
        // viewKey instead of the owner's own key. Only attempt this when we
        // know the viewKey for that address; otherwise leave the event alone
        // so legacy undecryptable events are still skipped as before.
        const viewKey = viewKeys?.get(dTag);
        if (!viewKey) throw new Error("no viewKey");
        decrypted = decryptWithViewKey(event.content, viewKey);
      }
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
  if (a.v !== b.v) return false;
  if (a.mode !== b.mode) return false;
  const am = a.members ?? [];
  const bm = b.members ?? [];
  if (am.length !== bm.length) return false;
  for (let i = 0; i < am.length; i++) {
    if (am[i].pubkey !== bm[i].pubkey || am[i].role !== bm[i].role) return false;
  }
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

/**
 * Write (or update) the owner's shareable roster for a v2 group document. The
 * content is NIP-44 encrypted with the document viewKey — not the owner's own
 * key — so every member who holds the viewKey can read it. Only the owner may
 * write it; the relay's parameterized-replaceable slot is `(34579, owner, root)`.
 */
export async function saveRoster(
  owner: string,
  d: string,
  viewKey: string,
  roster: DocMetadata,
  relays: string[],
): Promise<void> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer");

  const pubkey = await signer.getPublicKey();
  if (pubkey !== owner) throw new Error("Only the document owner can write the roster");

  const dTag = rosterDTag(owner, d);
  const encrypted = encryptWithViewKey(JSON.stringify(roster), viewKey);

  const event: EventTemplate = {
    kind: KIND_DOC_METADATA,
    tags: [["d", dTag]],
    content: encrypted,
    created_at: nextCreatedAt(dTag),
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);
}
