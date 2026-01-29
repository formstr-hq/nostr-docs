import { getPublicKey, nip44 } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { signerManager } from "../signer";

export const encryptContent = async (
  content: string,
  viewKey?: string,
): Promise<string> => {
  if (viewKey) {
    const conversationKey = nip44.getConversationKey(
      hexToBytes(viewKey),
      getPublicKey(hexToBytes(viewKey)),
    );
    return nip44.encrypt(content, conversationKey);
  }

  const signer = await signerManager.getSigner();
  if (!signer) {
    throw new Error("No signer available for encryption");
  }

  const pubkey = await signer.getPublicKey();
  const encrypted = await signer.nip44Encrypt!(pubkey, content);
  if (!encrypted) {
    throw new Error("Encryption failed");
  }
  return encrypted;
};
