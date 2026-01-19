// src/nostr/fetchFile.ts

import type { AddressPointer } from "nostr-tools/nip19";
import { pool } from "./relayPool";
import { nip19, type Event } from "nostr-tools";
import { KIND_FILE } from "./kinds";

export async function fetchAllDocuments(
  relays: string[],
  addDocument: (doc: Event) => void,
  pubkey: string,
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const documents: NostrEvent[] = [];

    pool.subscribeMany(
      relays,
      { kinds: [KIND_FILE], authors: [pubkey] },
      {
        onevent: (event: NostrEvent) => {
          addDocument(event);
        },
        oneose: () => {
          // Group by d-tag and select latest version
          const grouped: Record<string, NostrEvent> = {};

          for (const event of documents) {
            let dTag: string | undefined;

            // Extract d-tag from event tags
            for (const tag of event.tags) {
              if (tag.length >= 2 && tag[0] === "d") {
                dTag = tag[1];
                break;
              }
            }

            if (dTag) {
              // Keep the latest event for this d-tag
              if (
                !grouped[dTag] ||
                event.created_at > grouped[dTag].created_at
              ) {
                grouped[dTag] = event;
              }
            }
          }

          resolve(Object.values(grouped));
        },
      },
    );
  });
}

export async function fetchDocumentByNaddr(
  relays: string[],
  naddr: string,
  onEvent: (event: Event) => void,
): Promise<Event | null> {
  const { kind, pubkey, identifier } = nip19.decode(naddr)
    .data as AddressPointer;
  return new Promise((resolve) => {
    let latestEvent: Event | null = null;

    pool.subscribeMany(
      relays,
      { kinds: [kind], "#d": [identifier], authors: [pubkey] }, // filter by d-tag = naddr
      {
        onevent: (event: Event) => {
          onEvent(event);
        },
        oneose: () => {
          resolve(latestEvent);
        },
      },
    );
  });
}

export const fetchEventsByKind = (
  relays: string[],
  kind: number,
  pubkey: string,
  onEvent: (event: Event) => void,
) => {
  return new Promise((resolve) => {
    let latestEvent: Event | null = null;

    pool.subscribeMany(
      relays,
      { kinds: [kind], authors: [pubkey] }, // filter by d-tag = naddr
      {
        onevent: (event: Event) => {
          onEvent(event);
        },
        oneose: () => {
          resolve(latestEvent);
        },
      },
    );
  });
};
