import { generateSecretKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

const LOCAL_APP_SECRET_KEY = "formstr:client-secret";
const LOCAL_NSEC_FLAG = "formstr:nsec-stored";
const LOCAL_BUNKER_URI = "formstr:bunkerUri";
const LOCAL_STORAGE_KEYS = "formstr:keys";
const LOCAL_STORAGE_GUEST_KEY = "formstr:guest-secret";

type BunkerUri = { bunkerUri: string };

type Keys = { pubkey: string };

export const getAppSecretKeyFromLocalStorage = () => {
  let hexSecretKey = localStorage.getItem(LOCAL_APP_SECRET_KEY);
  if (!hexSecretKey) {
    const newSecret = generateSecretKey();
    hexSecretKey = bytesToHex(newSecret);
    localStorage.setItem(LOCAL_APP_SECRET_KEY, hexSecretKey);
    return newSecret;
  }
  return hexToBytes(hexSecretKey);
};

export const getBunkerUriInLocalStorage = () => {
  return JSON.parse(
    localStorage.getItem(LOCAL_BUNKER_URI) || "{}"
  ) as BunkerUri;
};

export const getKeysFromLocalStorage = () => {
  return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS) || "{}") as Keys;
};

export const setBunkerUriInLocalStorage = (bunkerUri: string) => {
  localStorage.setItem(LOCAL_BUNKER_URI, JSON.stringify({ bunkerUri }));
};

export const setKeysInLocalStorage = (pubkey: string) => {
  localStorage.setItem(LOCAL_STORAGE_KEYS, JSON.stringify({ pubkey }));
};

export const removeKeysFromLocalStorage = () => {
  localStorage.removeItem(LOCAL_STORAGE_KEYS);
};

export const removeBunkerUriFromLocalStorage = () => {
  localStorage.removeItem(LOCAL_BUNKER_URI);
};

export const removeAppSecretFromLocalStorage = () => {
  localStorage.removeItem(LOCAL_APP_SECRET_KEY);
};

export const setGuestSecretInSession = (secret: string) => {
  localStorage.setItem(LOCAL_STORAGE_GUEST_KEY, secret);
};

export const getGuestSecretFromSession = (): string | null => {
  return localStorage.getItem(LOCAL_STORAGE_GUEST_KEY);
};

export const removeGuestSecretFromSession = () => {
  localStorage.removeItem(LOCAL_STORAGE_GUEST_KEY);
};

const LOCAL_NIP55_PACKAGE = "formstr:nip55-package";

export const setNip55Package = (packageName: string) => {
  localStorage.setItem(LOCAL_NIP55_PACKAGE, packageName);
};

export const getNip55Package = (): string | null => {
  return localStorage.getItem(LOCAL_NIP55_PACKAGE);
};

export const removeNip55Package = () => {
  localStorage.removeItem(LOCAL_NIP55_PACKAGE);
};

export const setNsecFlag = () => {
  localStorage.setItem(LOCAL_NSEC_FLAG, "1");
};

export const getNsecFlag = (): boolean => {
  return localStorage.getItem(LOCAL_NSEC_FLAG) === "1";
};

export const removeNsecFlag = () => {
  localStorage.removeItem(LOCAL_NSEC_FLAG);
};
