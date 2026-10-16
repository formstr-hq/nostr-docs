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
import { finalizeEvent, nip44, type Event } from "nostr-tools";
import { publishEvent } from "../nostr/publish";
import { subscribe, type Subscription } from "../dataLayer";
import { KIND_CRDT_OP, KIND_PRESENCE } from "../nostr/kinds";
import { viewKeyConversationKey, collabRoom } from "../nostr/sharedDoc";
import type { Session } from "./sessionKeys";
import { recordAttestation } from "./sessionKeys";
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

export interface NostrYjsProviderOptions {
  /** Root address `33457:<owner>:<d>` — the Yjs room identity. */
  docAddress: string;
  ydoc: Y.Doc;
  viewKey: string;
  relays: string[];
  session: Session;
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
    this.sessionPubkey = options.session.sessionPubkey;
    this.awareness = new Awareness(this.ydoc);
    // Only the session pubkey — names/colors are resolved via attestation +
    // profile, never taken from self-asserted awareness state.
    this.awareness.setLocalStateField("user", {
      sessionPubkey: this.session.sessionPubkey,
    });
  }

  connect(): void {
    this.ydoc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);

    this.sub = subscribe(
      [{ kinds: [KIND_CRDT_OP, KIND_PRESENCE], "#a": [this.room] }],
      { onEvent: (event) => void this.handleIncoming(event) },
      this.relays,
    );

    this.sendSyncStep1();
    this.syncInterval = setInterval(
      () => this.sendSyncStep1(),
      SYNC_STEP_INTERVAL_MS,
    );
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }
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

    // Authorization = possession of viewKey: the conversation key below is
    // derived from viewKey, so only a viewKey holder can produce ciphertext
    // that decrypts. (The relay has already verified event.sig.)
    // Plaintext is a JSON envelope carrying the embedded attestation (if any)
    // and the base64 Yjs payload. The attestation travels inside the ciphertext,
    // so relays never see the real identity.
    let bytes: Uint8Array;
    try {
      const decrypted = nip44.decrypt(event.content, this.conversationKey);
      let messageB64 = decrypted;
      try {
        const parsed = JSON.parse(decrypted) as { a?: Event; m?: unknown };
        if (parsed && typeof parsed.m === "string") {
          if (parsed.a) recordAttestation(parsed.a);
          messageB64 = parsed.m;
        }
      } catch {
        // not JSON — legacy raw-base64 payload
      }
      bytes = base64ToUint8(messageB64);
    } catch {
      return;
    }

    if (event.kind === KIND_PRESENCE) {
      try {
        applyAwarenessUpdate(this.awareness, bytes, REMOTE_ORIGIN);
      } catch {
        /* malformed presence */
      }
      return;
    }

    try {
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
    const payload = JSON.stringify({
      a: this.session.attestation,
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
