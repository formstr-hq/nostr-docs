import { type Event } from "nostr-tools";

/**
 * Unwraps a NIP-17 Gift Wrap to reveal the inner Rumor.
 * 
 * Flow: Gift Wrap (1059) -> Seal (13) -> Rumor
 */
export async function unwrapGiftWrap(
  giftWrap: Event,
  nip44Decrypt: (senderPubkey: string, content: string) => Promise<string | null>
): Promise<Event | null> {
  try {
    // 1. Decrypt Seal from Gift Wrap
    const sealJson = await nip44Decrypt(giftWrap.pubkey, giftWrap.content);
    if (!sealJson) return null;

    let seal: Event;
    try {
      seal = JSON.parse(sealJson);
    } catch {
      return null;
    }

    if (seal.kind !== 13) return null;

    // 2. Decrypt Rumor from Seal
    const rumorJson = await nip44Decrypt(seal.pubkey, seal.content);
    if (!rumorJson) return null;

    let rumor: Event;
    try {
      rumor = JSON.parse(rumorJson);
    } catch {
      return null;
    }

    return rumor;
  } catch (err) {
    console.error("Failed to unwrap gift wrap:", err);
    return null;
  }
}
