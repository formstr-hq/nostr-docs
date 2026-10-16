// src/nostr/sharedDoc.ts
//
// Multi-writer encrypted documents (NIP-XX, see NIP-multi-writer-documents.md).
//
// A document is identified by a root address `33457:<owner>:<d>`. Every author
// publishes their own replaceable content event at `33457:<author>:<d>`, all
// encrypted with one shared `viewKey`. The owner publishes a viewKey-encrypted
// roster (kind 34579) listing the editors; clients fetch every author's slot and
// render the newest valid one.
//
// This module is the pure model + the small I/O helpers around it. It is
// deliberately independent of React so the resolution logic can be unit-tested
// and shared by both the document store and the shared-with-me list.

import {
  getPublicKey,
  nip44,
  type Event,
} from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { KIND_DOC_METADATA, KIND_FILE } from "./kinds";
import { fetchMany, fetchOne } from "../dataLayer";

/** How far in the future an event's `created_at` may be before we ignore the
 *  excess when ordering (relays do not validate timestamps). */
export const MAX_CLOCK_SKEW_SEC = 5 * 60;

export type DocRole = "editor" | "viewer";

/**
 * How write access is granted:
 * - `restricted` — only listed `editor` members (and the owner) may author.
 * - `open` — capability model: any holder of the viewKey may author.
 * Control metadata (roster/mode/title/tags) is always owner-authored either way.
 */
export type DocMode = "restricted" | "open";

export interface DocMember {
  pubkey: string;
  role: DocRole;
}

/**
 * Owner-authored, viewKey-encrypted document metadata and access list. Stored
 * in a kind-34579 event whose `d` tag is the document's root address.
 */
export interface DocRoster {
  v: 2;
  mode: DocMode;
  title?: string;
  tags: string[];
  members: DocMember[];
}

/** Parsed components of a root address `33457:<owner>:<d>`. */
export interface RootRef {
  kind: number;
  owner: string;
  d: string;
}

// ── Address helpers ──────────────────────────────────────────────────────────

/**
 * Parse a `kind:pubkey:d` address into its parts. The `d` may itself contain
 * `:` (the app's metadata `d` tags embed a full address), so everything after
 * the second colon is treated as the identifier.
 */
export function parseRootAddress(address: string): RootRef | null {
  const parts = address.split(":");
  if (parts.length < 3) return null;
  const kind = Number(parts[0]);
  if (!Number.isFinite(kind)) return null;
  return { kind, owner: parts[1], d: parts.slice(2).join(":") };
}

/** Canonical root address for a document owned by `owner` with id `d`. */
export function rootAddress(owner: string, d: string): string {
  return `${KIND_FILE}:${owner}:${d}`;
}

/**
 * `d` tag value for the owner's shared metadata event: the document's root
 * address. (The app keys all per-document metadata by the address it describes.)
 */
export function rosterDTag(owner: string, d: string): string {
  return rootAddress(owner, d);
}

// ── viewKey crypto ────────────────────────────────────────────────────────────

/**
 * NIP-44 conversation key for a symmetric viewKey (used as both private and
 * public key), matching `encryptContent`'s viewKey path.
 */
export function viewKeyConversationKey(viewKey: string): Uint8Array {
  const bytes = hexToBytes(viewKey);
  return nip44.getConversationKey(bytes, getPublicKey(bytes));
}

/**
 * Capability-derived, opaque identifier for a document's collaboration channel.
 *
 * Derived from the viewKey's public key, so only viewKey holders can compute it.
 * It reveals nothing about the viewKey (ECDLP) and keeps the document's root
 * address / owner out of the tags of presence, CRDT ops and session attestations
 * — so a third party cannot find or link the collaboration bus from the (public)
 * document root.
 */
export function collabRoom(viewKey: string): string {
  return getPublicKey(hexToBytes(viewKey));
}

export function decryptWithViewKey(ciphertext: string, viewKey: string): string {
  return nip44.decrypt(ciphertext, viewKeyConversationKey(viewKey));
}

export function encryptWithViewKey(plaintext: string, viewKey: string): string {
  return nip44.encrypt(plaintext, viewKeyConversationKey(viewKey));
}

// ── Roster ─────────────────────────────────────────────────────────────────────

/** Parse and validate a decrypted roster payload. Returns null when malformed. */
export function parseRosterPayload(payload: string): DocRoster | null {
  try {
    const parsed = JSON.parse(payload) as Partial<DocRoster>;
    if (!parsed || typeof parsed !== "object") return null;
    const members = Array.isArray(parsed.members) ? parsed.members : [];
    const validMembers: DocMember[] = members
      .filter(
        (m): m is DocMember =>
          !!m &&
          typeof m.pubkey === "string" &&
          (m.role === "editor" || m.role === "viewer"),
      )
      .map((m) => ({ pubkey: m.pubkey, role: m.role }));
    return {
      v: 2,
      mode: parsed.mode === "open" ? "open" : "restricted",
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === "string")
        : [],
      members: validMembers,
    };
  } catch {
    return null;
  }
}

/** Decrypt a roster event's content with the viewKey and parse it. */
export function decodeRosterEvent(event: Event, viewKey: string): DocRoster | null {
  try {
    return parseRosterPayload(decryptWithViewKey(event.content, viewKey));
  } catch {
    return null;
  }
}

/**
 * The set of pubkeys authorized to author content in `restricted` mode: the
 * owner plus every member with the `editor` role. Meaningless in `open` mode,
 * where any viewKey holder may author (see `isOpenRoster`).
 */
export function authorSet(owner: string, roster: DocRoster | null): string[] {
  const set = new Set<string>([owner]);
  if (roster) {
    for (const m of roster.members) {
      if (m.role === "editor") set.add(m.pubkey);
    }
  }
  return [...set];
}

/** True when write access is by capability (viewKey) rather than a roster. */
export function isOpenRoster(roster: DocRoster | null): boolean {
  return roster?.mode === "open";
}

/**
 * Fetch and decrypt the latest roster for a document, if any. Reads through the
 * local relay (cache first, then network) via `fetchOne`.
 */
export async function fetchRoster(
  owner: string,
  d: string,
  viewKey: string,
  relays?: string[],
): Promise<DocRoster | null> {
  const event = await fetchOne(
    [
      {
        kinds: [KIND_DOC_METADATA],
        authors: [owner],
        "#d": [rosterDTag(owner, d)],
      },
    ],
    relays,
  );
  if (!event) return null;
  return decodeRosterEvent(event, viewKey);
}

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Deterministic tip selection across authors. Newest by `created_at`, ties
 * broken by ascending event id so every client agrees. Future timestamps are
 * clamped to `now + MAX_CLOCK_SKEW_SEC`.
 */
export function selectTip(events: Event[], now = Date.now()): Event | null {
  if (events.length === 0) return null;
  const maxCreatedAt = Math.floor(now / 1000) + MAX_CLOCK_SKEW_SEC;
  const createdAt = (e: Event) => Math.min(e.created_at, maxCreatedAt);
  return [...events].sort((a, b) => {
    const at = createdAt(a);
    const bt = createdAt(b);
    if (at !== bt) return bt - at; // newest first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // stable tie-break
  })[0];
}

/**
 * Fetch the newest content event for every authorized author of a document.
 *
 * - `open` mode: query by `["a", root]` (no author filter) so versions by
 *   unknown authors are discoverable; callers must decrypt-filter.
 * - `restricted`/legacy: one `authors + #d` filter; relays return the latest
 *   replaceable event per author.
 */
export async function fetchGroupEvents(
  owner: string,
  d: string,
  roster: DocRoster | null,
  viewKey: string,
  relays?: string[],
): Promise<Event[]> {
  if (isOpenRoster(roster)) {
    // Content events are tagged with the capability-derived room (not the root),
    // so the document owner is not named in the public footprint.
    return fetchMany(
      [{ kinds: [KIND_FILE], "#a": [collabRoom(viewKey)] }],
      relays,
    );
  }
  const authors = authorSet(owner, roster);
  return fetchMany(
    [{ kinds: [KIND_FILE], authors, "#d": [d] }],
    relays,
  );
}

export interface ResolvedDocument {
  owner: string;
  d: string;
  roster: DocRoster | null;
  authors: string[];
  events: Event[];
  tip: Event | null;
}

/**
 * Full group resolution: fetch the roster, derive the query rule from its mode,
 * fetch the matching content events, and pick the tip. Only events that decrypt
 * with the viewKey are returned, so `open` mode cannot inject undecryptable
 * spam into the document. When the roster is absent the group degenerates to a
 * single-author document owned by `owner`.
 */
export async function resolveSharedDocument(
  owner: string,
  d: string,
  viewKey: string,
  relays?: string[],
): Promise<ResolvedDocument> {
  const roster = await fetchRoster(owner, d, viewKey, relays);
  const authors = authorSet(owner, roster);
  const fetched = await fetchGroupEvents(owner, d, roster, viewKey, relays);

  const events = fetched.filter((e) => {
    try {
      decryptWithViewKey(e.content, viewKey);
      return true;
    } catch {
      return false;
    }
  });

  return {
    owner,
    d,
    roster,
    authors,
    events,
    tip: selectTip(events),
  };
}
