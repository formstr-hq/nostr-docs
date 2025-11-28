import { pool, DEFAULT_RELAYS } from "./relayPool";
import type { Event as NostrEvent } from "nostr-tools";

export async function publishEvent(
  event: NostrEvent,
  relays: string[] = DEFAULT_RELAYS
): Promise<void> {
  const results = pool.publish(relays, event); // returns Promise<void>[]

  // wait for all to settle (resolve or fail)
  await Promise.allSettled(results);
}
