// singletons/Signer/LocalSigner.ts
import { getPublicKey, finalizeEvent, nip04, nip44 } from "nostr-tools";
import type { NostrSigner } from "./types";
export function createLocalSigner(privkey: Uint8Array): NostrSigner {
  const pubkey = getPublicKey(privkey);

  return {
    getPublicKey: async () => pubkey,

    signEvent: async (event) => {
      const signedEvent = finalizeEvent(event, privkey);
      return signedEvent;
    },

    encrypt: async (peerPubkey: string, plaintext: string) => {
      return nip04.encrypt(privkey, peerPubkey, plaintext);
    },

    decrypt: async (peerPubkey: string, ciphertext: string) => {
      return nip04.decrypt(privkey, peerPubkey, ciphertext);
    },

    nip44Encrypt: async (peerPubkey, plaintext) => {
      let conversationKey = nip44.v2.utils.getConversationKey(
        privkey,
        peerPubkey
      );
      return nip44.v2.encrypt(plaintext, conversationKey);
    },

    nip44Decrypt: async (peerPubkey, ciphertext) => {
      let conversationKey = nip44.v2.utils.getConversationKey(
        privkey,
        peerPubkey
      );
      return nip44.v2.decrypt(ciphertext, conversationKey);
    },
  };
}
