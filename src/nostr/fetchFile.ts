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
  console.log("Fetch file event called");
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
