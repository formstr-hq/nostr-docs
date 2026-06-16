// One-time migration of pre-package, app-local identities into
// `@formstr/signer`. Earlier builds stored two kinds of raw key locally that
// the package deliberately doesn't support: a "guest" key in localStorage and
// an "nsec" key in device secure-storage. On full adoption those keys would be
// orphaned, locking the user out of their own encrypted docs. We detect such a
// key on startup, let the user encrypt it under a passphrase (NIP-49), import
// it as a normal package account (same pubkey), then wipe the legacy storage.

import { getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { loadNsec, removeNsec } from "./secureStorage";

export type LegacySource = "guest" | "nsec";

export type LegacyKey = {
  rawKey: Uint8Array;
  pubkey: string;
  source: LegacySource;
};

const GUEST_SECRET = "formstr:guest-secret";
const NSEC_FLAG = "formstr:nsec-stored";

// Every pre-package localStorage key, cleared once migration completes. Only
// `guest-secret` (and the secure-storage nsec) hold a recoverable key; the rest
// are metadata or leftovers for package-managed methods (extension/bunker/
// android), which re-authenticate on their own.
const LEGACY_KEYS = [
  GUEST_SECRET,
  NSEC_FLAG,
  "formstr:nsec-pubkey",
  "formstr:active",
  "formstr:keys",
  "formstr:bunkerUri",
  "formstr:client-secret",
  "formstr:nip55-package",
];

/**
 * Find a single app-local identity to migrate, preferring nsec over guest
 * (matching the original restore precedence). Returns null when there's
 * nothing to migrate.
 *
 * Edge case: a user who held *both* a guest key and an nsec gets only the
 * higher-precedence (nsec) one migrated; the guest identity's docs are not
 * recovered. This combination is not a flow the app ever produced.
 */
export async function detectLegacyKey(): Promise<LegacyKey | null> {
  if (localStorage.getItem(NSEC_FLAG) === "1") {
    const nsec = await loadNsec();
    if (nsec) {
      try {
        const decoded = nip19.decode(nsec.trim());
        if (decoded.type === "nsec") {
          const rawKey = decoded.data as Uint8Array;
          return { rawKey, pubkey: getPublicKey(rawKey), source: "nsec" };
        }
      } catch {
        /* fall through to guest */
      }
    }
  }

  const guest = localStorage.getItem(GUEST_SECRET);
  if (guest) {
    try {
      const rawKey = hexToBytes(guest);
      return { rawKey, pubkey: getPublicKey(rawKey), source: "guest" };
    } catch {
      /* nothing migratable */
    }
  }

  return null;
}

/** Remove all pre-package storage after a successful migration (or discard). */
export async function wipeLegacy(): Promise<void> {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  await removeNsec();
}
