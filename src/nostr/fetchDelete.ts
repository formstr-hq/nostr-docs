import type { Event } from "nostr-tools";
import { KIND_FILE } from "./fetchFile";
import { pool } from "./relayPool";

export const fetchDeleteRequests = (
  relays: string[],
  onEvent: (event: Event) => void
) => {
  const deleteSubscriptionFilter = {
    kinds: [5], // NIP-09 deletion requests
    "#k": [`${KIND_FILE}`],
  };
  return new Promise((resolve) => {
    pool.subscribeMany(relays, deleteSubscriptionFilter, {
      onevent: (event: Event) => {
        onEvent(event);
      },
      oneose: () => {
        resolve(undefined);
      },
    });
  });
};
