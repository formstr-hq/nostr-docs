import { generateSecretKey, getPublicKey, verifyEvent, type Event } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { signerManager } from "../signer";
import { collabRoom } from "../nostr/sharedDoc";
import { KIND_SESSION_ATTESTATION } from "../nostr/kinds";

// How long a session key's attestation is valid before a fresh signer prompt.
const SESSION_TTL_SEC = 12 * 60 * 60;

const SESSION_STORAGE_PREFIX = "nostr-docs-collab-session:";

/**
 * A per-tab collaboration session. `attestation` is a real-key-signed event that
 * binds `sessionPubkey` to `realPubkey`; it is *embedded* in each op/presence
 * payload (not published), so relays never see the real key and there is no
 * separate event to store.
 */
export interface Session {
  docAddress: string;
  sessionSecretKey: Uint8Array;
  sessionPubkey: string;
  realPubkey: string | null;
  expiresAt: number; // unix seconds
  attestation: Event | null;
}

interface StoredSession {
  sessionSecretKey: string; // hex
  sessionPubkey: string;
  realPubkey: string | null;
  expiresAt: number;
  attestation: Event | null;
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
      attestation: stored.attestation ?? null,
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
      attestation: session.attestation,
    };
    sessionStorage.setItem(
      SESSION_STORAGE_PREFIX + session.docAddress,
      JSON.stringify(stored),
    );
  } catch {
    // sessionStorage unavailable — the in-memory cache still covers this page.
  }
}

/** Kind used only as the embedded attestation token's kind (never published). */

/**
 * Returns this tab's collaboration session, minting one if needed. When signed
 * in, one real-signer prompt produces the embedded attestation; every subsequent
 * op is signed locally by the session key.
 */
export async function getOrCreateSession(
  docAddress: string,
  viewKey: string,
): Promise<Session> {
  const cached = sessionCache.get(docAddress) ?? loadFromSessionStorage(docAddress);
  if (cached && cached.expiresAt * 1000 > Date.now()) {
    sessionCache.set(docAddress, cached);
    return cached;
  }

  const sessionSecretKey = generateSecretKey();
  const sessionPubkey = getPublicKey(sessionSecretKey);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;

  let realPubkey: string | null = null;
  let attestation: Event | null = null;

  if (signerManager.hasSigner()) {
    const signer = await signerManager.getSigner();
    realPubkey = await signer.getPublicKey();
    // Plaintext: the whole payload is embedded inside a viewKey-encrypted op, so
    // the token body does not need its own encryption layer.
    attestation = await signer.signEvent({
      kind: KIND_SESSION_ATTESTATION,
      tags: [["d", `${collabRoom(viewKey)}:${sessionPubkey}`]],
      content: JSON.stringify({ realPubkey, expiresAt }),
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  const session: Session = {
    docAddress,
    sessionSecretKey,
    sessionPubkey,
    realPubkey,
    expiresAt,
    attestation,
  };
  sessionCache.set(docAddress, session);
  saveToSessionStorage(session);
  return session;
}

// Resolved session -> real pubkey, fed by embedded attestations seen on the wire.
const resolvedSessions = new Map<string, { realPubkey: string; expiresAt: number }>();

/**
 * Verify an embedded attestation token and record `sessionPubkey -> realPubkey`.
 * Called for every op/presence that carries one; idempotent.
 */
export function recordAttestation(token: Event): void {
  try {
    if (!verifyEvent(token)) return;
    const parsed = JSON.parse(token.content) as {
      realPubkey?: unknown;
      expiresAt?: unknown;
    };    if (
      typeof parsed.realPubkey !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return;
    }
    // The token's own signer must be the real pubkey it claims.
    if (parsed.realPubkey !== token.pubkey) return;
    if (parsed.expiresAt * 1000 <= Date.now()) return;
    // The token's `d` tag binds the session pubkey it attests to.
    const d = token.tags.find((t) => t[0] === "d")?.[1];
    const sessionPubkey = d?.split(":").pop();
    if (!sessionPubkey) return;
    resolvedSessions.set(sessionPubkey, {
      realPubkey: parsed.realPubkey,
      expiresAt: parsed.expiresAt,
    });
  } catch {
    // malformed token — ignore
  }
}

/** Resolve a session pubkey to its attested real pubkey, if seen and unexpired. */
export function resolveAttested(
  sessionPubkey: string,
): { realPubkey: string } | null {
  const entry = resolvedSessions.get(sessionPubkey);
  if (!entry || entry.expiresAt * 1000 <= Date.now()) return null;
  return { realPubkey: entry.realPubkey };
}
