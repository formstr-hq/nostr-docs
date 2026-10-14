import { getPublicKey, getEventHash, nip44, type Event } from "nostr-tools";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { signerManager } from "../signer";
import { getConversationKey } from "nostr-tools/nip44";
import { hexToBytes } from "nostr-tools/utils";
import { useUser } from "./UserContext";
import { useRelays } from "./RelayContext";
import { getEventAddress } from "../utils/helpers";
import {
  loadAllLocalEvents,
  loadVisitedEvents,
  saveLocalDocState,
  markBroadcast,
  type LocalStoredEvent,
} from "../lib/localStore";
import { KIND_FILE } from "../nostr/kinds";
import { fetchAllDocuments } from "../nostr/fetchFile";
import { fetchDeleteRequests } from "../nostr/fetchDelete";
import { publishEvent } from "../nostr/publish";
import { encryptContent } from "../utils/encryption";
import { makeTag } from "../utils/makeTag";
import { subscribe, fetchCachedMany, fetchCachedByAddresses, resolveEventsByAddress, cacheLocalEvents, type Subscription } from "../dataLayer";

type DocumentVersion = {
  event: Event;
  decryptedContent: string;
};

type DocumentHistory = {
  versions: DocumentVersion[]; // sorted oldest → newest
};

interface DocumentContextValue {
  documents: Map<string, DocumentHistory>;
  selectedDocumentId: string | null;

  setSelectedDocumentId: (id: string | null) => void;
  /** Addresses navigated to in the current browser session. */
  sessionVisited: Set<string>;
  /** Drop an address from the Visited tab (e.g. after promoting it to Shared). */
  unmarkVisited: (address: string) => void;
  addDocument: (
    document: Event,
    keys?: { viewKey?: string; editKey?: string },
  ) => Promise<void>;

  /**
   * Create a brand-new owner-encrypted page from raw Markdown. Returns the new
   * document address. Throws if there is no signer.
   *
   * `publish` (default true) broadcasts the page to the user's relays; when
   * false the page is stored on this device only (unsigned, never published),
   * mirroring the editor's "Device" mode.
   */
  addImportedDocument: (
    markdown: string,
    options?: { publish?: boolean },
  ) => Promise<string>;

  removeDocument: (id: string) => void;
  addDeletionRequest: (delEvent: Event) => void;
  clearDeletionRecord: (address: string) => void;

  deletedEventIds: Set<string>;

  /** Docs authored by the current user (not deleted). */
  visibleDocuments: Map<string, DocumentHistory>;
  /** Docs opened by the user but authored by someone else (not deleted). */
  visitedDocuments: Map<string, DocumentHistory>;

  /** Addresses of documents the user has explicitly set to device-only. */
  localOnlyAddresses: Set<string>;
  /** Update the in-memory device-only flag for a document address. */
  markLocalOnly: (address: string, localOnly: boolean) => void;
  /** Retrieve stored decryption/signing keys (viewKey, editKey) for a document. */
  getDocumentKeys: (
    address: string,
  ) => { viewKey?: string; editKey?: string } | undefined;
}

const DocumentContext = createContext<DocumentContextValue | undefined>(
  undefined,
);

const getDecryptedContent = async (
  event: Event,
  viewKey?: string,
): Promise<string | null> => {
  try {
    if (viewKey) {
      const conversationKey = getConversationKey(
        hexToBytes(viewKey),
        getPublicKey(hexToBytes(viewKey)),
      );
      const decryptedContent = nip44.decrypt(event.content, conversationKey);
      return decryptedContent;
    }

    // The signer manager waits for restore and opens the correct login/unlock flow.
    let signer;
    try {
      signer = await signerManager.getSigner();
    } catch {
      return null;
    }
    if (!signer || !signer.nip44Decrypt) return null;
    const pubkey = await signer.getPublicKey();
    if (event.pubkey !== pubkey) return null;
    return await signer.nip44Decrypt(pubkey, event.content);
  } catch (err) {
    console.error("Failed to decrypt content:", err);
    return null;
  }
};

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useUser();
  const { relays } = useRelays();
  const [documents, setDocuments] = useState<Map<string, DocumentHistory>>(
    new Map(),
  );
  const [_selectedDocumentId, _setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [sessionVisited, setSessionVisited] = useState<Set<string>>(new Set());
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(
    new Set(),
  );
  const [localOnlyAddresses, setLocalOnlyAddresses] = useState<Set<string>>(
    new Set(),
  );

  const localEntriesRef = useRef<Map<string, LocalStoredEvent>>(new Map());

  const selectedDocumentId = _selectedDocumentId;
  const setSelectedDocumentId = (id: string | null) => {
    _setSelectedDocumentId(id);
    if (id) {
      setSessionVisited((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  };

  const unmarkVisited = (address: string) => {
    const localEntry = localEntriesRef.current.get(address);
    if (localEntry) {
      localEntry.visited = undefined;
    }
    setSessionVisited((prev) => {
      if (!prev.has(address)) return prev;
      const next = new Set(prev);
      next.delete(address);
      return next;
    });
  };

  const markLocalOnly = (address: string, localOnly: boolean) => {
    setLocalOnlyAddresses((prev) => {
      const next = new Set(prev);
      if (localOnly) next.add(address);
      else next.delete(address);
      return next;
    });
  };

  const addDeletionRequest = (delEvent: Event) => {
    const eTags = delEvent.tags.filter((t) => t[0] === "e").map((t) => t[1]);
    const aTags = delEvent.tags.filter((t) => t[0] === "a").map((t) => t[1]);
    setDeletedEventIds((prev) => new Set([...prev, ...eTags, ...aTags]));
  };

  // Removes a specific address from deletedEventIds so a restored document
  // becomes visible again in the current session.
  const clearDeletionRecord = (address: string) => {
    setDeletedEventIds((prev) => {
      const next = new Set(prev);
      next.delete(address);
      return next;
    });
  };

  const removeDocument = (id: string) => {
    localEntriesRef.current.delete(id);
    setDocuments((prev) => {
      const newDocuments = new Map(prev);
      newDocuments.delete(id);
      return newDocuments;
    });

    _setSelectedDocumentId((current) => (current === id ? null : current));
  };

  const userPubkey = user?.pubkey;

  const visibleDocuments = useMemo(() => {
    return new Map(
      [...documents.entries()]
        .filter(([address, history]) => {
          if (deletedEventIds.has(address)) return false;
          const pubkey = history.versions[0]?.event.pubkey;
          if (userPubkey) {
            return pubkey === userPubkey;
          }
          return localOnlyAddresses.has(address) || !history.versions[0]?.event.sig;
        })
        .map(([address, history]): [string, DocumentHistory] => [
          address,
          {
            versions: history.versions.filter(
              (v) => !deletedEventIds.has(v.event.id),
            ),
          },
        ])
        .filter(([, h]) => h.versions.length > 0),
    );
  }, [documents, deletedEventIds, userPubkey, localOnlyAddresses]);

  const visitedDocuments = useMemo(() => {
    return new Map(
      [...documents.entries()]
        .filter(([address, history]) => {
          if (!sessionVisited.has(address)) return false;
          if (deletedEventIds.has(address)) return false;
          const pubkey = history.versions[0]?.event.pubkey;
          return !userPubkey || pubkey !== userPubkey;
        })
        .map(([address, history]): [string, DocumentHistory] => [
          address,
          {
            versions: history.versions.filter(
              (v) => !deletedEventIds.has(v.event.id),
            ),
          },
        ])
        .filter(([, h]) => h.versions.length > 0),
    );
  }, [documents, deletedEventIds, userPubkey, sessionVisited]);

  const addDocument = useCallback(
    async (
      document: Event,
      keys?: { viewKey?: string; editKey?: string },
    ) => {
      const address = getEventAddress(document);
      if (!address) return;

      const cachedEntry = address ? localEntriesRef.current.get(address) : undefined;
      const viewKey = keys?.viewKey ?? cachedEntry?.viewKey;

      if (address && (keys?.viewKey || keys?.editKey)) {
        const existing = localEntriesRef.current.get(address);
        if (existing) {
          existing.viewKey = keys.viewKey ?? existing.viewKey;
          existing.editKey = keys.editKey ?? existing.editKey;
        } else {
          localEntriesRef.current.set(address, {
            address,
            event: document,
            viewKey: keys.viewKey,
            editKey: keys.editKey,
            pendingBroadcast: false,
            savedAt: Date.now(),
          });
        }
      }

      const decryptedContent = await getDecryptedContent(document, viewKey);
      if (!decryptedContent) return;

      setDocuments((prev) => {
        const next = new Map(prev);
        const history = next.get(address) ?? {
          address,
          versions: [],
        };

        const alreadyPresent = history.versions.some(
          (v) => v.event.id === document.id,
        );
        if (alreadyPresent) {
          if (!viewKey) return prev;
          history.versions = history.versions.filter(
            (v) => v.event.id !== document.id,
          );
        }

        history.versions = [
          ...history.versions,
          {
            event: document,
            decryptedContent,
          },
        ].sort((a, b) => a.event.created_at - b.event.created_at);

        next.set(address, history);
        return next;
      });
    },
    [],
  );

  /**
   * Create a new owner-encrypted page from raw Markdown. Mirrors the editor's
   * "Save" path for a brand-new document: NIP-44 encrypt with the signer's own
   * key, sign a fresh kind-33457 event, cache it in the local relay
   * (offline-first) and broadcast best-effort. When `publish` is false the event
   * is left unsigned (never accepted by any relay) — a device-only page.
   */
  const addImportedDocument = useCallback(
    async (
      markdown: string,
      options?: { publish?: boolean },
    ): Promise<string> => {
      const publish = options?.publish ?? true;
      const signer = await signerManager.getSigner();
      if (!signer) throw new Error("Not signed in");

      const pubkey = await signer.getPublicKey();
      const dTag = makeTag(6);
      const address = `${KIND_FILE}:${pubkey}:${dTag}`;

      const encryptedContent = await encryptContent(markdown);
      const createdAt = Math.floor(Date.now() / 1000);

      let stored: Event;
      if (publish) {
        stored = await signer.signEvent({
          kind: KIND_FILE,
          tags: [["d", dTag]],
          content: encryptedContent,
          created_at: createdAt,
        });
      } else {
        // Device-only: a valid event id with an empty signature. Relays reject
        // it, so it structurally cannot be published.
        const template = {
          kind: KIND_FILE,
          tags: [["d", dTag]],
          content: encryptedContent,
          created_at: createdAt,
          pubkey,
        };
        stored = { ...template, id: getEventHash(template), sig: "" };
      }

      // The event lives in the local relay; only keys/flags go to the legacy
      // store (here just the device-only flag).
      await addDocument(stored);
      cacheLocalEvents([stored]);
      await saveLocalDocState({
        address,
        pendingBroadcast: publish,
        savedAt: Date.now(),
        localOnly: publish ? undefined : true,
        lastEventCreatedAt: stored.created_at,
      });

      if (!publish) {
        setLocalOnlyAddresses((prev) => {
          if (prev.has(address)) return prev;
          const next = new Set(prev);
          next.add(address);
          return next;
        });
        return address;
      }

      try {
        await publishEvent(stored, relays);
        await markBroadcast(address);
      } catch (err) {
        console.warn("Imported page kept locally (broadcast failed):", err);
      }

      return address;
    },
    [relays, addDocument],
  );

  // Hydrate visited pages from IndexedDB on mount so they survive a reload.
  // Runs independently of login — visited docs decrypt with their stored
  // viewKey, so no signer is required. Repopulates both the document cache and
  // sessionVisited (which the Visited tab is derived from).
  useEffect(() => {
    (async () => {
      try {
        const allEntries = await loadAllLocalEvents();
        for (const entry of allEntries) {
          localEntriesRef.current.set(entry.address, entry);
        }

        const visitedEntries = await loadVisitedEvents();
        if (visitedEntries.length === 0) return;

        // Resolve each visited page's event: local relay cache first, then a
        // live relay fetch (the relay's write-through is debounced, so a page
        // just opened may not be on disk yet). Falls back to a legacy row's
        // `event` (read-only back-compat).
        const cached = await resolveEventsByAddress(
          visitedEntries.map((e) => e.address),
          relays,
        );
        const cachedByAddress = new Map<string, Event>();
        for (const ev of cached) {
          const a = getEventAddress(ev);
          if (a) cachedByAddress.set(a, ev);
        }

        const addresses: string[] = [];
        for (const entry of visitedEntries) {
          const event = cachedByAddress.get(entry.address) ?? entry.event;
          if (!event) continue;
          try {
            await addDocument(event, {
              viewKey: entry.viewKey,
              editKey: entry.editKey,
            });
            addresses.push(entry.address);
          } catch {
            // Skip entries that can't be decrypted with the stored key.
          }
        }
        if (addresses.length > 0) {
          setSessionVisited((prev) => new Set([...prev, ...addresses]));
        }
      } catch (err) {
        console.warn("Failed to hydrate visited pages:", err);
      }
    })();
  }, [addDocument, relays]);

  // Reset user's personal documents when logged out
  useEffect(() => {
    if (!user) {
      setDocuments(new Map());
      setDeletedEventIds(new Set());
      setLocalOnlyAddresses(new Set());
      (async () => {
        try {
          const visitedEntries = await loadVisitedEvents();
          const cached = await fetchCachedByAddresses(
            visitedEntries.map((e) => e.address),
          );
          const cachedByAddress = new Map<string, Event>();
          for (const ev of cached) {
            const a = getEventAddress(ev);
            if (a) cachedByAddress.set(a, ev);
          }
          for (const entry of visitedEntries) {
            const event = cachedByAddress.get(entry.address) ?? entry.event;
            if (!event) continue;
            await addDocument(event, {
              viewKey: entry.viewKey,
              editKey: entry.editKey,
            });
          }
        } catch {} // eslint-disable-line no-empty
      })();
    }
  }, [user, addDocument]);

  // Fetch and sync user's documents when logged in
  useEffect(() => {
    if (!user?.pubkey) return;

    let isCancelled = false;
    let liveSub: Subscription | null = null;

    (async () => {
      let signer;
      try {
        signer = await signerManager.getSigner();
      } catch {
        return;
      }
      if (!signer || isCancelled) return;
      const pubkey = await signer.getPublicKey();
      if (isCancelled) return;

      // ── Phase 1: Local-first hydration ─────────────────
      let localEntries: LocalStoredEvent[] = [];
      try {
        localEntries = await loadAllLocalEvents();
        if (isCancelled) return;

        for (const entry of localEntries) {
          localEntriesRef.current.set(entry.address, entry);
          // Legacy rows still carry the event; newer rows resolve it from the
          // local relay cache in phase 1b below.
          if (entry.event) {
            try {
              await addDocument(entry.event, {
                viewKey: entry.viewKey,
                editKey: entry.editKey,
              });
            } catch {
              // Skip events that can't be decrypted
            }
          }
          if (entry.visited) {
            setSessionVisited((prev) => new Set([...prev, entry.address]));
          }
          if (entry.localOnly || entry.pendingBroadcast || (entry.event && !entry.event.sig)) {
            markLocalOnly(entry.address, true);
          }
        }
      } catch (err) {
        console.warn("Failed to load local events:", err);
      }

      // ── Phase 1b: local-relay cache (second read source) ──
      // Union the new local-relay IndexedDB with the legacy store above, so a
      // doc present in either place stays visible. Only the user's own docs are
      // pulled here; visited/shared docs still come from the legacy store and
      // SharedDocsProvider. Best-effort: a cold/empty cache is a no-op.
      try {
        const cachedEvents = await fetchCachedMany([
          { kinds: [KIND_FILE], authors: [pubkey] },
        ]);
        for (const event of cachedEvents) {
          if (isCancelled) return;
          const address = getEventAddress(event);
          const entry = address ? localEntriesRef.current.get(address) : undefined;
          try {
            await addDocument(event, {
              viewKey: entry?.viewKey,
              editKey: entry?.editKey,
            });
          } catch {
            // Skip events that can't be decrypted
          }
        }
      } catch (err) {
        console.warn("Failed to read local relay cache:", err);
      }

      if (relays.length === 0 || isCancelled) return;

      // ── Phase 2: Relay sync ─────────────────────────────
      try {
        await fetchAllDocuments(
          relays,
          async (doc: Event) => {
            if (isCancelled) return;
            const address = getEventAddress(doc);
            const localEntry = address
              ? (localEntriesRef.current.get(address) ?? localEntries.find((e) => e.address === address))
              : undefined;
            const viewKey = localEntry?.viewKey;
            const editKey = localEntry?.editKey;

            await addDocument(doc, { viewKey, editKey });

            if (address) {
              setLocalOnlyAddresses((prev) => {
                if (!prev.has(address)) return prev;
                const next = new Set(prev);
                next.delete(address);
                return next;
              });

              saveLocalDocState({
                address,
                viewKey,
                editKey,
                pendingBroadcast: false,
                savedAt: Date.now(),
                lastEventCreatedAt: doc.created_at,
              }).catch(() => {});
            }
          },
          pubkey,
        );

        if (isCancelled) return;
        await fetchDeleteRequests(relays, addDeletionRequest, pubkey);

        // ── Phase 3: Re-broadcast offline saves ─────────────
        const pending = localEntries.filter(
          (entry) => entry.pendingBroadcast && !entry.localOnly,
        );
        if (pending.length > 0) {
          const cachedPending = await fetchCachedByAddresses(
            pending.map((entry) => entry.address),
          );
          const cachedByAddress = new Map<string, Event>();
          for (const ev of cachedPending) {
            const a = getEventAddress(ev);
            if (a) cachedByAddress.set(a, ev);
          }
          for (const entry of pending) {
            const event = cachedByAddress.get(entry.address) ?? entry.event;
            if (!event) continue;
            publishEvent(event, relays)
              .then(() => markBroadcast(entry.address))
              .catch(() => {});
          }
        }
      } catch (err) {
        console.error("Failed to fetch documents from relays:", err);
      }

      // ── Phase 4: Live relay subscription ─────────────────
      if (isCancelled) return;
      liveSub = subscribe(
        [{ kinds: [KIND_FILE], authors: [pubkey] }],
        {
          onEvent: async (event: Event) => {
            if (isCancelled) return;
            const addr = getEventAddress(event);
            if (addr) {
              setLocalOnlyAddresses((prev) => {
                if (!prev.has(addr)) return prev;
                const next = new Set(prev);
                next.delete(addr);
                return next;
              });
            }
            const localEntry = addr ? localEntriesRef.current.get(addr) : undefined;
            const viewKey = localEntry?.viewKey;
            const editKey = localEntry?.editKey;

            await addDocument(event, { viewKey, editKey });
            if (addr) {
              saveLocalDocState({
                address: addr,
                viewKey,
                editKey,
                pendingBroadcast: false,
                savedAt: Date.now(),
                lastEventCreatedAt: event.created_at,
              }).catch(() => {});
            }
          },
        },
        relays,
      );
    })();

    return () => {
      isCancelled = true;
      if (liveSub) {
        try {
          liveSub.close();
        } catch {} // eslint-disable-line no-empty
      }
    };
  }, [user?.pubkey, relays, addDocument]);

  const getDocumentKeys = useCallback(
    (address: string): { viewKey?: string; editKey?: string } | undefined => {
      let entry = localEntriesRef.current.get(address);
      if (!entry) {
        for (const [addr, e] of localEntriesRef.current.entries()) {
          const parts = addr.split(":");
          const dTag = parts.length >= 3 ? parts.slice(2).join(":") : addr;
          if (dTag === address) {
            entry = e;
            break;
          }
        }
      }
      if (entry && (entry.viewKey || entry.editKey)) {
        return { viewKey: entry.viewKey, editKey: entry.editKey };
      }
      return undefined;
    },
    [],
  );

  return (
    <DocumentContext.Provider
      value={{
        documents,
        selectedDocumentId,
        setSelectedDocumentId,
        sessionVisited,
        unmarkVisited,
        addDocument,
        addImportedDocument,
        removeDocument,
        deletedEventIds,
        addDeletionRequest,
        clearDeletionRecord,
        visibleDocuments,
        visitedDocuments,
        localOnlyAddresses,
        markLocalOnly,
        getDocumentKeys,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
};

export const useDocumentContext = () => {
  const context = useContext(DocumentContext);
  if (!context) {
    throw new Error(
      "useDocumentContext must be used within a DocumentProvider",
    );
  }
  return context;
};
