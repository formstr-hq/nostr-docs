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
import { KIND_FILE } from "../../nostr/kinds";
import { encodeNKeys } from "../../utils/nkeys";

export const handleSharePublic = () => {
  console.log("TODO: Share publicly");
};

export async function handleGeneratePrivateLink(
  canEdit: boolean,
  selectedDocumentId: string | null,
  docContent: string,
  relays: string[],
  viewKey?: string,
  editKey?: string,
) {
  if (!selectedDocumentId) return;
  const signer = await signerManager.getSigner();

  if (!docContent) return;

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

  // 3️⃣ Create shared event
  const sharedEvent = {
    kind: 33457,
    tags: [["d", selectedDocumentId]],
    content: encryptedContent,
    created_at: Math.floor(Date.now() / 1000),
  };

  // 4️⃣ Sign with editKey if exists, else viewKey
  let signedEvent: Event | null = null;
  if (editKeyUsed) signedEvent = finalizeEvent(sharedEvent, editKeyUsed);
  else {
    signedEvent = await signer.signEvent(sharedEvent);
  }

  // 5️⃣ Publish
  await publishEvent(signedEvent, relays);
  // Store Keys
  const buildTag = [
    `${KIND_FILE}:${
      editKeyUsed ? getPublicKey(editKeyUsed) : await signer.getPublicKey()
    }:${selectedDocumentId}`,
  ];
  if (viewKeyUsed) buildTag.push(bytesToHex(viewKeyUsed));
  if (editKeyUsed) buildTag.push(bytesToHex(editKeyUsed));
  if (buildTag.length > 1) {
    // await addSharedDoc(buildTag);
    // refresh();
  }

  if (editKeyUsed)
    await deleteEvent({
      eventKind: 33457,
      eventId: selectedDocumentId!,
      relays,
      reason: "User requested deletion",
    });

  // 6️⃣ Encode keys in one nkeys string
  const nkeysStr = encodeNKeys({
    viewKey: bytesToHex(viewKeyUsed),
    ...(editKeyUsed && { editKey: bytesToHex(editKeyUsed) }),
  });

  // 7️⃣ Build URL
  const naddr = nip19.naddrEncode({
    kind: 33457,
    pubkey: signedEvent.pubkey,
    identifier: selectedDocumentId,
  });

  const shareUrl = `${window.location.origin}/doc/${naddr}#${nkeysStr}`;

  return shareUrl;
}
