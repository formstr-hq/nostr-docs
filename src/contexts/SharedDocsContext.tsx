import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from "react";
import { useRelays } from "./RelayContext";
import { useUser } from "./UserContext";
import { useDocumentContext } from "./DocumentContext";
import { signerManager } from "../signer";
import {
  getPublicKey,
  nip44,
  type Event,
} from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { storeLocalEvent, loadAllLocalEvents } from "../lib/localStore";
import { pool } from "../nostr/relayPool";
import { KIND_FILE } from "../nostr/kinds";
import { fetchAllDocMetadata, saveDocMetadata } from "../nostr/docMetadata";
import type { SubCloser } from "nostr-tools/abstract-pool";

type DocumentVersion = {
  event: Event;
  decryptedContent: string;
};

type DocumentHistory = {
  versions: DocumentVersion[];
};

interface SharedPagesContextValue {
  loading: boolean;
  getSharedDocs: () => string[][];
  addSharedDoc: (tag: string[]) => Promise<void>;
  refresh: () => Promise<void>;
  sharedDocuments: Map<string, DocumentHistory>;
  getKeys: (id: string) => string[];
}

const SharedPagesContext = createContext<SharedPagesContextValue | undefined>(
  undefined,
);

function matchAddress(a: string, b: string): boolean {
  if (a === b) return true;
  const aParts = a.split(":");
  const bParts = b.split(":");
  const aDTag = aParts.length >= 3 ? aParts.slice(2).join(":") : a;
  const bDTag = bParts.length >= 3 ? bParts.slice(2).join(":") : b;
  if (!aDTag || !bDTag || aDTag !== bDTag) return false;
  if (aParts.length >= 3 && bParts.length >= 3) {
    return aParts[1] === bParts[1];
  }
  return true;
}

export const SharedPagesProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { relays } = useRelays();
  const { user } = useUser();
  const { addDocument } = useDocumentContext();
  const [sharedDocs, setSharedDocs] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [sharedDocuments, setSharedDocuments] = useState<
    Map<string, DocumentHistory>
  >(new Map());

  const subscriptionRef = useRef<SubCloser | null>(null);

  const getKeys = (id: string) => {
    const keys = sharedDocs.find((t) => matchAddress(t[0], id));
    return keys?.slice(1) || [];
  };

  const fetchSharedDocuments = (sharedDocs: string[][], currentUserPubkey?: string) => {
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
      subscriptionRef.current = null;
    }

    if (sharedDocs.length === 0) return;

    const aTags = sharedDocs.map((t) => t[0]);
    const dTags = Array.from(
      new Set(
        aTags
          .map((a) => {
            const parts = a.split(":");
            return parts.length >= 3 ? parts.slice(2).join(":") : a;
          })
          .filter(Boolean),
      ),
    );
    const pubkeys = Array.from(
      new Set(
        aTags
          .map((a) => {
            const parts = a.split(":");
            return parts.length >= 3 ? parts[1] : null;
          })
          .filter((b): b is string => Boolean(b)),
      ),
    );

    if (dTags.length === 0) return;

    const filter: { kinds: number[]; "#d": string[]; authors?: string[] } = {
      kinds: [KIND_FILE],
      "#d": dTags,
    };
    if (pubkeys.length > 0 && pubkeys.length === aTags.length) {
      filter.authors = pubkeys;
    }

    subscriptionRef.current = pool.subscribeMany(
      relays,
      filter,
      {
        onevent: (event: Event) => {
          const dTag = event.tags.find((t) => t[0] === "d")?.[1];
          if (!dTag) return;

          const address = `${KIND_FILE}:${event.pubkey}:${dTag}`;
          const keys = sharedDocs.find((t) => matchAddress(t[0], address));
          if (!keys || !keys[1]) return;

          const conversationKey = nip44.getConversationKey(
            hexToBytes(keys[1]),
            getPublicKey(hexToBytes(keys[1])),
          );

          let decryptedContent: string;
          try {
            decryptedContent = nip44.decrypt(event.content, conversationKey);
          } catch {
            return;
          }

          if (event.pubkey === currentUserPubkey) {
            addDocument(event, { viewKey: keys[1], editKey: keys[2] });
            storeLocalEvent({
              address,
              event,
              viewKey: keys[1],
              editKey: keys[2],
              pendingBroadcast: false,
              savedAt: Date.now(),
            }).catch(() => {});
            return;
          }

          setSharedDocuments((prev) => {
            const next = new Map(prev);
            const history = next.get(address) ?? { address, versions: [] };

            if (history.versions.some((v) => v.event.id === event.id)) {
              return prev;
            }

            history.versions = [
              ...history.versions,
              { event, decryptedContent },
            ].sort((a, b) => a.event.created_at - b.event.created_at);

            next.set(address, history);
            return next;
          });

          storeLocalEvent({
            address,
            event,
            viewKey: keys[1],
            editKey: keys[2],
            pendingBroadcast: false,
            savedAt: Date.now(),
            visited: true,
          }).catch(() => {});
        },
      },
    );
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const signer = await signerManager.getSigner();
      if (!signer) return;

      const pubkey = await signer.getPublicKey();
      const allMetadata = await fetchAllDocMetadata(relays, pubkey);

      // Entries that have a viewKey are shared/received documents
      const shared: string[][] = [];
      for (const [address, meta] of allMetadata) {
        if (meta.viewKey) {
          const entry = [address, meta.viewKey];
          if (meta.editKey) entry.push(meta.editKey);
          shared.push(entry);
        }
      }

      setSharedDocs((prev) => {
        // Merge with existing sharedDocs to preserve any locally-added ones
        const map = new Map<string, string[]>();
        for (const s of prev) map.set(s[0], s);
        for (const s of shared) map.set(s[0], s);
        return Array.from(map.values());
      });
      fetchSharedDocuments(shared, pubkey);
    } catch (err) {
      console.error("Failed to fetch shared pages:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const entries = await loadAllLocalEvents();
        const initialSharedDocs: string[][] = [];
        for (const entry of entries) {
          if (entry.viewKey) {
            initialSharedDocs.push([
              entry.address,
              entry.viewKey,
              ...(entry.editKey ? [entry.editKey] : []),
            ]);

            // If authored by someone else, decrypt and add to sharedDocuments
            if (entry.event.pubkey !== user?.pubkey) {
              try {
                const conversationKey = nip44.getConversationKey(
                  hexToBytes(entry.viewKey),
                  getPublicKey(hexToBytes(entry.viewKey)),
                );
                const decryptedContent = nip44.decrypt(entry.event.content, conversationKey);
                setSharedDocuments((prev) => {
                  const next = new Map(prev);
                  const history = next.get(entry.address) ?? { address: entry.address, versions: [] };
                  if (history.versions.some((v) => v.event.id === entry.event.id)) return prev;
                  history.versions = [
                    ...history.versions,
                    { event: entry.event, decryptedContent },
                  ].sort((a, b) => a.event.created_at - b.event.created_at);
                  next.set(entry.address, history);
                  return next;
                });
              } catch {} // eslint-disable-line no-empty
            }
          }
        }
        if (initialSharedDocs.length > 0) {
          setSharedDocs((prev) => {
            const map = new Map<string, string[]>();
            for (const s of prev) map.set(s[0], s);
            for (const s of initialSharedDocs) {
              if (!map.has(s[0])) map.set(s[0], s);
            }
            return Array.from(map.values());
          });
        }
      } catch (err) {
        console.warn("Failed to load local shared events:", err);
      }
    })();
  }, [user?.pubkey]);

  useEffect(() => {
    if (user) {
      refresh();
    } else {
      setSharedDocs([]);
      setSharedDocuments(new Map());
      setLoading(false);
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.close();
        subscriptionRef.current = null;
      }
    };
  }, [relays, user]);

  const getSharedDocs = () => [...sharedDocs];

  const addSharedDoc = async (tag: string[]) => {
    const [address, viewKey, editKey] = tag;

    // Save as a metadata event only when a signer is available (logged-in users).
    // Non-logged-in users with an editKey have no key to encrypt metadata to.
    // Skip the write (and its signer prompt) when this exact entry is already
    // in our list — re-opening share on an already-shared doc shouldn't re-sign.
    const existing = sharedDocs.find((t) => matchAddress(t[0], address));
    const alreadyStored =
      existing && existing[1] === viewKey && (existing[2] ?? undefined) === (editKey ?? undefined);
    const signer = await signerManager.getSigner();
    if (signer && !alreadyStored) {
      await saveDocMetadata(
        address,
        { tags: [], viewKey, ...(editKey ? { editKey } : {}) },
        relays,
      );
    }

    const pubkey = signer ? await signer.getPublicKey() : undefined;

    setSharedDocs((prev) => {
      const updated = prev.filter((t) => !matchAddress(t[0], address));
      updated.push(tag);
      return updated;
    });
    fetchSharedDocuments([tag], pubkey);
  };

  return (
    <SharedPagesContext.Provider
      value={{
        sharedDocuments,
        loading,
        getSharedDocs,
        addSharedDoc,
        refresh,
        getKeys,
      }}
    >
      {children}
    </SharedPagesContext.Provider>
  );
};

export const useSharedPages = () => {
  const context = useContext(SharedPagesContext);
  if (!context) {
    throw new Error("useSharedPages must be used within a SharedPagesProvider");
  }
  return context;
};
