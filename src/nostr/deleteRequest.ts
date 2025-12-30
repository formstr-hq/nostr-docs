import { signerManager } from "../signer";
import { publishEvent } from "../nostr/publish";

/**
 * Sends a NIP-09 deletion request for a replaceable document or event.
 * @param eventKind Kind of the event to delete (e.g., 33457)
 * @param eventId The d-tag or unique identifier of the event
 * @param relays List of relay URLs
 * @param reason Optional text explaining deletion
 */
export async function deleteEvent({
  eventKind,
  eventId,
  relays,
  reason = "User requested deletion",
}: {
  eventKind: number;
  eventId: string;
  relays: string[];
  reason?: string;
}) {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer available");

  const pubkey = await signer.getPublicKey!();

  const event = {
    kind: 5, // NIP-09 deletion request
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: reason,
    tags: [
      ["a", `${eventKind}:${pubkey}:${eventId}`],
      ["k", String(eventKind)],
    ],
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);

  return signed;
}
