import { nip07Signer } from "./NIP07Signer";
import { createNip46Signer } from "./NIP46Signer";
import type { NostrSigner } from "./types";
import {
  getBunkerUriInLocalStorage,
  getKeysFromLocalStorage,
  setBunkerUriInLocalStorage,
  setKeysInLocalStorage,
  removeKeysFromLocalStorage,
  removeBunkerUriFromLocalStorage,
  removeAppSecretFromLocalStorage,
  setGuestSecretInSession,
  getGuestSecretFromSession,
  removeGuestSecretFromSession,
} from "./utils";
import { createLocalSigner } from "./LocalSigner";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

class Signer {
  private signer: NostrSigner | null = null;
  private onChangeCallbacks: Set<() => void> = new Set();
  private loginModalCallback: (() => Promise<void>) | null = null;

  constructor() {
    // Do NOT call restoreFromStorage() here — no onChange listeners are
    // registered yet, so the notify() call would be a no-op that races with
    // the useEffect-triggered call. restoreFromStorage() is called explicitly
    // from the UserContext useEffect after listeners are registered.
  }

  registerLoginModal(callback: () => Promise<void>) {
    this.loginModalCallback = callback;
  }

  async restoreFromStorage() {
    const keys = getKeysFromLocalStorage();
    const bunkerUri = getBunkerUriInLocalStorage();
    const guestSecret = getGuestSecretFromSession();
    try {
      if (bunkerUri?.bunkerUri) {
        await this.loginWithNip46(bunkerUri.bunkerUri);
      } else if (window.nostr && keys?.pubkey && !keys?.secret) {
        // Only restore NIP-07 if we stored a pubkey without a secret (i.e. NIP-07 session)
        await this.loginWithNip07();
      } else if (guestSecret) {
        // Restore guest session from sessionStorage
        await this.loginWithGuestKey(hexToBytes(guestSecret));
      }
    } catch (e) {
      console.error("Signer restore failed:", e);
    }
    this.notify();
  }

  private async loginWithGuestKey(privkey: Uint8Array) {
    this.signer = createLocalSigner(privkey);
  }

  async createGuestAccount(privkey: Uint8Array) {
    this.signer = createLocalSigner(privkey);

    const pubkey = await this.signer.getPublicKey();

    // Store pubkey in localStorage (not the secret — that stays in sessionStorage)
    setKeysInLocalStorage(pubkey);
    // Store secret in sessionStorage only (wiped when tab closes)
    setGuestSecretInSession(bytesToHex(privkey));
    this.notify();
  }

  async loginWithNip07() {
    if (!window.nostr) throw new Error("NIP-07 extension not found");
    this.signer = nip07Signer;
    const pubkey = await window.nostr.getPublicKey();
    setKeysInLocalStorage(pubkey);
    this.notify();
  }

  async loginWithNip46(bunkerUri: string) {
    const remoteSigner = await createNip46Signer(bunkerUri);
    const pubkey = await remoteSigner.getPublicKey();
    setKeysInLocalStorage(pubkey);
    setBunkerUriInLocalStorage(bunkerUri);
    this.signer = remoteSigner;
    this.notify();
  }

  logout() {
    this.signer = null;
    removeKeysFromLocalStorage();
    removeBunkerUriFromLocalStorage();
    removeAppSecretFromLocalStorage();
    removeGuestSecretFromSession();
    this.notify();
  }

  hasSigner(): boolean {
    return this.signer !== null;
  }

  async getSigner(): Promise<NostrSigner> {
    if (this.signer) return this.signer;

    if (this.loginModalCallback) {
      await this.loginModalCallback();
      if (this.signer) return this.signer;
    }

    throw new Error("No signer available and no login modal registered.");
  }

  onChange(cb: () => void) {
    this.onChangeCallbacks.add(cb);
    return () => this.onChangeCallbacks.delete(cb);
  }

  private notify() {
    this.onChangeCallbacks.forEach((cb) => cb());
  }
}

export const signerManager = new Signer();
