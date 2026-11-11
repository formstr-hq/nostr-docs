import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event,
  type EventTemplate,
} from "nostr-tools";
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
 * separate event to store. `editAttestation` is the same token signed by a
 * legacy share's editKey, proving the session holds edit access.
 */
export interface Session {
  docAddress: string;
  room: string;
  sessionSecretKey: Uint8Array;
  sessionPubkey: string;
  realPubkey: string | null;
  expiresAt: number; // unix seconds
  attestation: Event | null;
  editAttestation: Event | null;
}

interface StoredSession {
  sessionSecretKey: string; // hex
  sessionPubkey: string;
  realPubkey: string | null;
  expiresAt: number;
  attestation: Event | null;
  editAttestation?: Event | null;
}

function attestationTemplate(
  room: string,
  sessionPubkey: string,
  realPubkey: string,
  expiresAt: number,
): EventTemplate {
  // Plaintext: the whole payload is embedded inside a viewKey-encrypted op, so
  // the token body does not need its own encryption layer.
  return {
    kind: KIND_SESSION_ATTESTATION,
    tags: [["d", `${room}:${sessionPubkey}`]],
    content: JSON.stringify({ realPubkey, expiresAt }),
    created_at: Math.floor(Date.now() / 1000),
  };
}

const sessionCache = new Map<string, Session>();

function loadFromSessionStorage(docAddress: string, room: string): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_PREFIX + docAddress);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredSession;
    if (stored.expiresAt * 1000 <= Date.now()) return null;
    return {
      docAddress,
      room,
      sessionSecretKey: hexToBytes(stored.sessionSecretKey),
      sessionPubkey: stored.sessionPubkey,
      realPubkey: stored.realPubkey,
      expiresAt: stored.expiresAt,
      attestation: stored.attestation ?? null,
      editAttestation: stored.editAttestation ?? null,
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
      editAttestation: session.editAttestation,
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
 * Attach the real-key attestation to a session that doesn't have one yet, when a
 * signer is available without prompting. A session started while the account was
 * locked otherwise stays anonymous for its whole lifetime, and peers drop its
 * edits on documents that only accept roster editors.
 */
export function attestIfPossible(session: Session): Promise<void> {
  if (session.attestation || !signerManager.hasSigner()) return Promise.resolve();
  // One attempt per session: with an extension or remote signer each attempt
  // is a prompt, so a refusal must not be asked again on every outgoing op.
  let attempt = attestAttempts.get(session);
  if (!attempt) {
    attempt = (async () => {
      try {
        const signer = await signerManager.getSigner();
        const realPubkey = await signer.getPublicKey();
        const attestation = await signer.signEvent(
          attestationTemplate(session.room, session.sessionPubkey, realPubkey, session.expiresAt),
        );
        session.realPubkey = realPubkey;
        session.attestation = attestation;
        saveToSessionStorage(session);
      } catch {
        // Signer refused or unavailable — the session stays anonymous.
      }
    })();
    attestAttempts.set(session, attempt);
  }
  return attempt;
}

const attestAttempts = new WeakMap<Session, Promise<void>>();

/**
 * Returns this tab's collaboration session, minting one if needed. When signed
 * in, one real-signer prompt produces the embedded attestation; every subsequent
 * op is signed locally by the session key. With a legacy `editKey`, the session
 * is also attested by the editKey (signed locally, no prompt).
 */
export async function getOrCreateSession(
  docAddress: string,
  viewKey: string,
  editKey?: string,
): Promise<Session> {
  const room = collabRoom(viewKey);
  const cached = sessionCache.get(docAddress) ?? loadFromSessionStorage(docAddress, room);
  let session: Session;
  if (cached && cached.expiresAt * 1000 > Date.now() && cached.room === room) {
    session = cached;
  } else {
    const sessionSecretKey = generateSecretKey();
    session = {
      docAddress,
      room,
      sessionSecretKey,
      sessionPubkey: getPublicKey(sessionSecretKey),
      realPubkey: null,
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
      attestation: null,
      editAttestation: null,
    };
  }

  if (editKey && !session.editAttestation) {
    const editSecret = hexToBytes(editKey);
    session.editAttestation = finalizeEvent(
      attestationTemplate(room, session.sessionPubkey, getPublicKey(editSecret), session.expiresAt),
      editSecret,
    );
  }
  await attestIfPossible(session);

  sessionCache.set(docAddress, session);
  saveToSessionStorage(session);
  return session;
}

// Resolved session -> real pubkey, fed by embedded attestations seen on the wire.
const resolvedSessions = new Map<string, { realPubkey: string; expiresAt: number }>();

/**
 * Verify an embedded attestation token for `room` and return the pubkey it
 * attests, or null. The token must be a session attestation for exactly this
 * room and for `sessionPubkey` — the key that signed the event carrying it — so
 * a token copied from someone else's traffic (or another document) can't be
 * used to borrow their identity.
 */
export function verifyAttestation(
  token: unknown,
  room: string,
  sessionPubkey: string,
): string | null {
  try {
    const event = token as Event;
    if (!event || event.kind !== KIND_SESSION_ATTESTATION) return null;
    if (!verifyEvent(event)) return null;
    const d = event.tags.find((t) => t[0] === "d")?.[1];
    if (d !== `${room}:${sessionPubkey}`) return null;
    const parsed = JSON.parse(event.content) as {
      realPubkey?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof parsed.realPubkey !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    // The token's own signer must be the real pubkey it claims.
    if (parsed.realPubkey !== event.pubkey) return null;
    if (parsed.expiresAt * 1000 <= Date.now()) return null;
    return parsed.realPubkey;
  } catch {
    return null;
  }
}

/**
 * Record `sessionPubkey -> realPubkey` for display, from a token already checked
 * by `verifyAttestation` against the session that sent it. Idempotent.
 */
export function recordAttestation(
  sessionPubkey: string,
  realPubkey: string,
  token: Event,
): void {
  try {
    const { expiresAt } = JSON.parse(token.content) as { expiresAt: number };
    resolvedSessions.set(sessionPubkey, { realPubkey, expiresAt });
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
