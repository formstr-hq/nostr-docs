import { signerManager } from "../signer";
import { publishEvent } from "../nostr/publish";

/**
 * Parses an a-link address string into its components.
 * @param address Format: "kind:pubkey:identifier"
 */
function parseAddress(address: string): {
  kind: number;
  pubkey: string;
  identifier: string;
} | null {
  const parts = address.split(":");
  if (parts.length !== 3) return null;
  const [kindStr, pubkey, identifier] = parts;
  const kind = parseInt(kindStr, 10);
  if (isNaN(kind)) return null;
  return { kind, pubkey, identifier };
}

/**
 * Sends a NIP-09 deletion request for a replaceable document or event.
 * @param address The full a-link address (format: "kind:pubkey:identifier")
 * @param relays List of relay URLs
 * @param reason Optional text explaining deletion
 */
export async function deleteEvent({
  address,
  relays,
  reason = "User requested deletion",
}: {
  address: string;
  relays: string[];
  reason?: string;
}) {
  const parsed = parseAddress(address);
  if (!parsed) {
    throw new Error(`Invalid address format: ${address}`);
  }

  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer available");

  const signerPubkey = await signer.getPublicKey!();

  const event = {
    kind: 5, // NIP-09 deletion request
    pubkey: signerPubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: reason,
    tags: [
      ["a", address],
      ["k", String(parsed.kind)],
    ],
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);

  return signed;
}
