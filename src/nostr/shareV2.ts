// src/nostr/shareV2.ts
//
// v2 share mechanics for multi-writer encrypted documents
// (NIP-multi-writer-documents.md). These are the data-layer primitives the share
// UI calls; they do not decide UX. Everything is owner-signed and backward
// compatible — legacy edit-key shares are untouched and still work.
//
// A v2 document keeps its root address (`33457:<owner>:<d>`). The owner:
//   1. re-publishes their own content encrypted with the document viewKey so
//      members can read it, and
//   2. publishes a viewKey-encrypted roster (kind 34579) listing editors.
// Members then author their own versions under their own pubkeys.

import type { Event } from "nostr-tools";
import { signerManager } from "../signer";
import { publishEvent } from "./publish";
import { KIND_FILE } from "./kinds";
import { cacheLocalEvents } from "../dataLayer";
import { collabRoom, encryptWithViewKey, fetchRoster, type DocMember, type DocMode, type DocRole } from "./sharedDoc";
import {
  saveRoster,
  type DocMetadata,
} from "./docMetadata";

/**
 * Re-publish the owner's own version of a document, encrypted with the shared
 * viewKey (instead of the owner's own key) so every member can decrypt it. Signs
 * with the owner's real signer.
 */
export async function publishOwnerContent(
  owner: string,
  d: string,
  viewKey: string,
  content: string,
  relays: string[],
  createdAt?: number,
): Promise<Event> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer");

  const pubkey = await signer.getPublicKey();
  if (pubkey !== owner) {
    throw new Error("Only the document owner can publish the root content");
  }

  const encrypted = encryptWithViewKey(content, viewKey);
  const signed = await signer.signEvent({
    kind: KIND_FILE,
    tags: [["d", d], ["a", collabRoom(viewKey)]],
    content: encrypted,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
  });

  await publishEvent(signed, relays);
  cacheLocalEvents([signed]);
  return signed;
}

/**
 * Turn the owner's document into a v2 group document: publish the owner's
 * content under the viewKey and a roster. `members` seeds editors (restricted
 * mode); `mode` selects capability ("open") vs roster ("restricted") writes.
 */
export async function enableGroupSharing(
  owner: string,
  d: string,
  viewKey: string,
  content: string,
  relays: string[],
  members: DocMember[] = [],
  mode: DocMode = "restricted",
  createdAt?: number,
): Promise<Event> {
  const event = await publishOwnerContent(owner, d, viewKey, content, relays, createdAt);
  await saveRoster(owner, d, viewKey, { v: 2, mode, tags: [], members }, relays);
  return event;
}

/**
 * Replace the roster's member list, preserving any title/tags already stored on
 * the owner's roster metadata (and the current mode unless `mode` is given).
 * Owner-only.
 */
export async function updateRosterMembers(
  owner: string,
  d: string,
  viewKey: string,
  members: DocMember[],
  relays: string[],
  mode?: DocMode,
): Promise<void> {
  const current = await fetchRoster(owner, d, viewKey, relays);
  const roster: DocMetadata = {
    v: 2,
    mode: mode ?? current?.mode ?? "restricted",
    tags: current?.tags ?? [],
    title: current?.title,
    members,
  };
  await saveRoster(owner, d, viewKey, roster, relays);
}

/** Switch the document's write-authorization mode, preserving everything else. */
export async function setDocMode(
  owner: string,
  d: string,
  viewKey: string,
  mode: DocMode,
  relays: string[],
): Promise<void> {
  const current = await fetchRoster(owner, d, viewKey, relays);
  await saveRoster(owner, d, viewKey, {
    v: 2,
    mode,
    tags: current?.tags ?? [],
    title: current?.title,
    members: current?.members ?? [],
  }, relays);
}

/** Insert or update a member (idempotent by pubkey). */
export function upsertMember(
  members: DocMember[],
  pubkey: string,
  role: DocRole,
): DocMember[] {
  const next = members.filter((m) => m.pubkey !== pubkey);
  next.push({ pubkey, role });
  return next;
}

/** Remove a member by pubkey. */
export function removeMember(members: DocMember[], pubkey: string): DocMember[] {
  return members.filter((m) => m.pubkey !== pubkey);
}
