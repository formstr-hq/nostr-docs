import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { signerManager } from "../signer";
import { publishEventStrict } from "../nostr/publish";
import { fetchOne } from "../dataLayer";
import { encryptContent } from "../utils/encryption";
import { decryptWithViewKey } from "../nostr/sharedDoc";
import { KIND_SESSION_ATTESTATION } from "../nostr/kinds";

// How long a session key's attestation is valid before another signer prompt is
// required.
const SESSION_TTL_SEC = 12 * 60 * 60;
// How long a *failed* resolution is cached, so a flood of ops signed by an
// unknown key doesn't repeatedly hit relays.
const NEGATIVE_CACHE_TTL_MS = 60_000;

const SESSION_STORAGE_PREFIX = "nostr-docs-collab-session:";

export interface Session {
  docAddress: string;
  sessionSecretKey: Uint8Array;
  sessionPubkey: string;
  realPubkey: string | null;
  expiresAt: number; // unix seconds
}

interface StoredSession {
  sessionSecretKey: string; // hex
  sessionPubkey: string;
  realPubkey: string | null;
  expiresAt: number;
}

const sessionCache = new Map<string, Session>();

function loadFromSessionStorage(docAddress: string): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_PREFIX + docAddress);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredSession;
    if (stored.expiresAt * 1000 <= Date.now()) return null;
    return {
      docAddress,
      sessionSecretKey: hexToBytes(stored.sessionSecretKey),
      sessionPubkey: stored.sessionPubkey,
      realPubkey: stored.realPubkey,
      expiresAt: stored.expiresAt,
    };
  } catch {
    return null;
  }
}

function saveToSessionStorage(session: Session): void {
  try {
    const stored: StoredSession = {
      sessionSecretKey: bytesToHex(session.sessionSecretKey),
      sessionPubkey: session.sessionPubkey,
      realPubkey: session.realPubkey,
      expiresAt: session.expiresAt,
    };
    sessionStorage.setItem(
      SESSION_STORAGE_PREFIX + session.docAddress,
      JSON.stringify(stored),
    );
  } catch {
    // sessionStorage unavailable — the in-memory cache still covers this page.
  }
}

/**
 * Returns this tab's collaboration session for a document, creating one if
 * needed. Attested (one real-signer prompt) when signed in so other
 * collaborators can resolve a display name; otherwise a local unattested
 * session (writers are always signed in under v2, so this is the rare case).
 */
export async function getOrCreateSession(
  docAddress: string,
  viewKey: string,
  relays: string[],
): Promise<Session> {
  const cached = sessionCache.get(docAddress) ?? loadFromSessionStorage(docAddress);
  if (cached && cached.expiresAt * 1000 > Date.now()) {
    sessionCache.set(docAddress, cached);
    return cached;
  }

  const sessionSecretKey = generateSecretKey();
  const sessionPubkey = getPublicKey(sessionSecretKey);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;

  if (!signerManager.hasSigner()) {
    const session: Session = {
      docAddress,
      sessionSecretKey,
      sessionPubkey,
      realPubkey: null,
      expiresAt,
    };
    sessionCache.set(docAddress, session);
    saveToSessionStorage(session);
    return session;
  }

  const signer = await signerManager.getSigner();
  const realPubkey = await signer.getPublicKey();

  const content = await encryptContent(
    JSON.stringify({ realPubkey, expiresAt }),
    viewKey,
  );

  const signed = await signer.signEvent({
    kind: KIND_SESSION_ATTESTATION,
    tags: [["d", `${docAddress}:${sessionPubkey}`]],
    content,
    created_at: Math.floor(Date.now() / 1000),
  });

  await publishEventStrict(signed, relays);

  const session: Session = {
    docAddress,
    sessionSecretKey,
    sessionPubkey,
    realPubkey,
    expiresAt,
  };
  sessionCache.set(docAddress, session);
  saveToSessionStorage(session);
  return session;
}

interface ResolveCacheEntry {
  result: { realPubkey: string } | null;
  cachedAt: number;
  expiresAt?: number;
}

const resolveCache = new Map<string, ResolveCacheEntry>();

/**
 * Resolves a session pubkey seen on an incoming op/presence event back to the
 * real pubkey it was attested for. Returns null when there is no valid,
 * unexpired attestation.
 */
export async function resolveSession(
  docAddress: string,
  sessionPubkey: string,
  viewKey: string,
  relays: string[],
): Promise<{ realPubkey: string } | null> {
  const cacheKey = `${docAddress}:${sessionPubkey}`;
  const now = Date.now();
  const cached = resolveCache.get(cacheKey);
  if (cached) {
    if (cached.result && cached.expiresAt && cached.expiresAt * 1000 > now) {
      return cached.result;
    }
    if (!cached.result && now - cached.cachedAt < NEGATIVE_CACHE_TTL_MS) {
      return null;
    }
  }

  const latest = await fetchOne(
    [{ kinds: [KIND_SESSION_ATTESTATION], "#d": [cacheKey] }],
    relays,
  ).catch(() => null);

  if (!latest) {
    resolveCache.set(cacheKey, { result: null, cachedAt: now });
    return null;
  }

  try {
    if (!verifyEvent(latest)) throw new Error("Invalid signature");
    const decrypted = decryptWithViewKey(latest.content, viewKey);
    const parsed = JSON.parse(decrypted) as {
      realPubkey: string;
      expiresAt: number;
    };
    if (parsed.realPubkey !== latest.pubkey) {
      throw new Error("Attestation content/signer mismatch");
    }
    if (parsed.expiresAt * 1000 <= now) {
      throw new Error("Attestation expired");
    }
    const result = { realPubkey: parsed.realPubkey };
    resolveCache.set(cacheKey, {
      result,
      cachedAt: now,
      expiresAt: parsed.expiresAt,
    });
    return result;
  } catch {
    resolveCache.set(cacheKey, { result: null, cachedAt: now });
    return null;
  }
}
