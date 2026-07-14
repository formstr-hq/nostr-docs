import { pool, DEFAULT_RELAYS } from "./relayPool";
import type { Event as NostrEvent } from "nostr-tools";

export type PublishResult = {
  relay: string;
  status: "accepted" | "rejected";
  time: number;
  reason?: string;
};

export async function publishEvent(
  event: NostrEvent,
  relays: string[] = DEFAULT_RELAYS
): Promise<PublishResult[]> {
  const promises = relays.map(async (relay) => {
    const start = performance.now();
    try {
      await Promise.any(pool.publish([relay], event));
      const end = performance.now();
      return {
        relay,
        status: "accepted" as const,
        time: Math.round(end - start),
      };
    } catch (err: any) {
      const end = performance.now();
      let reason = err?.message || "no reason provided";
      if (err instanceof AggregateError && err.errors.length > 0) {
        reason = err.errors[0]?.message || err.errors[0] || reason;
      }
      return {
        relay,
        status: "rejected" as const,
        time: Math.round(end - start),
        reason: reason.toString(),
      };
    }
  });

  return Promise.all(promises);
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
