// App-local storage helpers for the hybrid signer.
//
// `@formstr/signer` owns persistence for its own accounts
// (extension / bunker / android) under its own storage adapter. The helpers
// here cover only the bits the package does NOT manage:
//   - the app-local guest and nsec identities, and
//   - the `active` marker that records which provider owns the current
//     session, so cold-start restore knows whether to unlock a package
//     account or rehydrate an app-local key.

const LOCAL_NSEC_FLAG = "formstr:nsec-stored";
const LOCAL_NSEC_PUBKEY = "formstr:nsec-pubkey";
// Kept under the original key name so existing guest users aren't stranded.
const LOCAL_GUEST_SECRET = "formstr:guest-secret";
const LOCAL_ACTIVE = "formstr:active";

/** Which provider owns the active session. Authoritative for restore routing. */
export type ActiveMarker = {
  method: "package" | "guest" | "nsec";
  pubkey: string;
};

export const readActiveMarker = (): ActiveMarker | null => {
  const raw = localStorage.getItem(LOCAL_ACTIVE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveMarker;
  } catch {
    return null;
  }
};

export const writeActiveMarker = (marker: ActiveMarker) => {
  localStorage.setItem(LOCAL_ACTIVE, JSON.stringify(marker));
};

export const clearActiveMarker = () => {
  localStorage.removeItem(LOCAL_ACTIVE);
};

// ── Guest (app-local raw key, persisted in localStorage) ──

export const setGuestSecret = (secretHex: string) => {
  localStorage.setItem(LOCAL_GUEST_SECRET, secretHex);
};

export const getGuestSecret = (): string | null => {
  return localStorage.getItem(LOCAL_GUEST_SECRET);
};

export const removeGuestSecret = () => {
  localStorage.removeItem(LOCAL_GUEST_SECRET);
};

// ── nsec (app-local raw key, secret in device secure-storage; flag + pubkey here) ──

export const setNsecFlag = () => {
  localStorage.setItem(LOCAL_NSEC_FLAG, "1");
};

export const getNsecFlag = (): boolean => {
  return localStorage.getItem(LOCAL_NSEC_FLAG) === "1";
};

export const removeNsecFlag = () => {
  localStorage.removeItem(LOCAL_NSEC_FLAG);
};

export const setNsecPubkey = (pubkey: string) => {
  localStorage.setItem(LOCAL_NSEC_PUBKEY, pubkey);
};

export const getNsecPubkey = (): string | null => {
  return localStorage.getItem(LOCAL_NSEC_PUBKEY);
};

export const removeNsecPubkey = () => {
  localStorage.removeItem(LOCAL_NSEC_PUBKEY);
};
