import { DEFAULT_RELAYS, pool } from "./relayPool";
import { signerManager } from "../signer";
import { KIND_SHARE_INVITE } from "./kinds";
import type { EventTemplate } from "nostr-tools";

export interface ShareInvitePayload {
  type: "share" | "declined";
  address: string;
  replacesAddress?: string;
  viewKey: string;
  editKey?: string;
  title: string;
  senderNpub?: string;
  recipientPubkey?: string;
  recipientNpub?: string;
  originalInviteId?: string;
}

/**
 * Sends a collaboration invite directly to a Nostr account.
 * 
 * Strategy: Publish a Kind 211234 event with NIP-44 encrypted content
 * and a `#p` tag pointing to the recipient. This is a regular signed event
 * that relays will store and serve without NIP-42 AUTH (unlike Gift Wraps).
 * The content is encrypted so only the recipient can read it.
 */
export async function shareDocumentToNpub(
  recipientPubkey: string,
  payload: ShareInvitePayload,
  extraRelays: string[] = [],
) {
  const signer = await signerManager.getSigner();

  if (!signer.nip44Encrypt) {
    throw new Error(
      "Your login method does not support NIP-44 encryption. Please login with an extension like Alby to send invites.",
    );
  }

  const content = JSON.stringify(payload);

  // NIP-44 encrypt the payload for the recipient
  const encryptedContent = await signer.nip44Encrypt(recipientPubkey, content);

  // Publish as a regular signed event — relays serve this without AUTH
  const template: EventTemplate = {
    kind: KIND_SHARE_INVITE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", recipientPubkey]],
    content: encryptedContent,
  };

  const signed = await signer.signEvent(template);

  // Publish to default relays + any extra relays the caller provides
  const relays = [...new Set([...DEFAULT_RELAYS, ...extraRelays])];
  console.log("[ShareInvite] Publishing Kind", KIND_SHARE_INVITE, "to relays:", relays);
  console.log("[ShareInvite] Event ID:", signed.id, "recipient p-tag:", recipientPubkey);

  const results = pool.publish(relays, signed);
  const settled = await Promise.allSettled(results);
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      console.log("[ShareInvite] ✅ Published to", relays[i]);
    } else {
      console.error("[ShareInvite] ❌ Failed on", relays[i], r.reason);
    }
  });

  return signed.id;
}
