// src/nostr/crdt.ts

import { pool } from "./relayPool";
import * as Y from "yjs";
import type { Event as NostrEvent } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";

export const KIND_CRDT_OP = 22457;

export function subscribeCRDTOps(
  docId: string,
  relays: string[],
  ydoc: Y.Doc,
): SubCloser {
  return pool.subscribeMany(
    relays,
    { kinds: [KIND_CRDT_OP], "#d": [docId] },
    {
      onevent: (event: NostrEvent) => {
        try {
          const update = Uint8Array.from(atob(event.content), (c) =>
            c.charCodeAt(0)
          );
          Y.applyUpdate(ydoc, update);
        } catch (err) {
          console.error("Failed to apply CRDT op:", err);
        }
      },
      oneose: () => {
        console.log("CRDT subscription end of stored events");
      },
    }
  );
}
