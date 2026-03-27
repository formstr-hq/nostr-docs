import type { EventTemplate, Event } from "nostr-tools";
import { getEventHash, nip19 } from "nostr-tools";
import type { NostrSigner } from "./types";

// Default to Amber; other NIP-55 signers can override via packageName
export const AMBER_PACKAGE = "com.greenart7c3.nostrsigner";

export function createNIP55Signer(
  packageName: string,
  initialPubkey?: string
): NostrSigner {
  let cachedPubkey: string | undefined = initialPubkey;
  let packageNameSet = false;

  const ensurePackage = async () => {
    if (!packageNameSet) {
      const { NostrSignerPlugin } = await import(
        "nostr-signer-capacitor-plugin"
      );
      await NostrSignerPlugin.setPackageName(packageName);
      packageNameSet = true;
    }
  };

  const plugin = async () => {
    await ensurePackage();
    const { NostrSignerPlugin } = await import("nostr-signer-capacitor-plugin");
    return NostrSignerPlugin;
  };

  return {
    async getPublicKey(): Promise<string> {
      if (cachedPubkey) {
        await ensurePackage();
        return cachedPubkey;
      }
      const p = await plugin();
      const { npub } = await p.getPublicKey();
      cachedPubkey = nip19.decode(npub).data as string;
      return cachedPubkey;
    },

    async signEvent(event: EventTemplate): Promise<Event> {
      const pubkey = await this.getPublicKey();
      const fullEvent = { ...event, pubkey };
      const id = getEventHash(fullEvent);
      const eventWithId = { ...fullEvent, id };
      const p = await plugin();
      const { event: signedJson } = await p.signEvent(
        packageName,
        JSON.stringify(eventWithId),
        eventWithId.id,
        pubkey
      );
      if (!signedJson) throw new Error("Signer did not return a signed event");
      return JSON.parse(signedJson) as Event;
    },

    async encrypt(pubkey: string, plaintext: string): Promise<string> {
      const currentPubkey = await this.getPublicKey();
      const p = await plugin();
      const { result } = await p.nip04Encrypt(
        packageName, plaintext, "", pubkey, currentPubkey
      );
      if (!result) throw new Error("NIP-04 encryption failed");
      return result;
    },

    async decrypt(pubkey: string, ciphertext: string): Promise<string> {
      const currentPubkey = await this.getPublicKey();
      const p = await plugin();
      const { result } = await p.nip04Decrypt(
        packageName, ciphertext, "", pubkey, currentPubkey
      );
      if (!result) throw new Error("NIP-04 decryption failed");
      return result;
    },

    async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
      const currentPubkey = await this.getPublicKey();
      const p = await plugin();
      const { result } = await p.nip44Encrypt(
        packageName, plaintext, "", pubkey, currentPubkey
      );
      if (!result) throw new Error("NIP-44 encryption failed");
      return result;
    },

    async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
      const currentPubkey = await this.getPublicKey();
      const p = await plugin();
      const { result } = await p.nip44Decrypt(
        packageName, ciphertext, "", pubkey, currentPubkey
      );
      if (!result) throw new Error("NIP-44 decryption failed");
      return result;
    },
  };
}
