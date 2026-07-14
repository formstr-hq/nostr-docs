import { loadAllLocalEvents, markBroadcast } from "./localStore";
import { publishEventStrict } from "../nostr/publish";

/**
 * Retries locally-stored events that were never confirmed as broadcast
 * (`pendingBroadcast: true`) — e.g. a save made while offline, or one whose
 * relay publish failed. Nothing else in the codebase currently retries
 * these; call this periodically (see useSyncRetrySweep) and on reconnect.
 */
export async function retryPendingBroadcasts(relays: string[]): Promise<void> {
  const pending = (await loadAllLocalEvents()).filter(
    (e) => e.pendingBroadcast && !e.localOnly,
  );

  for (const entry of pending) {
    try {
      await publishEventStrict(entry.event, relays);
      await markBroadcast(entry.address);
    } catch {
      // Still pending — picked up again on the next sweep.
    }
  }
}
