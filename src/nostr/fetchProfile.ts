import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS, pool } from "./relayPool";

// High-speed profile metadata relays (including purplepag.es profile directory)
const METADATA_RELAYS = [
  "wss://purplepag.es",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://user.kind0.page",
  "wss://relay.snort.social",
];

/**
 * Fetches kind-0 profile metadata for a given pubkey across target and metadata relays.
 * Subscribes across all connected relays and picks the latest metadata event by created_at.
 */
export const fetchProfile = async (
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kind-0 metadata is schemaless JSON
): Promise<Record<string, any> | null> => {
  return new Promise((resolve) => {
    try {
      const targetRelays = Array.from(new Set([...relays, ...METADATA_RELAYS]));
      const events: Event[] = [];
      let settled = false;
      let eoseCount = 0;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subs.forEach((s) => {
          try {
            s.close();
          } catch {} // eslint-disable-line no-empty
        });

        if (events.length === 0) {
          resolve(null);
          return;
        }

        // Sort descending by created_at to select the newest metadata
        events.sort((a, b) => b.created_at - a.created_at);

        for (const event of events) {
          try {
            const profile = JSON.parse(event.content);
            if (profile && typeof profile === "object") {
              resolve(profile);
              return;
            }
          } catch {} // eslint-disable-line no-empty
        }

        resolve(null);
      };

      const timeout = setTimeout(finish, 3500);

      const subs = targetRelays.map((relay) =>
        pool.subscribeMany(
          [relay],
          { kinds: [0], authors: [pubkey] },
          {
            onevent(event) {
              events.push(event);
            },
            oneose() {
              eoseCount++;
              if (eoseCount >= targetRelays.length) {
                finish();
              }
            },
          },
        ),
      );
    } catch (e) {
      console.error("Failed to fetch kind 0 profile:", e);
      resolve(null);
    }
  });
};
