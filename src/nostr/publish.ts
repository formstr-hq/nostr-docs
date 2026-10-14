import type { Event as NostrEvent } from "nostr-tools";
import { DEFAULT_RELAYS } from "./relayPool";
import {
  publishEvent as dataLayerPublish,
  publishEventStrict as dataLayerPublishStrict,
} from "../dataLayer";

/**
 * Publish through the local relay (offline-durable outbox). Falls back to a
 * plain pool internally if the worker failed to boot.
 */
export async function publishEvent(
  event: NostrEvent,
  relays: string[] = DEFAULT_RELAYS
): Promise<void> {
  await dataLayerPublish(event, relays);
}

/**
 * Like publishEvent, but rejects when no relay accepted the event. Use for
 * data that has no local fallback store (comments, resolutions).
 */
export async function publishEventStrict(
  event: NostrEvent,
  relays: string[] = DEFAULT_RELAYS
): Promise<void> {
  await dataLayerPublishStrict(event, relays);
}
