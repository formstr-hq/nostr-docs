import { useEffect, useState } from "react";
import type * as YType from "yjs";
import type { IndexeddbPersistence as IndexeddbPersistenceType } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import type { NostrYjsProvider as NostrYjsProviderType } from "./NostrYjsProvider";
import type { Collaboration as CollaborationType } from "@tiptap/extension-collaboration";
import type { CollaborationCaret as CollaborationCaretType } from "@tiptap/extension-collaboration-caret";
import { getOrCreateSession } from "./sessionKeys";

// Grace period for the initial sync-step round-trip, so a client doesn't seed the
// empty Y.Doc from the Markdown snapshot before a peer's live state arrives.
// (Two clients seeding the same Markdown would make Yjs merge it into a
// duplicated document. The Markdown snapshot is the durable baseline; Yjs is an
// ephemeral, live-session layer.)
const READY_GRACE_MS = 1_500;

export interface CollabSession {
  ydoc: YType.Doc;
  provider: NostrYjsProviderType;
  awareness: Awareness;
  ready: boolean;
  CollaborationExt: typeof CollaborationType;
  CollaborationCaretExt: typeof CollaborationCaretType;
}

interface InternalSession {
  ydoc: YType.Doc;
  provider: NostrYjsProviderType;
  CollaborationExt: typeof CollaborationType;
  CollaborationCaretExt: typeof CollaborationCaretType;
}

/**
 * Sets up (and tears down) a Yjs + Nostr live-collaboration session for a shared
 * document. Returns null with zero overhead when there's no viewKey. The
 * document's durable state is the Markdown snapshots (kind 33457); Yjs carries
 * only in-session merges and is not persisted to relays.
 *
 * Yjs, y-indexeddb, the provider, and the TipTap collaboration extensions are
 * dynamically imported so only collab docs pay the bundle weight.
 */
export function useCollabSession(
  docAddress: string | null,
  viewKey: string | undefined,
  relays: string[],
): CollabSession | null {
  const [session, setSession] = useState<InternalSession | null>(null);
  const [ready, setReady] = useState(false);
  const enabled = !!docAddress && !!viewKey;

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

      // Local hydration first (this device's in-progress session), then connect.
      await idb.whenSynced;
      if (cancelled) return;

      const collabSession = await getOrCreateSession(docAddress, viewKey);
      if (cancelled) return;

      provider = new NostrYjsProvider({
        docAddress,
        ydoc,
        viewKey,
        relays,
        session: collabSession,
      });
      provider.connect();
      setSession({
        ydoc: ydoc!,
        provider,
        CollaborationExt: Collaboration,
        CollaborationCaretExt: CollaborationCaret,
      });

      // Ready immediately if this device already has content (a reload of an
      // in-progress session). A truly empty doc waits the grace so a peer's live
      // state can arrive before we seed from the Markdown snapshot.
      const hasLocalHistory = ydoc!.getXmlFragment("default").length > 0;
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
  };
}
