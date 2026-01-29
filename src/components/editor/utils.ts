import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  nip44,
  type Event,
} from "nostr-tools";
import { getConversationKey } from "nostr-tools/nip44";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { signerManager } from "../../signer";
import { publishEvent } from "../../nostr/publish";
import { deleteEvent } from "../../nostr/deleteRequest";
import { encodeNKeys } from "../../utils/nkeys";
import { KIND_FILE } from "../../nostr/kinds";

export const handleSharePublic = () => {
  console.log("TODO: Share publicly");
};

/**
 * Parses an a-link address into its components.
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

export async function handleGeneratePrivateLink(
  canEdit: boolean,
  selectedDocumentId: string | null,
  docContent: string,
  relays: string[],
  viewKey?: string,
  editKey?: string,
): Promise<string> {
  if (!selectedDocumentId) {
    throw new Error("No document selected");
  }
  if (!docContent) {
    throw new Error("Document content is empty");
  }

  // Parse the address to extract components (selectedDocumentId is an a-link: "kind:pubkey:identifier")
  const parsed = parseAddress(selectedDocumentId);
  if (!parsed) {
    throw new Error("Invalid document address format");
  }
  const { identifier: dTag } = parsed;

  const signer = await signerManager.getSigner();

  // 1️⃣ Generate keys
  const viewKeyUsed = viewKey ? hexToBytes(viewKey) : generateSecretKey();
  const editKeyUsed = canEdit
    ? editKey
      ? hexToBytes(editKey)
      : generateSecretKey()
    : null;

  const conversationKey = getConversationKey(
    viewKeyUsed,
    getPublicKey(viewKeyUsed),
  );
  const encryptedContent = nip44.encrypt(docContent, conversationKey);

  // 2️⃣ Create shared event with the same d-tag
  const sharedEvent = {
    kind: KIND_FILE,
    tags: [["d", dTag]],
    content: encryptedContent,
    created_at: Math.floor(Date.now() / 1000),
  };

  // 3️⃣ Sign with editKey if provided, otherwise use user's signer
  let signedEvent: Event;
  if (editKeyUsed) {
    signedEvent = finalizeEvent(sharedEvent, editKeyUsed);
  } else {
    if (!signer) {
      throw new Error("No signer available");
    }
    signedEvent = await signer.signEvent(sharedEvent);
  }

  // 4️⃣ Publish the new shared event first
  await publishEvent(signedEvent, relays);

  // 5️⃣ If sharing with edit permissions, delete the original after successful publish
  if (editKeyUsed) {
    await deleteEvent({
      address: selectedDocumentId,
      relays,
      reason: "Document transferred to new owner",
    });
  }

  // 6️⃣ Encode keys in one nkeys string
  const nkeysStr = encodeNKeys({
    viewKey: bytesToHex(viewKeyUsed),
    ...(editKeyUsed && { editKey: bytesToHex(editKeyUsed) }),
  });

  // 7️⃣ Build URL
  const naddr = nip19.naddrEncode({
    kind: KIND_FILE,
    pubkey: signedEvent.pubkey,
    identifier: dTag,
  });

  const shareUrl = `${window.location.origin}/doc/${naddr}#${nkeysStr}`;

  return shareUrl;
}
