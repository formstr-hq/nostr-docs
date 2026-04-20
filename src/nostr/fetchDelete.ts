import type { Event } from "nostr-tools";
import { pool } from "./relayPool";
import { KIND_FILE } from "./kinds";

export const fetchDeleteRequests = (
  relays: string[],
  onEvent: (event: Event) => void,
  pubkey: string,
) => {
  const deleteSubscriptionFilter = {
    kinds: [5], // NIP-09 deletion requests
    "#k": [`${KIND_FILE}`],
    authors: [pubkey],
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

export const hasDeleteRequestForAddress = (
  relays: string[],
  address: string,
) => {
  const deleteSubscriptionFilter = {
    kinds: [5],
    "#k": [`${KIND_FILE}`],
    "#a": [address],
  };

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (deleted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      sub.close();
      resolve(deleted);
    };

    const timeout = setTimeout(() => finish(false), 6000);

    const sub = pool.subscribeMany(relays, deleteSubscriptionFilter, {
      onevent: () => finish(true),
      oneose: () => finish(false),
    });
  });
};
