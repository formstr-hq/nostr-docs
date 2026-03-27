import { nip07Signer, clearNip07PubKeyCache } from "./NIP07Signer";
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
  setNsecFlag,
  getNsecFlag,
  removeNsecFlag,
  setNip55Package,
  getNip55Package,
  removeNip55Package,
} from "./utils";
import { saveNsec, loadNsec, removeNsec } from "./secureStorage";
import { createLocalSigner } from "./LocalSigner";
import { createNIP55Signer } from "./NIP55Signer";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { nip19 } from "nostr-tools";

class Signer {
  private signer: NostrSigner | null = null;
  private onChangeCallbacks: Set<() => void> = new Set();
  private loginModalCallback: (() => Promise<void>) | null = null;
  private restorePromise: Promise<void> | null = null;

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
    this.restorePromise = this._restoreFromStorage();
    await this.restorePromise;
  }

  private async _restoreFromStorage() {
    const keys = getKeysFromLocalStorage();
    const bunkerUri = getBunkerUriInLocalStorage();
    const guestSecret = getGuestSecretFromSession();
    try {
      const nip55Package = getNip55Package();
      if (nip55Package) {
        const keys = getKeysFromLocalStorage();
        this.signer = createNIP55Signer(nip55Package, keys?.pubkey);
      } else if (getNsecFlag()) {
        const nsec = await loadNsec();
        if (nsec) {
          await this.loginWithNsec(nsec, false); // false = don't re-save
        }
      } else if (bunkerUri?.bunkerUri) {
        await this.loginWithNip46(bunkerUri.bunkerUri);
      } else if (window.nostr && keys?.pubkey) {
        await this.loginWithNip07();
      } else if (guestSecret) {
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
    // Store secret in localStorage (persists across sessions)
    setGuestSecretInSession(bytesToHex(privkey));
    this.notify();
  }

  async loginWithNip55(packageName: string) {
    const signer = createNIP55Signer(packageName);
    const pubkey = await signer.getPublicKey();
    this.signer = signer;
    setKeysInLocalStorage(pubkey);
    setNip55Package(packageName);
    this.notify();
  }

  async loginWithNsec(nsec: string, persist = true) {
    const decoded = nip19.decode(nsec.trim());
    if (decoded.type !== "nsec") throw new Error("Invalid nsec — must start with nsec1");
    const privkey = decoded.data as Uint8Array;
    this.signer = createLocalSigner(privkey);
    const pubkey = await this.signer.getPublicKey();
    setKeysInLocalStorage(pubkey);
    if (persist) {
      await saveNsec(nsec.trim());
      setNsecFlag();
    }
    this.notify();
  }

  async loginWithNip07() {
    if (!window.nostr) throw new Error("NIP-07 extension not found");
    clearNip07PubKeyCache();
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
    clearNip07PubKeyCache();
    this.signer = null;
    removeKeysFromLocalStorage();
    removeBunkerUriFromLocalStorage();
    removeAppSecretFromLocalStorage();
    removeGuestSecretFromSession();
    removeNsecFlag();
    removeNsec();
    removeNip55Package();
    this.notify();
  }

  hasSigner(): boolean {
    return this.signer !== null;
  }

  async getSigner(): Promise<NostrSigner> {
    if (this.restorePromise) await this.restorePromise;

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
