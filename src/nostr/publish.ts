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

/**
 * Like publishEvent, but rejects when no relay accepted the event. Use for
 * data that has no local fallback store (comments, resolutions) — with
 * publishEvent a total relay failure is silent and the data is simply lost
 * on reload.
 */
export async function publishEventStrict(
  event: NostrEvent,
  relays: string[] = DEFAULT_RELAYS
): Promise<void> {
  const results = await Promise.allSettled(pool.publish(relays, event));
  if (!results.some((r) => r.status === "fulfilled")) {
    throw new Error("Event was not accepted by any relay");
  }
}
