import type { Event } from "nostr-tools";
import { pool } from "./relayPool";
import { KIND_FILE } from "./kinds";

export const fetchDeleteRequests = (
  relays: string[],
  onEvent: (event: Event) => void,
) => {
  const deleteSubscriptionFilter = {
    kinds: [5], // NIP-09 deletion requests
    "#k": [`${KIND_FILE}`],
  };
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      sub.close();
      resolve(undefined);
    };

    const timeout = setTimeout(finish, 8000);

    const sub = pool.subscribeMany(relays, deleteSubscriptionFilter, {
      onevent: (event: Event) => {
        onEvent(event);
      },
      oneose: finish,
    });
  });
};
