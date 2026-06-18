import { createSigner, encryptSecretKey } from "@formstr/signer";
import type {
  Signer as PackageSigner,
  StoredAccount,
  ActiveSigner,
  AndroidSignerPlugin,
  AndroidSignerAppInfo,
} from "@formstr/signer";
import type { NostrSigner, AccountSummary, AuthMethod } from "./types";
import { isCapacitor } from "./secureStorage";
import { detectLegacyKey, wipeLegacy, type LegacySource } from "./legacy";
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

type PendingMigration = {
  pubkey: string;
  rawKey: Uint8Array;
  source: LegacySource;
};

class Signer {
  private activeSigner: NostrSigner | null = null;
  private activeAccount: AccountSummary | null = null;
  private pendingMigration: PendingMigration | null = null;
  private onChangeCallbacks: Set<() => void> = new Set();
  private loginModalCallback: (() => Promise<void>) | null = null;
  private unlockModalCallback: (() => Promise<void>) | null = null;
  private restorePromise: Promise<void> | null = null;

  registerLoginModal(callback: () => Promise<void>) {
    this.loginModalCallback = callback;
  }

  /** Prompt the user for the passphrase that unlocks a locked ncryptsec account. */
  registerUnlockModal(callback: () => Promise<void>) {
    this.unlockModalCallback = callback;
  }

  async restoreFromStorage() {
    this.restorePromise = this._restoreFromStorage();
    await this.restorePromise;
  }

  private async _restoreFromStorage() {
    try {
      // A pre-package guest/nsec key takes priority: surface the migration
      // prompt instead of silently signing the user out.
      const legacy = await detectLegacyKey();
      if (legacy) {
        this.pendingMigration = legacy;
        this.notify();
        return;
      }

      const pkg = await getPkg();
      const active = await pkg.unlock({ pool });
      const account = pkg.getActiveAccount();
      if (active && account) {
        this.setActive(toNostrSigner(active), toSummary(account));
      } else if (account) {
        // ncryptsec account hydrated but locked — present it, await passphrase.
        this.activeAccount = toSummary(account);
      }
    } catch (e) {
      console.error("Signer restore failed:", e);
    }
    this.notify();
  }

  // ── Legacy migration ──

  hasPendingMigration(): boolean {
    return this.pendingMigration !== null;
  }

  getPendingMigration(): { pubkey: string; source: LegacySource } | null {
    if (!this.pendingMigration) return null;
    const { pubkey, source } = this.pendingMigration;
    return { pubkey, source };
  }

  /** Encrypt the legacy key under `passphrase`, import it as a package account. */
  async migrate(passphrase: string) {
    if (!this.pendingMigration) throw new Error("No migration pending");
    if (!passphrase) throw new Error("Passphrase required");
    const pkg = await getPkg();
    const ncryptsec = encryptSecretKey(this.pendingMigration.rawKey, passphrase);
    const account = await pkg.loginWithNcryptsec(ncryptsec, passphrase);
    await wipeLegacy();
    this.pendingMigration = null;
    this.setFromPackage(pkg, account);
  }

  /** Abandon the legacy key (the user accepts losing access to those docs). */
  async discardMigration() {
    await wipeLegacy();
    this.pendingMigration = null;
    this.notify();
  }

  // ── Package logins ──

  private setFromPackage(pkg: PackageSigner, account: StoredAccount) {
    const active = pkg.getActiveSigner();
    if (!active) throw new Error("Login did not produce an active signer");
    this.setActive(toNostrSigner(active), toSummary(account));
  }

  async loginWithNip07() {
    const pkg = await getPkg();
    const account = await pkg.loginWithExtension();
    this.setFromPackage(pkg, account);
  }

  async loginWithNip46(bunkerUri: string) {
    const pkg = await getPkg();
    const account = await pkg.loginWithBunkerUri(bunkerUri, {
      pool,
      perms: NIP46_PERMS,
    });
    this.setFromPackage(pkg, account);
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
    this.setFromPackage(pkg, account);
  }

  async loginWithNip55(packageName: string) {
    const pkg = await getPkg();
    const account = await pkg.loginWithAndroidSigner({ packageName });
    this.setFromPackage(pkg, account);
  }

  async listNip55Apps(): Promise<AndroidSignerAppInfo[]> {
    const pkg = await getPkg();
    return pkg.listAndroidSignerApps();
  }

  // ── NIP-49 (passphrase-encrypted key) ──

  /**
   * Generate a fresh key, encrypt it under `passphrase`, activate it. Returns
   * the `ncryptsec` so the caller can show the user their recovery string —
   * it is the only way back into the account on another device.
   */
  async createAccount(passphrase: string): Promise<{ npub: string; ncryptsec: string }> {
    const pkg = await getPkg();
    const result = await pkg.createAccount(passphrase);
    const account = pkg.getActiveAccount();
    if (account) this.setFromPackage(pkg, account);
    return result;
  }

  async loginWithNcryptsec(ncryptsec: string, passphrase: string) {
    const pkg = await getPkg();
    const account = await pkg.loginWithNcryptsec(ncryptsec, passphrase);
    this.setFromPackage(pkg, account);
  }

  /** Unlock the active (locked) ncryptsec account with its passphrase. */
  async unlockActive(passphrase: string) {
    const pkg = await getPkg();
    const account = pkg.getActiveAccount();
    if (!account || account.method !== "ncryptsec" || !account.ncryptsec) {
      throw new Error("No locked account to unlock");
    }
    await pkg.loginWithNcryptsec(account.ncryptsec, passphrase);
    this.setFromPackage(pkg, account);
  }

  // ── Multi-account ──

  async listAccounts(): Promise<AccountSummary[]> {
    const pkg = await getPkg();
    return pkg.listAccounts().map(toSummary);
  }

  getActiveAccount(): AccountSummary | null {
    return this.activeAccount;
  }

  /** An active account exists but its signer isn't unlocked (ncryptsec). */
  isLocked(): boolean {
    return this.activeAccount !== null && this.activeSigner === null;
  }

  async switchAccount(pubkey: string) {
    const pkg = await getPkg();
    await pkg.switchAccount(pubkey);
    const account = pkg.getActiveAccount();
    if (!account) return;
    const active = await pkg.unlock({ pool });
    if (active) {
      this.setActive(toNostrSigner(active), toSummary(account));
    } else {
      // Locked ncryptsec — surface the account; the unlock prompt drives the rest.
      this.activeSigner = null;
      this.activeAccount = toSummary(account);
      this.notify();
    }
  }

  async logout(pubkey?: string) {
    const pkg = await getPkg();
    const target = pubkey ?? this.activeAccount?.pubkey;
    if (!target) return;
    await pkg.logout(target);

    if (this.activeAccount?.pubkey === target) {
      this.activeSigner = null;
      this.activeAccount = null;
      // Fall back to a remaining account if the package kept one active.
      const next = pkg.getActiveAccount();
      if (next) {
        const active = await pkg.unlock({ pool });
        if (active) this.setActive(toNostrSigner(active), toSummary(next));
        else this.activeAccount = toSummary(next);
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

    const pkg = await getPkg();
    const account = pkg.getActiveAccount();

    // A locked ncryptsec account just needs its passphrase, not a full re-login.
    if (account?.method === "ncryptsec" && this.unlockModalCallback) {
      await this.unlockModalCallback();
      if (this.activeSigner) return this.activeSigner;
    }

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
