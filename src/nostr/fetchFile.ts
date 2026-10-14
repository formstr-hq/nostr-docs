// src/nostr/fetchFile.ts

import type { AddressPointer } from "nostr-tools/nip19";
import { nip19, type Event } from "nostr-tools";
import { KIND_FILE } from "./kinds";
import { fetchMany, fetchOne, seenOn } from "../dataLayer";

export async function fetchAllDocuments(
  relays: string[],
  addDocument: (doc: Event) => void,
  pubkey: string,
): Promise<{ relayMap: Map<string, string[]> }> {
  const events = await fetchMany(
    [{ kinds: [KIND_FILE], authors: [pubkey] }],
    relays,
    8000,
  );

  // Stream every unique version to the caller (matches the old per-relay
  // subscription behaviour), then group to the latest per d-tag for hints.
  const seenIds = new Set<string>();
  const latestByD: Record<string, Event> = {};
  for (const event of events) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    if (dTag && (!latestByD[dTag] || event.created_at > latestByD[dTag].created_at)) {
      latestByD[dTag] = event;
    }
    if (!seenIds.has(event.id)) {
      seenIds.add(event.id);
      addDocument(event);
    }
  }

  const relayMap = new Map<string, string[]>();
  await Promise.all(
    Object.values(latestByD).map(async (event) => {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1];
      if (!dTag) return;
      const address = `${event.kind}:${event.pubkey}:${dTag}`;
      relayMap.set(address, await seenOn(event.id));
    }),
  );

  return { relayMap };
}

export async function fetchDocumentByNaddr(
  relays: string[],
  naddr: string,
  onEvent: (event: Event) => void,
): Promise<Event | null> {
  const { kind, pubkey, identifier } = nip19.decode(naddr)
    .data as AddressPointer;
  const latest = await fetchOne(
    [{ kinds: [kind], "#d": [identifier], authors: [pubkey] }],
    relays,
  );
  if (latest) onEvent(latest);
  return latest;
}

export const fetchEventsByKind = async (
  relays: string[],
  kind: number,
  pubkey: string,
  onEvent: (event: Event) => void,
): Promise<Event | null> => {
  const latest = await fetchOne([{ kinds: [kind], authors: [pubkey] }], relays);
  if (latest) onEvent(latest);
  return latest;
};
