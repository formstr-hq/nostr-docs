import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS, pool } from "./relayPool";

export const fetchProfile = async (
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS
) => {
  return new Promise((resolve, reject) => {
    pool.subscribeMany(
      relays,
      {
        kinds: [0],
        authors: [pubkey],
      },
      {
        onevent: (event: Event) => {
          try {
            const profile = JSON.parse(event.content);
            resolve(profile);
          } catch (e) {
            console.log("couldn't get profile");
            reject();
          }
        },
      }
    );
  });
};
