import { useEffect, useState } from "react";
import type * as YType from "yjs";
import type { IndexeddbPersistence as IndexeddbPersistenceType } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import type { NostrYjsProvider as NostrYjsProviderType } from "./NostrYjsProvider";
import type { Collaboration as CollaborationType } from "@tiptap/extension-collaboration";
import type { CollaborationCaret as CollaborationCaretType } from "@tiptap/extension-collaboration-caret";
import { getOrCreateSession } from "./sessionKeys";

// Grace period for the initial sync-step round-trip so the editor doesn't
// flash empty/local-only content before any online peer replies.
const READY_GRACE_MS = 2_000;

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
 * Sets up (and tears down) a Yjs + Nostr collaboration session for a
 * document. Returns null with zero overhead when there's no `editKey` (solo
 * documents keep their existing save flow entirely unaffected — this hook
 * simply never runs anything for them).
 *
 * Yjs, y-indexeddb, NostrYjsProvider, and the TipTap collaboration
 * extensions are all loaded via dynamic import() here — only edit-link
 * (collab) docs should pay for that bundle weight, not every solo doc.
 *
 * Docs are addressed by `docAddress`; pass null to disable. Built to be
 * created/destroyed once per mount inside DocPage's existing
 * remount-on-navigation lifecycle (`App.tsx`'s `key={pathname+hash}`), so
 * this only needs a plain mount/unmount effect, not its own re-keying.
 */
export function useCollabSession(
  docAddress: string | null,
  editKey: string | undefined,
  relays: string[],
): CollabSession | null {
  const [session, setSession] = useState<InternalSession | null>(null);
  const [ready, setReady] = useState(false);
  const enabled = !!docAddress && !!editKey;

  useEffect(() => {
    if (!enabled || !docAddress || !editKey) return;

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

      // Local durability first: hydrate from IndexedDB before touching the
      // network, so a reload shows the last-known content instantly.
      await idb.whenSynced;
      if (cancelled) return;

      // The one real-signer prompt per tab/session; everything after this
      // is signed locally with the returned session key.
      const collabSession = await getOrCreateSession(docAddress, editKey, relays);
      if (cancelled) return;

      provider = new NostrYjsProvider({
        docAddress,
        ydoc,
        editKey,
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

      readyTimer = setTimeout(() => {
        if (!cancelled) setReady(true);
      }, READY_GRACE_MS);
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
  }, [enabled, docAddress, editKey, relays]);

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
