import type { Event, EventTemplate } from "nostr-tools";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_DOC_METADATA } from "./kinds";
import { fetchMany } from "../dataLayer";
import {
  decryptWithViewKey,
  encryptWithViewKey,
  parseRootAddress,
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

/**
 * Tag on the owner's v2 roster event carrying the document viewKey, NIP-44
 * encrypted to the owner's own key. The roster shares its replaceable slot with
 * the owner's private metadata (`rosterDTag` is the doc address) and its content
 * is viewKey-encrypted, so without this the owner could only read the roster —
 * and the viewKey-encrypted content — on a device that already had the key.
 * Only the owner can decrypt it; members ignore it.
 */
export const ROSTER_OWNER_KEY_TAG = "owner_viewkey";

function nextCreatedAt(address: string): number {
  const now = Math.floor(Date.now() / 1000);
  const next = Math.max(now, (metaHighWater.get(address) ?? 0) + 1);
  metaHighWater.set(address, next);
  return next;
}

/** An owner roster that decrypted with a local key but has no key backup tag. */
export interface RosterWithoutBackup {
  address: string;
  payload: DocMetadata;
  viewKey: string;
  /** created_at of the roster event that was read. */
  createdAt: number;
}

/**
 * Fetch and decrypt all of the user's metadata events. When
 * `rostersWithoutBackup` is given, owner rosters that could only be read with a
 * locally known viewKey (no `owner_viewkey` tag yet) are appended to it, so the
 * caller can re-save them with `backfillRosterKeyBackups`.
 */
export async function fetchAllDocMetadata(
  relays: string[],
  pubkey: string,
  viewKeys?: Map<string, string>,
  rostersWithoutBackup?: RosterWithoutBackup[],
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
      let meta: DocMetadata;
      try {
        // Self-encrypted: the per-user metadata we have always written.
        meta = JSON.parse(await signer.nip44Decrypt(pubkey, event.content)) as DocMetadata;
      } catch {
        // v2: the owner's shareable roster is encrypted with the document
        // viewKey instead of the owner's own key. Try the locally known
        // viewKey, then the owner's encrypted backup on the event; otherwise
        // leave the event alone so legacy undecryptable events are still
        // skipped as before. The local key can be stale (the page was
        // re-shared under a new key on another device), so a failed local
        // decrypt falls through to the backup instead of dropping the page.
        let viewKey: string | undefined;
        let payload: DocMetadata | undefined;
        const backup = event.tags.find((t) => t[0] === ROSTER_OWNER_KEY_TAG)?.[1];
        const localKey = viewKeys?.get(dTag);
        if (localKey) {
          try {
            payload = JSON.parse(decryptWithViewKey(event.content, localKey)) as DocMetadata;
            viewKey = localKey;
          } catch {
            // stale local key — try the backup below
          }
        }
        if (!payload) {
          if (!backup) throw new Error("no viewKey");
          viewKey = await signer.nip44Decrypt(pubkey, backup);
          payload = JSON.parse(decryptWithViewKey(event.content, viewKey)) as DocMetadata;
        } else if (!backup && viewKey) {
          // Written before the key backup existed: only this device can read
          // it. Let the caller re-save it so other devices can too.
          rostersWithoutBackup?.push({
            address: dTag,
            payload,
            viewKey,
            createdAt: event.created_at,
          });
        }
        meta = { ...payload, viewKey };
      }
      result.set(dTag, meta);
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
  // Keys never go in the roster payload: every member can read it, and an
  // editKey there would hand edit access to viewers.
  const { viewKey: _viewKey, editKey: _editKey, ...payload } = roster;
  const encrypted = encryptWithViewKey(JSON.stringify(payload), viewKey);
  const ownerKeyBackup = await signer.nip44Encrypt!(pubkey, viewKey);

  const event: EventTemplate = {
    kind: KIND_DOC_METADATA,
    tags: [["d", dTag], [ROSTER_OWNER_KEY_TAG, ownerKeyBackup]],
    content: encrypted,
    created_at: nextCreatedAt(dTag),
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);
}

/**
 * Re-save owner rosters that predate the `owner_viewkey` tag, unchanged except
 * for the added key backup. Without it the owner can only read those rosters —
 * and so only see those pages — on a device that already holds the viewKey.
 * Best-effort and one roster at a time; a failure leaves that roster as it was
 * and it is retried on the next load.
 */
export async function backfillRosterKeyBackups(
  pubkey: string,
  rosters: RosterWithoutBackup[],
  relays: string[],
): Promise<void> {
  for (const { address, payload, viewKey, createdAt } of rosters) {
    const parsed = parseRootAddress(address);
    if (!parsed || parsed.owner !== pubkey) continue;
    // Something already re-wrote this roster in this session (a tag, title or
    // member change). saveRoster always adds the backup, and re-saving the
    // payload read earlier would undo that change.
    if ((metaHighWater.get(address) ?? 0) > createdAt) continue;
    try {
      await saveRoster(parsed.owner, parsed.d, viewKey, payload, relays);
    } catch (err) {
      console.warn("Failed to back up the share key for", address, err);
    }
  }
}
