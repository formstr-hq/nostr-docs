import type { Event } from "nostr-tools";
import { DOCUMENT_KINDS } from "./kinds";
import { fetchMany } from "../dataLayer";

export const fetchDeleteRequests = (
  relays: string[],
  onEvent: (event: Event) => void,
  pubkey: string,
) => {
  const deleteSubscriptionFilter = {
    kinds: [5], // NIP-09 deletion requests
    "#k": DOCUMENT_KINDS.map(String),
    authors: [pubkey],
  };
  return fetchMany([deleteSubscriptionFilter], relays, 8000)
    .then((events) => {
      events.forEach(onEvent);
      return undefined;
    })
    .catch(() => undefined);
};
