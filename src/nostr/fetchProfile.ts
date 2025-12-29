import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS, pool } from "./relayPool";

export const fetchProfile = async (pubkey: string) => {
  return new Promise((resolve, reject) => {
    pool.subscribeMany(
      DEFAULT_RELAYS,
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
