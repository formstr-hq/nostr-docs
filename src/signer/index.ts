import { createSigner, LocalSigner } from "@formstr/signer";
import type {
  Signer as PackageSigner,
  StoredAccount,
  ActiveSigner,
  AndroidSignerPlugin,
  AndroidSignerAppInfo,
} from "@formstr/signer";
import { getPublicKey, nip19 } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import type { NostrSigner, AccountSummary, AuthMethod } from "./types";
import { isCapacitor, saveNsec, loadNsec, removeNsec } from "./secureStorage";
import {
  readActiveMarker,
  writeActiveMarker,
  clearActiveMarker,
  setGuestSecret,
  getGuestSecret,
  removeGuestSecret,
  setNsecFlag,
  getNsecFlag,
  removeNsecFlag,
  setNsecPubkey,
  getNsecPubkey,
  removeNsecPubkey,
} from "./utils";
import { pool } from "../nostr/relayPool";

// Identifies this app to remote signers in the nostrconnect (NIP-46 QR) flow.
// `appName` is required by the package for that flow — it throws without one.
const APP_NAME = "Formstr Pages";

// NIP-46 permissions requested on connect. Without a perms list, bunker UIs
// like Amber may show no approve/deny prompt at all on first pairing.
const NIP46_PERMS = [
  "sign_event",
  "nip44_encrypt",
  "nip44_decrypt",
  "nip04_encrypt",
  "nip04_decrypt",
];

/**
 * Adapt the package's `ActiveSigner` to the app's `NostrSigner`. Nearly an
 * identity map — the only behavioral addition is the Amber sentinel guard on
 * nip44Decrypt: NIP-55 signers return the literal "Could not decrypt message"
 * instead of throwing when they can't decrypt (e.g. viewKey-encrypted shared
 * content), and the package's AndroidSigner passes that through verbatim. We
 * translate it back into a thrown error so callers receive `null` rather than
 * storing the error string as document content.
 */
function toNostrSigner(active: ActiveSigner): NostrSigner {
  return {
    getPublicKey: () => active.getPublicKey(),
    signEvent: (event) => active.signEvent(event),
    encrypt: (pubkey, plaintext) => active.nip04Encrypt(pubkey, plaintext),
    decrypt: (pubkey, ciphertext) => active.nip04Decrypt(pubkey, ciphertext),
    nip44Encrypt: (pubkey, txt) => active.nip44Encrypt(pubkey, txt),
    nip44Decrypt: async (pubkey, ct) => {
      const result = await active.nip44Decrypt(pubkey, ct);
      if (result === "Could not decrypt message") {
        throw new Error("NIP-44 decryption failed");
      }
      return result;
    },
  };
}

function toSummary(account: StoredAccount): AccountSummary {
  return {
    pubkey: account.pubkey,
    npub: account.npub,
    method: account.method as AuthMethod,
  };
}

function localSummary(pubkey: string, method: "guest" | "nsec"): AccountSummary {
  return { pubkey, method, npub: nip19.npubEncode(pubkey) };
}

// Lazily construct the package signer. Construction is async only because the
// Capacitor Android plugin must be dynamically imported and injected at
// construction time (the package's android `unlock()` needs it configured up
// front — there's no per-call plugin override on unlock).
let pkgPromise: Promise<PackageSigner> | null = null;
function getPkg(): Promise<PackageSigner> {
  if (!pkgPromise) {
    pkgPromise = (async () => {
      let androidSignerPlugin: AndroidSignerPlugin | undefined;
      if (isCapacitor) {
        const { NostrSignerPlugin } = await import(
          "nostr-signer-capacitor-plugin"
        );
        androidSignerPlugin = NostrSignerPlugin as unknown as AndroidSignerPlugin;
      }
      return createSigner({
        appName: APP_NAME,
        androidSignerPlugin,
        storageKeyPrefix: "formstr:signer:",
      });
    })();
  }
  return pkgPromise;
}

class Signer {
  private activeSigner: NostrSigner | null = null;
  private activeAccount: AccountSummary | null = null;
  private onChangeCallbacks: Set<() => void> = new Set();
  private loginModalCallback: (() => Promise<void>) | null = null;
  private restorePromise: Promise<void> | null = null;

  registerLoginModal(callback: () => Promise<void>) {
    this.loginModalCallback = callback;
  }

  async restoreFromStorage() {
    this.restorePromise = this._restoreFromStorage();
    await this.restorePromise;
  }

  private async _restoreFromStorage() {
    try {
      const pkg = await getPkg();
      const marker = readActiveMarker();

      if (marker?.method === "guest") {
        await this.restoreGuest();
      } else if (marker?.method === "nsec") {
        await this.restoreNsec();
      } else if (marker?.method === "package") {
        if (
          marker.pubkey &&
          pkg.getActiveAccount()?.pubkey !== marker.pubkey &&
          pkg.listAccounts().some((a) => a.pubkey === marker.pubkey)
        ) {
          await pkg.switchAccount(marker.pubkey);
        }
        await this.unlockPackageActive();
      } else {
        // Legacy migration (no marker yet): app-local guest/nsec restore
        // silently; package-managed methods have no package account yet, so
        // unlock() is a no-op and the user re-logs in once (as designed).
        if (getNsecFlag()) await this.restoreNsec();
        else if (getGuestSecret()) await this.restoreGuest();
        else await this.unlockPackageActive();
      }
    } catch (e) {
      console.error("Signer restore failed:", e);
    }
    this.notify();
  }

  private async unlockPackageActive() {
    const pkg = await getPkg();
    const active = await pkg.unlock({ pool });
    if (active) {
      const account = pkg.getActiveAccount();
      this.setActive(toNostrSigner(active), account ? toSummary(account) : null);
    }
  }

  private async restoreGuest() {
    const secret = getGuestSecret();
    if (!secret) return;
    const privkey = hexToBytes(secret);
    const active = new LocalSigner(privkey);
    const pubkey = await active.getPublicKey();
    this.setActive(toNostrSigner(active), localSummary(pubkey, "guest"));
  }

  private async restoreNsec() {
    const nsec = await loadNsec();
    if (!nsec) return;
    const decoded = nip19.decode(nsec.trim());
    if (decoded.type !== "nsec") return;
    const active = new LocalSigner(decoded.data as Uint8Array);
    const pubkey = await active.getPublicKey();
    this.setActive(toNostrSigner(active), localSummary(pubkey, "nsec"));
  }

  // ── Package-managed logins ──

  private async adoptPackageActive(account: StoredAccount) {
    const pkg = await getPkg();
    const active = pkg.getActiveSigner();
    if (!active) throw new Error("Login did not produce an active signer");
    writeActiveMarker({ method: "package", pubkey: account.pubkey });
    this.setActive(toNostrSigner(active), toSummary(account));
  }

  async loginWithNip07() {
    const pkg = await getPkg();
    const account = await pkg.loginWithExtension();
    await this.adoptPackageActive(account);
  }

  async loginWithNip46(bunkerUri: string) {
    const pkg = await getPkg();
    const account = await pkg.loginWithBunkerUri(bunkerUri, {
      pool,
      perms: NIP46_PERMS,
    });
    await this.adoptPackageActive(account);
  }

  async loginWithNostrConnect(options: {
    relays: string[];
    onUri: (uri: string) => void;
    signal?: AbortSignal;
  }) {
    const pkg = await getPkg();
    const account = await pkg.loginWithNostrConnect({
      relays: options.relays,
      onUri: options.onUri,
      signal: options.signal,
      pool,
      perms: NIP46_PERMS,
    });
    await this.adoptPackageActive(account);
  }

  async loginWithNip55(packageName: string) {
    const pkg = await getPkg();
    const account = await pkg.loginWithAndroidSigner({ packageName });
    await this.adoptPackageActive(account);
  }

  async listNip55Apps(): Promise<AndroidSignerAppInfo[]> {
    const pkg = await getPkg();
    return pkg.listAndroidSignerApps();
  }

  // ── App-local logins (guest / nsec) ──

  async createGuestAccount(privkey: Uint8Array) {
    const active = new LocalSigner(privkey);
    const pubkey = await active.getPublicKey();
    setGuestSecret(bytesToHex(privkey));
    writeActiveMarker({ method: "guest", pubkey });
    this.setActive(toNostrSigner(active), localSummary(pubkey, "guest"));
  }

  async loginWithNsec(nsec: string, persist = true) {
    const decoded = nip19.decode(nsec.trim());
    if (decoded.type !== "nsec") {
      throw new Error("Invalid nsec — must start with nsec1");
    }
    const privkey = decoded.data as Uint8Array;
    const active = new LocalSigner(privkey);
    const pubkey = await active.getPublicKey();
    if (persist) {
      await saveNsec(nsec.trim());
      setNsecFlag();
      setNsecPubkey(pubkey);
    }
    writeActiveMarker({ method: "nsec", pubkey });
    this.setActive(toNostrSigner(active), localSummary(pubkey, "nsec"));
  }

  // ── Multi-account ──

  async listAccounts(): Promise<AccountSummary[]> {
    const pkg = await getPkg();
    const accounts = pkg.listAccounts().map(toSummary);
    const guestSecret = getGuestSecret();
    if (guestSecret) {
      const pubkey = getPublicKey(hexToBytes(guestSecret));
      accounts.push(localSummary(pubkey, "guest"));
    }
    if (getNsecFlag()) {
      const pubkey = getNsecPubkey();
      if (pubkey) accounts.push(localSummary(pubkey, "nsec"));
    }
    return accounts;
  }

  getActiveAccount(): AccountSummary | null {
    return this.activeAccount;
  }

  async switchAccount(pubkey: string) {
    const accounts = await this.listAccounts();
    const target = accounts.find((a) => a.pubkey === pubkey);
    if (!target) throw new Error("Account not found");

    if (target.method === "guest") {
      await this.restoreGuest();
      writeActiveMarker({ method: "guest", pubkey });
    } else if (target.method === "nsec") {
      await this.restoreNsec();
      writeActiveMarker({ method: "nsec", pubkey });
    } else {
      const pkg = await getPkg();
      await pkg.switchAccount(pubkey);
      writeActiveMarker({ method: "package", pubkey });
      const active = await pkg.unlock({ pool });
      if (active) {
        this.setActive(toNostrSigner(active), target);
      } else {
        // Locked (couldn't silently unlock). Surface the account; getSigner()
        // will drive the login modal when signing is next needed.
        this.activeSigner = null;
        this.activeAccount = target;
        this.notify();
      }
    }
  }

  async logout(pubkey?: string) {
    const target = pubkey ?? this.activeAccount?.pubkey;
    if (!target) return;

    const accounts = await this.listAccounts();
    const account = accounts.find((a) => a.pubkey === target);
    if (account?.method === "guest") {
      removeGuestSecret();
    } else if (account?.method === "nsec") {
      removeNsecFlag();
      removeNsecPubkey();
      await removeNsec();
    } else {
      const pkg = await getPkg();
      await pkg.logout(target);
    }

    if (this.activeAccount?.pubkey === target) {
      this.activeSigner = null;
      this.activeAccount = null;
      clearActiveMarker();
      // Fall back to a remaining account, if any, so multi-account logout of
      // the active identity doesn't drop the user to a logged-out state when
      // they still have other accounts.
      const remaining = await this.listAccounts();
      if (remaining.length > 0) {
        await this.switchAccount(remaining[0].pubkey);
      }
    }
    this.notify();
  }

  hasSigner(): boolean {
    return this.activeSigner !== null;
  }

  async getSigner(): Promise<NostrSigner> {
    if (this.restorePromise) await this.restorePromise;

    if (this.activeSigner) return this.activeSigner;

    if (this.loginModalCallback) {
      await this.loginModalCallback();
      if (this.activeSigner) return this.activeSigner;
    }

    throw new Error("No signer available and no login modal registered.");
  }

  onChange(cb: () => void) {
    this.onChangeCallbacks.add(cb);
    return () => this.onChangeCallbacks.delete(cb);
  }

  private setActive(signer: NostrSigner, account: AccountSummary | null) {
    this.activeSigner = signer;
    this.activeAccount = account;
    this.notify();
  }

  private notify() {
    this.onChangeCallbacks.forEach((cb) => cb());
  }
}

export const signerManager = new Signer();
export type { AccountSummary, AuthMethod, NostrSigner } from "./types";
