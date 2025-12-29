// src/nostr/fetchFile.ts

import { pool } from "./relayPool";
import type { Event } from "nostr-tools";

export const KIND_FILE = 33457;

export async function fetchAllDocuments(
  relays: string[],
  addDocument: (doc: Event) => void,
  pubkey: string
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const documents: NostrEvent[] = [];

    pool.subscribeMany(
      relays,
      { kinds: [KIND_FILE], authors: [pubkey] },
      {
        onevent: (event: NostrEvent) => {
          console.log("Received document event", event);
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
      }
    );
  });
}
