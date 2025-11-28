// src/nostr/crdt.ts

import { pool } from "./relayPool";
import * as Y from "yjs";
import type { Event as NostrEvent } from "nostr-tools";

export const KIND_CRDT_OP = 22457;

export function subscribeCRDTOps(docId: string, relays: string[], ydoc: Y.Doc) {
  pool.subscribeMany(
    relays,
    { kinds: [KIND_CRDT_OP], "#d": [docId] },
    {
      onevent: (event: NostrEvent) => {
        console.log("Received event change", event);
        try {
          const update = Uint8Array.from(atob(event.content), (c) =>
            c.charCodeAt(0)
          );
          Y.applyUpdate(ydoc, update);
          console.log("Update is");
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
