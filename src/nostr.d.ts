// src/nostr/nostr.d.ts

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface NostrExtension {
  getPublicKey?: () => Promise<string>;
  signEvent: (event: NostrEvent) => Promise<NostrEvent>;
  signMessage?: (message: string) => Promise<string>;
  getRelays?: () => Promise<Record<string, { read: boolean; write: boolean }>>;
}

interface Window {
  nostr?: NostrExtension;
}
