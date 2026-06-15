import type { Event, EventTemplate } from "nostr-tools";

/**
 * The signing surface the app consumes. Intentionally narrow — every call
 * site only uses getPublicKey/signEvent/nip44Encrypt/nip44Decrypt. The
 * `encrypt`/`decrypt` (NIP-04) methods are kept optional for completeness
 * but are unused. `signerManager.getSigner()` resolves to one of these,
 * regardless of whether the underlying signer is package-managed
 * (extension/bunker/android) or an app-local key (guest/nsec).
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
 * How an account's key material is held. The first three are owned by
 * `@formstr/signer`; `guest` and `nsec` are app-local raw-key providers
 * the package deliberately doesn't support (no guest mode, no raw-nsec
 * import). See the README's security model.
 */
export type AuthMethod = "extension" | "nip46" | "android" | "guest" | "nsec";

/**
 * A single identity in the unified account list — package-managed accounts
 * plus the (at most one) app-local guest and nsec identities.
 */
export interface AccountSummary {
  pubkey: string;
  npub?: string;
  method: AuthMethod;
}
