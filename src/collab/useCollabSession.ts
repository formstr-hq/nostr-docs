import { useEffect, useRef, useState } from "react";
import type * as YType from "yjs";
import type { IndexeddbPersistence as IndexeddbPersistenceType } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import type { NostrYjsProvider as NostrYjsProviderType } from "./NostrYjsProvider";
import type { Collaboration as CollaborationType } from "@tiptap/extension-collaboration";
import type { CollaborationCaret as CollaborationCaretType } from "@tiptap/extension-collaboration-caret";
import { getOrCreateSession } from "./sessionKeys";
import { fetchYjsCheckpoints, parseRootAddress } from "../nostr/sharedDoc";
import { base64ToUint8, uint8ToBase64 } from "../utils/base64";

// Grace period for the initial sync-step round-trip so the editor doesn't flash
// empty content before any online peer replies. Only used when this device has
// NO local Yjs history yet (i.e. the document has never been collaborated on
// from here) — a returning client loads instantly with no "connecting" state.
const READY_GRACE_MS = 1_500;

export interface CollabSession {
  ydoc: YType.Doc;
  provider: NostrYjsProviderType;
  awareness: Awareness;
  ready: boolean;
  CollaborationExt: typeof CollaborationType;
  CollaborationCaretExt: typeof CollaborationCaretType;
  /** Encode the current Yjs state as a base64 update for a durable checkpoint. */
  encodeState: () => string;
}

interface InternalSession {
  ydoc: YType.Doc;
  provider: NostrYjsProviderType;
  CollaborationExt: typeof CollaborationType;
  CollaborationCaretExt: typeof CollaborationCaretType;
  encodeState: () => string;
}

/**
 * Sets up (and tears down) a Yjs + Nostr collaboration session for a document.
 * Returns null with zero overhead when there's no viewKey or the caller can't
 * write; solo/private docs never touch this.
 *
 * Yjs, y-indexeddb, the provider, and the TipTap collaboration extensions are
 * dynamically imported so only collab docs pay the bundle weight.
 */
export function useCollabSession(
  docAddress: string | null,
  viewKey: string | undefined,
  relays: string[],
  markdownCreatedAt = 0,
): CollabSession | null {
  const [session, setSession] = useState<InternalSession | null>(null);
  const [ready, setReady] = useState(false);
  const enabled = !!docAddress && !!viewKey;
  // Newest Markdown snapshot time, read once per session for the freshness guard.
  const markdownAtRef = useRef(markdownCreatedAt);
  markdownAtRef.current = markdownCreatedAt;

  useEffect(() => {
    if (!enabled || !docAddress || !viewKey) return;

    let cancelled = false;
    setSession(null);
    setReady(false);

    let ydoc: YType.Doc | null = null;
    let idb: IndexeddbPersistenceType | null = null;
    let provider: NostrYjsProviderType | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const [
        YjsModule,
        { IndexeddbPersistence },
        { NostrYjsProvider },
        { Collaboration },
        { CollaborationCaret },
      ] = await Promise.all([
        import("yjs"),
        import("y-indexeddb"),
        import("./NostrYjsProvider"),
        import("@tiptap/extension-collaboration"),
        import("@tiptap/extension-collaboration-caret"),
      ]);
      if (cancelled) return;

      ydoc = new YjsModule.Doc();
      idb = new IndexeddbPersistence(docAddress, ydoc);

      // Local durability first: hydrate from IndexedDB before the network.
      await idb.whenSynced;
      if (cancelled) return;

      // Durable CRDT checkpoint: if this device has no local Yjs history, apply
      // the state updates every author left on relays. Yjs merges them, so the
      // result is the merged document regardless of which markdown snapshot won
      // last-write-wins (and without the empty-doc seeding race).
      let appliedCheckpoint = false;
      if (ydoc.getXmlFragment("default").length === 0) {
        const parsed = parseRootAddress(docAddress);
        if (parsed) {
          const checkpoints = await fetchYjsCheckpoints(
            parsed.owner,
            parsed.d,
            viewKey,
            relays,
          ).catch(() => ({ states: [] as string[], newestCreatedAt: 0 }));
          if (cancelled) return;
          // Freshness guard: never render a CRDT state older than the freshest
          // Markdown snapshot, or a stale checkpoint would regress the document.
          const mdAt = markdownAtRef.current;
          const useCheckpoints =
            checkpoints.newestCreatedAt > 0 &&
            (mdAt === 0 || checkpoints.newestCreatedAt >= mdAt);
          if (useCheckpoints) {
            for (const state of checkpoints.states) {
              try {
                YjsModule.applyUpdate(ydoc, base64ToUint8(state));
                appliedCheckpoint = true;
              } catch {
                /* skip malformed checkpoint */
              }
            }
          }
        }
      }

      const collabSession = await getOrCreateSession(docAddress, viewKey, relays);
      if (cancelled) return;

      provider = new NostrYjsProvider({
        docAddress,
        ydoc,
        viewKey,
        relays,
        session: collabSession,
      });
      provider.connect();
      const encodeState = () =>
        uint8ToBase64(YjsModule.encodeStateAsUpdate(ydoc as YType.Doc));
      setSession({
        ydoc: ydoc!,
        provider,
        CollaborationExt: Collaboration,
        CollaborationCaretExt: CollaborationCaret,
        encodeState,
      });

      // Ready immediately if the doc already has content (from local IndexedDB
      // or an applied checkpoint). Only a doc with no history anywhere needs the
      // grace period, to avoid two clients each seeding it from the markdown
      // snapshot (which Yjs would merge into a duplicated document).
      const hasLocalHistory =
        appliedCheckpoint || ydoc!.getXmlFragment("default").length > 0;
      if (hasLocalHistory) {
        setReady(true);
      } else {
        readyTimer = setTimeout(() => {
          if (!cancelled) setReady(true);
        }, READY_GRACE_MS);
      }
    })().catch((err) => {
      console.error("Failed to start collaboration session:", err);
    });

    return () => {
      cancelled = true;
      if (readyTimer) clearTimeout(readyTimer);
      provider?.destroy();
      idb?.destroy();
      ydoc?.destroy();
    };
  }, [enabled, docAddress, viewKey, relays]);

  if (!enabled || !session) return null;
  return {
    ydoc: session.ydoc,
    provider: session.provider,
    awareness: session.provider.awareness,
    ready,
    CollaborationExt: session.CollaborationExt,
    CollaborationCaretExt: session.CollaborationCaretExt,
    encodeState: session.encodeState,
  };
}
