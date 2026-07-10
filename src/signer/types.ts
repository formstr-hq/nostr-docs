import type { Event, EventTemplate } from "nostr-tools";

/**
 * The signing surface the app consumes. Intentionally narrow — every call
 * site only uses getPublicKey/signEvent/nip44Encrypt/nip44Decrypt. The
 * `encrypt`/`decrypt` (NIP-04) methods are kept optional for completeness
 * but are unused. `signerManager.getSigner()` resolves to one of these,
 * adapted from `@formstr/signer`'s `ActiveSigner`.
 */
export interface NostrSigner {
  getPublicKey: () => Promise<string>;
  signEvent: (event: EventTemplate) => Promise<Event>;
  encrypt?: (pubkey: string, plaintext: string) => Promise<string>;
  decrypt?: (pubkey: string, ciphertext: string) => Promise<string>;
  nip44Encrypt?: (pubkey: string, txt: string) => Promise<string>;
  nip44Decrypt?: (pubkey: string, ct: string) => Promise<string>;
}

/**
 * How an account's key material is held — all four are owned by
 * `@formstr/signer`. `ncryptsec` is a NIP-49 passphrase-encrypted key
 * (decrypted into memory only while unlocked).
 */
export type AuthMethod = "extension" | "nip46" | "android" | "ncryptsec";

/** A single identity in the account list. */
export interface AccountSummary {
  pubkey: string;
  npub?: string;
  method: AuthMethod;
}
