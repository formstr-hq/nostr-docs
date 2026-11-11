import type * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import {
  writeSyncStep1,
  writeUpdate,
  readSyncMessage,
  messageYjsSyncStep1,
} from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { finalizeEvent, nip44, verifyEvent, type Event } from "nostr-tools";
import { publishEvent } from "../nostr/publish";
import { subscribe, type Subscription } from "../dataLayer";
import { KIND_CRDT_OP, KIND_PRESENCE } from "../nostr/kinds";
import { viewKeyConversationKey, collabRoom } from "../nostr/sharedDoc";
import type { Session } from "./sessionKeys";
import { attestIfPossible, recordAttestation, verifyAttestation } from "./sessionKeys";
import { uint8ToBase64, base64ToUint8 } from "../utils/base64";

// Tags updates applied from a relay so they aren't re-broadcast.
const REMOTE_ORIGIN = Symbol("nostr-yjs-remote");

// Re-sent periodically so a long-running tab resists missed ephemeral events and
// the autosave gate's `lastSyncRequestAt` never goes stale.
const SYNC_STEP_INTERVAL_MS = 60_000;
// Re-broadcasts local presence even with no changes (awareness's own
// outdatedTimeout is 30s).
const PRESENCE_HEARTBEAT_MS = 15_000;
const PRESENCE_THROTTLE_MS = 200;
// Minimum gap between on-demand policy reloads triggered by an unknown writer.
const POLICY_RECHECK_MS = 5_000;

/**
 * Who may change the live document. `open` docs accept any viewKey holder (that
 * is the capability); otherwise a sender must carry an attestation, for this
 * room and its own session key, from one of `authors` (owner + roster editors,
 * or a legacy share's editKey).
 */
export interface WritePolicy {
  open: boolean;
  authors: Set<string>;
}

export interface NostrYjsProviderOptions {
  /** Root address `33457:<owner>:<d>` — the Yjs room identity. */
  docAddress: string;
  ydoc: Y.Doc;
  viewKey: string;
  relays: string[];
  session: Session;
  /** Loads the current write policy; re-run periodically so roster changes apply. */
  loadWritePolicy: () => Promise<WritePolicy>;
}

/**
 * Nostr-backed transport for a Yjs document: relays are pub/sub for
 * viewKey-encrypted Yjs sync-protocol messages and awareness updates.
 * Conflict resolution is entirely Yjs's; this class never inspects content.
 */
export class NostrYjsProvider {
  readonly awareness: Awareness;
  readonly sessionPubkey: string;
  lastSyncRequestAt: number | null = null;

  private readonly room: string;
  private readonly ydoc: Y.Doc;
  private readonly relays: string[];
  private readonly session: Session;
  private readonly conversationKey: Uint8Array;
  private readonly loadWritePolicy: () => Promise<WritePolicy>;
  // Until the first policy loads, nobody else may write.
  private writePolicy: Promise<WritePolicy> = Promise.resolve({
    open: false,
    authors: new Set(),
  });
  // Awareness client id -> the session key that first claimed it, so one peer
  // can't overwrite or remove another peer's presence.
  private readonly clientOwners = new Map<number, string>();
  private lastPolicyRecheck = 0;

  private sub: Subscription | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private presenceThrottle: ReturnType<typeof setTimeout> | null = null;
  private pendingPresenceClients = new Set<number>();
  private destroyed = false;

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    const encoder = encoding.createEncoder();
    writeUpdate(encoder, update);
    this.publishOp(encoding.toUint8Array(encoder));
  };

  // Re-sync promptly after a network blip instead of waiting for the next
  // periodic step, so a client that was offline converges as soon as it returns.
  private readonly onOnline = () => {
    this.sendSyncStep1();
  };

  // A client whose state was removed (left, or timed out) no longer owns its
  // id, so ownership doesn't outlive the peer.
  private readonly onAwarenessChange = ({ removed }: { removed: number[] }) => {
    for (const clientID of removed) {
      if (clientID !== this.ydoc.clientID) this.clientOwners.delete(clientID);
    }
  };

  private readonly onAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === REMOTE_ORIGIN) return;
    [...change.added, ...change.updated, ...change.removed].forEach((c) =>
      this.pendingPresenceClients.add(c),
    );
    if (this.presenceThrottle) return;
    this.presenceThrottle = setTimeout(() => {
      this.presenceThrottle = null;
      const clients = [...this.pendingPresenceClients];
      this.pendingPresenceClients.clear();
      if (clients.length === 0) return;
      this.publishPresence(encodeAwarenessUpdate(this.awareness, clients));
    }, PRESENCE_THROTTLE_MS);
  };

  constructor(options: NostrYjsProviderOptions) {
    this.room = collabRoom(options.viewKey);
    this.ydoc = options.ydoc;
    this.relays = options.relays;
    this.session = options.session;
    this.conversationKey = viewKeyConversationKey(options.viewKey);
    this.loadWritePolicy = options.loadWritePolicy;
    this.sessionPubkey = options.session.sessionPubkey;
    this.awareness = new Awareness(this.ydoc);
    // Only the session pubkey — names/colors are resolved via attestation +
    // profile, never taken from self-asserted awareness state.
    this.awareness.setLocalStateField("user", {
      sessionPubkey: this.session.sessionPubkey,
    });
    // Our own client id is ours: a remote state for it would replace ours.
    this.clientOwners.set(this.ydoc.clientID, this.session.sessionPubkey);
  }

  connect(): void {
    this.ydoc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    this.awareness.on("change", this.onAwarenessChange);

    // Start loading who may write before any remote event can arrive.
    this.refreshWritePolicy();
    this.sub = subscribe(
      [{ kinds: [KIND_CRDT_OP, KIND_PRESENCE], "#a": [this.room] }],
      { onEvent: (event) => void this.handleIncoming(event) },
      this.relays,
    );

    this.sendSyncStep1();
    this.syncInterval = setInterval(() => {
      this.refreshWritePolicy();
      this.sendSyncStep1();
    }, SYNC_STEP_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }
    this.heartbeatInterval = setInterval(() => {
      this.publishPresence(
        encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]),
      );
    }, PRESENCE_HEARTBEAT_MS);
  }

  private refreshWritePolicy(): Promise<WritePolicy> {
    const next = this.loadWritePolicy();
    // Keep the previous policy if a refresh fails (e.g. relays unreachable).
    const previous = this.writePolicy;
    this.writePolicy = next.catch(() => previous);
    return this.writePolicy;
  }

  /**
   * An attested sender we don't recognise may be an editor added after our
   * policy loaded. Reload it (rate-limited) and, if they're now allowed,
   * re-request state so the updates we dropped meanwhile are sent again.
   */
  private recheckPolicyFor(pubkeys: string[]): void {
    const now = Date.now();
    if (now - this.lastPolicyRecheck < POLICY_RECHECK_MS) return;
    this.lastPolicyRecheck = now;
    void this.refreshWritePolicy().then((policy) => {
      if (this.destroyed) return;
      if (policy.open || pubkeys.some((pk) => policy.authors.has(pk))) {
        this.sendSyncStep1();
      }
    });
  }

  /**
   * Apply a presence update only if every client state in it belongs to the
   * sender: the state must name the sender's own session key, and the client id
   * must not already be owned by a different session.
   */
  private applyPresence(bytes: Uint8Array, sender: string): void {
    const decoder = decoding.createDecoder(bytes);
    const count = decoding.readVarUint(decoder);
    const clients: number[] = [];
    for (let i = 0; i < count; i++) {
      const clientID = decoding.readVarUint(decoder);
      decoding.readVarUint(decoder); // clock
      const state = JSON.parse(decoding.readVarString(decoder)) as {
        user?: { sessionPubkey?: unknown };
      } | null;
      const owner = this.clientOwners.get(clientID);
      if (owner !== undefined && owner !== sender) return;
      if (state !== null && state.user?.sessionPubkey !== sender) return;
      clients.push(clientID);
    }
    for (const clientID of clients) this.clientOwners.set(clientID, sender);
    applyAwarenessUpdate(this.awareness, bytes, REMOTE_ORIGIN);
  }

  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    writeSyncStep1(encoder, this.ydoc);
    this.publishOp(encoding.toUint8Array(encoder));
    this.lastSyncRequestAt = Date.now();
  }

  private async handleIncoming(event: Event): Promise<void> {
    if (this.destroyed) return;
    if (event.pubkey === this.session.sessionPubkey) return; // self-echo guard
    // event.pubkey decides identity and access below, so check the signature
    // here rather than relying on every transport to have done it.
    if (!verifyEvent(event)) return;

    // Decrypting proves only that the sender holds the viewKey, which every
    // share recipient has — view-only ones included. Reading is therefore open
    // to any of them, but changing the document or showing up as a collaborator
    // requires write access under the current policy. (The relay has already
    // verified event.sig, so event.pubkey is the sender's session key.)
    // Plaintext is a JSON envelope carrying the embedded attestations (if any)
    // and the base64 Yjs payload. Attestations travel inside the ciphertext, so
    // relays never see the real identity.
    let bytes: Uint8Array;
    let realPubkey: string | null = null;
    let editPubkey: string | null = null;
    try {
      const decrypted = nip44.decrypt(event.content, this.conversationKey);
      let messageB64 = decrypted;
      try {
        const parsed = JSON.parse(decrypted) as { a?: Event; e?: Event; m?: unknown };
        if (parsed && typeof parsed.m === "string") {
          // Only trust an attestation for this room that vouches for the
          // session key that actually signed this event.
          if (parsed.a) {
            realPubkey = verifyAttestation(parsed.a, this.room, event.pubkey);
            if (realPubkey) recordAttestation(event.pubkey, realPubkey, parsed.a);
          }
          if (parsed.e) editPubkey = verifyAttestation(parsed.e, this.room, event.pubkey);
          messageB64 = parsed.m;
        }
      } catch {
        // not JSON — legacy raw-base64 payload
      }
      bytes = base64ToUint8(messageB64);
    } catch {
      return;
    }

    const policy = await this.writePolicy;
    if (this.destroyed) return;
    const canWrite =
      policy.open ||
      (!!realPubkey && policy.authors.has(realPubkey)) ||
      (!!editPubkey && policy.authors.has(editPubkey));
    if (!canWrite && (realPubkey || editPubkey)) {
      this.recheckPolicyFor([realPubkey, editPubkey].filter((pk): pk is string => !!pk));
    }

    if (event.kind === KIND_PRESENCE) {
      if (!canWrite) return;
      try {
        this.applyPresence(bytes, event.pubkey);
      } catch {
        /* malformed presence */
      }
      return;
    }

    try {
      // A sync-step-1 is a read request (answered with our state, which the
      // sender can decrypt anyway). Anything else changes the document.
      const messageType = decoding.readVarUint(decoding.createDecoder(bytes));
      if (messageType !== messageYjsSyncStep1 && !canWrite) return;
      const decoder = decoding.createDecoder(bytes);
      const replyEncoder = encoding.createEncoder();
      readSyncMessage(decoder, replyEncoder, this.ydoc, REMOTE_ORIGIN, (err) =>
        console.warn("Yjs sync message error:", err),
      );
      if (encoding.hasContent(replyEncoder)) {
        this.publishOp(encoding.toUint8Array(replyEncoder));
      }
    } catch (err) {
      console.warn("Malformed CRDT-op payload, dropped:", err);
    }
  }

  private publishOp(bytes: Uint8Array): void {
    this.publish(KIND_CRDT_OP, bytes);
  }

  private publishPresence(bytes: Uint8Array): void {
    this.publish(KIND_PRESENCE, bytes);
  }

  private publish(kind: number, bytes: Uint8Array): void {
    // A session started while the account was locked has no attestation yet;
    // add it once the signer is available so peers accept our edits.
    if (!this.session.attestation) void attestIfPossible(this.session);
    const payload = JSON.stringify({
      a: this.session.attestation,
      ...(this.session.editAttestation ? { e: this.session.editAttestation } : {}),
      m: uint8ToBase64(bytes),
    });
    const content = nip44.encrypt(payload, this.conversationKey);
    const event = finalizeEvent(
      {
        kind,
        tags: [["a", this.room]],
        content,
        created_at: Math.floor(Date.now() / 1000),
      },
      this.session.sessionSecretKey,
    );
    // Ephemeral loss is tolerable — the periodic sync-step round-trip reconciles.
    publishEvent(event, this.relays).catch(() => {
      /* best-effort */
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.presenceThrottle) {
      clearTimeout(this.presenceThrottle);
      this.presenceThrottle = null;
    }
    this.ydoc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.off("change", this.onAwarenessChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
    }

    const clientId = this.ydoc.clientID;
    removeAwarenessStates(this.awareness, [clientId], "tab closed");
    this.publishPresence(encodeAwarenessUpdate(this.awareness, [clientId]));

    this.awareness.destroy();
    this.sub?.close();
    this.sub = null;
  }
}
