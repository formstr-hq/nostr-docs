import {
  nip44,
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from "nostr-tools";
import type { EventTemplate, UnsignedEvent } from "nostr-tools";
import { publishEvent } from "./publish";
import { DEFAULT_RELAYS } from "./relayPool";
import { signerManager } from "../signer";

// Helper to get Inbox Relays — simplistic version for docs
async function fetchUserRelays(): Promise<string[]> {
  // In a robust implementation, we would fetch Kind 10050.
  // We fall back to DEFAULT_RELAYS.
  return DEFAULT_RELAYS;
}

function randomTimestamp(): number {
  return Math.floor(Date.now() / 1000); // Send now
}

export async function shareDocumentToNpub(recipientPubkey: string, url: string, title: string) {
  const signer = await signerManager.getSigner();
  const senderPubkey = await signer.getPublicKey();
  
  const content = `I've shared a secure document with you: "${title}"\n\nAccess it here: ${url}`;

  let eventToSend: EventTemplate | UnsignedEvent;

  // Prefer NIP-17 Gift Wraps (Requires NIP-44)
  if (signer.nip44Encrypt) {
    // 1. Create Rumor (Kind 14)
    const tags = [["p", recipientPubkey]];
    const unsignedRumor: UnsignedEvent = {
        kind: 14,
        created_at: randomTimestamp(),
        tags,
        content,
        pubkey: senderPubkey,
    };
    
    // 2. Encrypt into Seal (Kind 13)
    const rumorJson = JSON.stringify(unsignedRumor);
    const encryptedRumor = await signer.nip44Encrypt(recipientPubkey, rumorJson);
    
    const sealTemplate: EventTemplate = {
        kind: 13,
        created_at: randomTimestamp(),
        tags: [],
        content: encryptedRumor,
    };
    const seal = await signer.signEvent(sealTemplate);

    // 3. Wrap in Ephemeral Gift Wrap (Kind 1059)
    const ephemeralKey = generateSecretKey();

    const sealJson = JSON.stringify(seal);
    const conversationKey = nip44.getConversationKey(ephemeralKey, recipientPubkey);
    const encryptedSeal = nip44.encrypt(sealJson, conversationKey);

    eventToSend = finalizeEvent({
        kind: 1059,
        created_at: randomTimestamp(),
        tags: [["p", recipientPubkey]],
        content: encryptedSeal,
    }, ephemeralKey);

  } else if (signer.encrypt) {
    // Fallback to older NIP-04 Direct Messaging
    const encryptedContent = await signer.encrypt(recipientPubkey, content);
    
    eventToSend = await signer.signEvent({
        kind: 4,
        created_at: randomTimestamp(),
        tags: [["p", recipientPubkey]],
        content: encryptedContent,
    });
  } else {
    throw new Error("Your login method does not support messaging encryption. Please login with an extension like Alby to send invites.");
  }

  // Publish to relays
  const relays = await fetchUserRelays();
  await publishEvent(eventToSend as any, relays);
}
