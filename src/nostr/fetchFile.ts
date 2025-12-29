// src/nostr/fetchFile.ts

import { pool } from "./relayPool";
import type { Event as NostrEvent } from "nostr-tools";

export const KIND_FILE = 33457;

/**
 * Fetch the latest replaceable file event (KIND_FILE) for a given docId
 * using the modern nostr-tools subscribeMany API with onevent/eose callbacks.
 */
export async function fetchLatestFileEvent(
  docId: string,
  relays: string[]
): Promise<NostrEvent | null> {
  console.log("Fetch file event called", docId);
  return new Promise((resolve) => {
    let latest: NostrEvent | null = null;

    pool.subscribeMany(
      relays,
      { kinds: [KIND_FILE], "#d": [docId] },
      {
        onevent: (event: NostrEvent) => {
          console.log("Received event", event);
          if (!latest || event.created_at > latest.created_at) {
            latest = event;
          }
        },
        oneose: () => {
          resolve(latest);
        },
      }
    );
  });
}

/**
 * Fetch all replaceable file events (KIND_FILE) from relays
 * using the modern nostr-tools subscribeMany API.
 * Groups by d-tag and returns only the latest version of each document.
 */
export async function fetchAllDocuments(
  relays: string[]
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const documents: NostrEvent[] = [];

    pool.subscribeMany(
      relays,
      { kinds: [KIND_FILE] },
      {
        onevent: (event: NostrEvent) => {
          console.log("Received document event", event);
          documents.push(event);
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
