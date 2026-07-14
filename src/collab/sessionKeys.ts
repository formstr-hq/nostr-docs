import { generateSecretKey, getPublicKey, nip44, verifyEvent } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { signerManager } from "../signer";
import { pool, DEFAULT_RELAYS } from "../nostr/relayPool";
import { publishEventStrict } from "../nostr/publish";
import { encryptContent } from "../utils/encryption";
import { KIND_SESSION_ATTESTATION } from "../nostr/kinds";

// How long a session key's attestation is valid for before a fresh signer
// prompt is required. Short enough that a stale/compromised session key
// can't be trusted indefinitely; long enough to cover a normal editing tab.
const SESSION_TTL_SEC = 12 * 60 * 60;

// How long a *failed* resolution is cached, so a flood of ops signed by a
// bad/unknown key doesn't repeatedly hit relays.
const NEGATIVE_CACHE_TTL_MS = 60_000;

const SESSION_STORAGE_PREFIX = "nostr-docs-collab-session:";

export interface Session {
  docAddress: string;
  sessionSecretKey: Uint8Array;
  sessionPubkey: string;
  // null for an anonymous collaborator (no logged-in signer) — they can
  // still fully participate (editKey possession is what authorizes edits,
  // see NostrYjsProvider), they just have no bound identity to display.
  realPubkey: string | null;
  expiresAt: number; // unix seconds
}

interface StoredSession {
  sessionSecretKey: string; // hex
  sessionPubkey: string;
  realPubkey: string | null;
  expiresAt: number;
}

// Module-level cache: naturally per-tab, since each browser tab gets its own
// JS module instance. sessionStorage mirrors it so a same-tab reload doesn't
// force a fresh signer prompt (sessionStorage is tab-scoped, unlike
// localStorage, so this can't leak a session key across tabs/devices).
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
    // sessionStorage unavailable (e.g. some private-browsing modes) — the
    // in-memory cache still covers the current page life, just not reloads.
  }
}

function conversationKeyFor(hexKey: string): Uint8Array {
  const bytes = hexToBytes(hexKey);
  return nip44.getConversationKey(bytes, getPublicKey(bytes));
}

/**
 * Returns the current tab's collaboration session for a document, creating
 * one if none exists (or the cached one has expired).
 *
 * If the user has an active signer, creating a session costs exactly one
 * real-signer prompt (to sign the attestation binding this session's pubkey
 * to the user's real pubkey, so other collaborators can display their name)
 * — every subsequent CRDT-op/presence event is then signed locally with the
 * returned session key.
 *
 * If there's no active signer — an edit-link visitor who never logged in —
 * this deliberately does NOT call signerManager.getSigner(), since that
 * would force a login prompt just to open a shared link, breaking the
 * existing "anyone with the link can edit" model (edit-link saves already
 * bypass the real signer entirely, signing with editKey via finalizeEvent).
 * Instead it mints a local, unattested session key: they can fully
 * participate (editKey possession is what NostrYjsProvider treats as
 * authorization), they just show up to others as an anonymous collaborator.
 */
export async function getOrCreateSession(
  docAddress: string,
  editKey: string,
  relays: string[] = DEFAULT_RELAYS,
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
    editKey,
  );

  const signed = await signer.signEvent({
    kind: KIND_SESSION_ATTESTATION,
    tags: [["d", `${docAddress}:${sessionPubkey}`]],
    content,
    created_at: Math.floor(Date.now() / 1000),
  });

  // No local fallback makes sense here: if the attestation can't reach any
  // relay, no other collaborator can ever resolve this session's identity,
  // so fail loudly rather than silently proceeding as if it had landed.
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
  expiresAt?: number; // only set for positive entries
}

const resolveCache = new Map<string, ResolveCacheEntry>();

/**
 * Resolves a session pubkey seen on an incoming CRDT-op/presence event back
 * to the real pubkey it was attested for. Returns null if there's no valid,
 * unexpired attestation — callers must treat that as "untrusted, reject."
 */
export async function resolveSession(
  docAddress: string,
  sessionPubkey: string,
  editKey: string,
  relays: string[] = DEFAULT_RELAYS,
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

  const events = await pool.querySync(relays, {
    kinds: [KIND_SESSION_ATTESTATION],
    "#d": [cacheKey],
  });
  const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];

  if (!latest) {
    resolveCache.set(cacheKey, { result: null, cachedAt: now });
    return null;
  }

  try {
    if (!verifyEvent(latest)) throw new Error("Invalid signature");
    const conversationKey = conversationKeyFor(editKey);
    const decrypted = nip44.decrypt(latest.content, conversationKey);
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
