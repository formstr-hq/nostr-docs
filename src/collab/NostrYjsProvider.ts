import type * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { writeSyncStep1, writeUpdate, readSyncMessage } from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { finalizeEvent, getPublicKey, nip44, type Event } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { pool } from "../nostr/relayPool";
import { publishEvent } from "../nostr/publish";
import { KIND_CRDT_OP, KIND_PRESENCE } from "../nostr/kinds";
import type { Session } from "./sessionKeys";
import { uint8ToBase64, base64ToUint8 } from "../utils/base64";

// Tags updates applied from a relay so they aren't re-broadcast — without
// this every op would echo around the relay set forever.
const REMOTE_ORIGIN = Symbol("nostr-yjs-remote");

// Re-sent periodically so a long-running tab stays resistant to any missed
// ephemeral events, and so DocEditorController's autosave gate (which checks
// `lastSyncRequestAt`) never goes stale during a long session.
const SYNC_STEP_INTERVAL_MS = 60_000;
// Re-broadcasts local presence even with no changes, since awareness's own
// `outdatedTimeout` (30s) would otherwise mark a still-present peer offline
// if a heartbeat is ever dropped as an ephemeral event.
const PRESENCE_HEARTBEAT_MS = 15_000;
const PRESENCE_THROTTLE_MS = 200;

export interface NostrYjsProviderOptions {
  docAddress: string;
  ydoc: Y.Doc;
  editKey: string;
  relays: string[];
  session: Session;
}

function conversationKeyFor(hexKey: string): Uint8Array {
  const bytes = hexToBytes(hexKey);
  return nip44.getConversationKey(bytes, getPublicKey(bytes));
}

/**
 * Nostr-backed transport for a Yjs document: relays are pure pub/sub for
 * encrypted Yjs sync-protocol messages and awareness updates. Conflict
 * resolution is entirely Yjs's; this class never inspects/merges content
 * itself, only ferries bytes once their signer has been verified against a
 * session-key attestation (see sessionKeys.ts).
 */
export class NostrYjsProvider {
  readonly awareness: Awareness;
  readonly sessionPubkey: string;
  lastSyncRequestAt: number | null = null;

  private readonly docAddress: string;
  private readonly ydoc: Y.Doc;
  private readonly relays: string[];
  private readonly session: Session;
  private readonly conversationKey: Uint8Array;

  private sub: SubCloser | null = null;
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
    this.docAddress = options.docAddress;
    this.ydoc = options.ydoc;
    this.relays = options.relays;
    this.session = options.session;
    this.conversationKey = conversationKeyFor(options.editKey);
    this.sessionPubkey = options.session.sessionPubkey;
    this.awareness = new Awareness(this.ydoc);
    // Deliberately just the session pubkey, not a self-asserted name/color —
    // those are resolved by consumers via resolveSession + the profile
    // cache, so a compromised session key can't spoof another
    // collaborator's identity in the UI.
    this.awareness.setLocalStateField("user", {
      sessionPubkey: this.session.sessionPubkey,
    });
  }

  connect(): void {
    this.ydoc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);

    this.sub = pool.subscribeMany(
      this.relays,
      { kinds: [KIND_CRDT_OP, KIND_PRESENCE], "#a": [this.docAddress] },
      { onevent: (event) => void this.handleIncoming(event) },
    );

    this.sendSyncStep1();
    this.syncInterval = setInterval(
      () => this.sendSyncStep1(),
      SYNC_STEP_INTERVAL_MS,
    );
    this.heartbeatInterval = setInterval(() => {
      this.publishPresence(
        encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID]),
      );
    }, PRESENCE_HEARTBEAT_MS);
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

    // Authorization here matches the app's existing trust model for shared
    // docs: possession of editKey is what grants edit access (see
    // saveSnapshotWithAddress's editKey-signed save path), not a bound real
    // identity. Since the conversation key below is derived from editKey
    // itself, only someone who already knows editKey can produce ciphertext
    // that decrypts correctly — so a successful decrypt *is* the
    // authorization check. (SimplePool has already verified event.sig
    // against event.pubkey before invoking this handler.) A session-key
    // attestation, when present, only adds a *name* to this pubkey for
    // presence display (see useTrustedCollaborators) — its absence doesn't
    // make the content untrusted, it just means an anonymous collaborator.
    let bytes: Uint8Array;
    try {
      const decrypted = nip44.decrypt(event.content, this.conversationKey);
      bytes = base64ToUint8(decrypted);
    } catch {
      return; // malformed/undecryptable payload — drop, never crash the doc
    }

    if (event.kind === KIND_PRESENCE) {
      try {
        applyAwarenessUpdate(this.awareness, bytes, REMOTE_ORIGIN);
      } catch {
        /* malformed presence payload — ignore */
      }
      return;
    }

    try {
      const decoder = decoding.createDecoder(bytes);
      const replyEncoder = encoding.createEncoder();
      readSyncMessage(decoder, replyEncoder, this.ydoc, REMOTE_ORIGIN, (err) =>
        console.warn("Yjs sync message error:", err),
      );
      // A sync-step1 reply (step2) lands here; steady-state updates produce
      // no reply, so this only fires for the join/reconnect round-trip.
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
    const content = nip44.encrypt(uint8ToBase64(bytes), this.conversationKey);
    const event = finalizeEvent(
      {
        kind,
        tags: [["a", this.docAddress]],
        content,
        created_at: Math.floor(Date.now() / 1000),
      },
      this.session.sessionSecretKey,
    );
    // Ephemeral loss is tolerable here — the periodic sync-step round-trip
    // (and, for ops, Yjs's own convergence guarantee) reconciles any gaps.
    // Unlike the durable checkpoint, this is not the place for
    // publishEventStrict — failing loudly on every dropped cursor blip would
    // be pure noise.
    publishEvent(event, this.relays).catch(() => {
      /* best-effort, see comment above */
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

    // Broadcast a final "left" tombstone directly (not via the throttled
    // handler, already torn down above) so peers see this tab leave
    // promptly instead of waiting out awareness's own outdatedTimeout.
    const clientId = this.ydoc.clientID;
    removeAwarenessStates(this.awareness, [clientId], "tab closed");
    this.publishPresence(encodeAwarenessUpdate(this.awareness, [clientId]));

    this.awareness.destroy();
    this.sub?.close();
    this.sub = null;
  }
}
