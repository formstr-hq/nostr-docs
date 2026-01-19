import { getPublicKey, nip44 } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { signerManager } from "../signer";

export const encryptContent = async (content: string, viewKey?: string) => {
  if (viewKey) {
    const conversationKey = nip44.getConversationKey(
      hexToBytes(viewKey),
      getPublicKey(hexToBytes(viewKey)),
    );
    const encryptedcontent = nip44.encrypt(content, conversationKey);
    return Promise.resolve(encryptedcontent);
  }
  const signer = await signerManager.getSigner();
  if (!signer) return;
  return signer.nip44Encrypt!(await signer.getPublicKey(), content);
};
