// src/nostr/nostr.d.ts

import type { UnsignedEvent } from "nostr-tools";
import type { WindowNostr } from "nostr-tools/nip07";

declare global {
  interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }

  interface Window {
    nostr?: WindowNostr;
  }
}

// This ensures the file is a module (so TS picks it up)
export {};
