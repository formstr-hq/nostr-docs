import { getPublicKey, nip44, type Event } from "nostr-tools";
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
  storeLocalEvent,
  markBroadcast,
  type LocalStoredEvent,
} from "../lib/localStore";
import { pool } from "../nostr/relayPool";
import { KIND_FILE } from "../nostr/kinds";
import { fetchAllDocuments } from "../nostr/fetchFile";
import { fetchDeleteRequests } from "../nostr/fetchDelete";
import { publishEvent } from "../nostr/publish";
import type { SubCloser } from "nostr-tools/abstract-pool";

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
        const addresses: string[] = [];
        for (const entry of visitedEntries) {
          try {
            await addDocument(entry.event, {
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
  }, [addDocument]);

  // Reset user's personal documents when logged out
  useEffect(() => {
    if (!user) {
      setDocuments(new Map());
      setDeletedEventIds(new Set());
      setLocalOnlyAddresses(new Set());
      (async () => {
        try {
          const visitedEntries = await loadVisitedEvents();
          for (const entry of visitedEntries) {
            await addDocument(entry.event, {
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
    let liveSub: SubCloser | null = null;

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
          try {
            await addDocument(entry.event, {
              viewKey: entry.viewKey,
              editKey: entry.editKey,
            });
            if (entry.visited) {
              setSessionVisited((prev) => new Set([...prev, entry.address]));
            }
            if (entry.localOnly || entry.pendingBroadcast || !entry.event.sig) {
              markLocalOnly(entry.address, true);
            }
          } catch {
            // Skip events that can't be decrypted
          }
        }
      } catch (err) {
        console.warn("Failed to load local events:", err);
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

              storeLocalEvent({
                address,
                event: doc,
                viewKey,
                editKey,
                pendingBroadcast: false,
                savedAt: Date.now(),
              }).catch(() => {});
            }
          },
          pubkey,
        );

        if (isCancelled) return;
        await fetchDeleteRequests(relays, addDeletionRequest, pubkey);

        // ── Phase 3: Re-broadcast offline saves ─────────────
        for (const entry of localEntries) {
          if (entry.pendingBroadcast && !entry.localOnly) {
            publishEvent(entry.event, relays)
              .then(() => markBroadcast(entry.address))
              .catch(() => {});
          }
        }
      } catch (err) {
        console.error("Failed to fetch documents from relays:", err);
      }

      // ── Phase 4: Live relay subscription ─────────────────
      if (isCancelled) return;
      liveSub = pool.subscribeMany(
        relays,
        { kinds: [KIND_FILE], authors: [pubkey] },
        {
          onevent: async (event: Event) => {
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
              storeLocalEvent({
                address: addr,
                event,
                viewKey,
                editKey,
                pendingBroadcast: false,
                savedAt: Date.now(),
              }).catch(() => {});
            }
          },
        },
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

  return (
    <DocumentContext.Provider
      value={{
        documents,
        selectedDocumentId,
        setSelectedDocumentId,
        sessionVisited,
        unmarkVisited,
        addDocument,
        removeDocument,
        deletedEventIds,
        addDeletionRequest,
        clearDeletionRecord,
        visibleDocuments,
        visitedDocuments,
        localOnlyAddresses,
        markLocalOnly,
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
