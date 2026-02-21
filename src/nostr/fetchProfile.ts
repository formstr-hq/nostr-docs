import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS, pool } from "./relayPool";

export const fetchProfile = async (
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
) => {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const sub = pool.subscribeMany(
      relays,
      {
        kinds: [0],
        authors: [pubkey],
      },
      {
        onevent: (event: Event) => {
          if (resolved) return;
          try {
            const profile = JSON.parse(event.content);
            resolved = true;
            sub.close();
            resolve(profile);
          } catch (e) {
            reject(e);
          }
        },
        oneose: () => {
          sub.close();
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        },
      },
    );
  });
};
