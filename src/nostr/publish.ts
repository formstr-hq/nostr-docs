import { pool, DEFAULT_RELAYS } from "./relayPool";
import type { Event as NostrEvent } from "nostr-tools";

export async function publishEvent(
  event: NostrEvent,
  relays: string[] = DEFAULT_RELAYS
): Promise<void> {
  const results = pool.publish(relays, event);
  const settled = await Promise.allSettled(results);
  const successCount = settled.filter(
    (result) => result.status === "fulfilled"
  ).length;

  if (successCount > 0) return;

  const reasons = settled
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )
    .map((result) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason)
    );

  throw new Error(
    reasons.length > 0
      ? `Failed to publish to any relay: ${reasons.join("; ")}`
      : "Failed to publish to any relay"
  );
}
