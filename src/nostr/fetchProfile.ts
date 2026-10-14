import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS } from "./relayPool";
import { fetchOne } from "../dataLayer";

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
 * Fetches kind-0 profile metadata for a given pubkey across target and metadata
 * relays, picking the latest valid event by created_at.
 */
export const fetchProfile = async (
  pubkey: string,
  relays: string[] = DEFAULT_RELAYS,
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kind-0 metadata is schemaless JSON
): Promise<Record<string, any> | null> => {
  try {
    const targetRelays = Array.from(new Set([...relays, ...METADATA_RELAYS]));
    const event = (await fetchOne(
      [{ kinds: [0], authors: [pubkey] }],
      targetRelays,
      3500,
    )) as Event | null;

    if (!event) return null;
    const profile = JSON.parse(event.content);
    return profile && typeof profile === "object" ? profile : null;
  } catch (e) {
    console.error("Failed to fetch kind 0 profile:", e);
    return null;
  }
};
