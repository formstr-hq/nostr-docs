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
import { storeLocalEvent } from "../lib/localStore";
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
    const keys = sharedDocs.find((t) => t[0] === id);
    return keys?.slice(1) || [];
  };

  const fetchSharedDocuments = (sharedDocs: string[][], currentUserPubkey?: string) => {
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
      subscriptionRef.current = null;
    }

    if (sharedDocs.length === 0) return;

    const aTags = sharedDocs.map((t) => t[0]);
    const dTags = aTags
      .map((a) => {
        try { return a.split(":")[2]; } catch { return null; }
      })
      .filter((b): b is string => b !== null);
    const pubkeys = aTags
      .map((a) => {
        try { return a.split(":")[1]; } catch { return null; }
      })
      .filter((b): b is string => b !== null);

    if (dTags.length === 0 || pubkeys.length === 0) return;

    subscriptionRef.current = pool.subscribeMany(
      relays,
      { "#d": dTags, authors: pubkeys, kinds: [KIND_FILE] },
      {
        onevent: (event: Event) => {
          const dTag = event.tags.find((t) => t[0] === "d")?.[1];
          if (!dTag) return;

          const address = `${KIND_FILE}:${event.pubkey}:${dTag}`;
          const keys = sharedDocs.find((t) => t[0] === address);
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
            addDocument(event, { viewKey: keys[1] });
            const dTag = event.tags.find((t) => t[0] === "d")?.[1];
            if (dTag) {
              storeLocalEvent({
                address: `${event.kind}:${event.pubkey}:${dTag}`,
                event,
                viewKey: keys[1],
                pendingBroadcast: false,
                savedAt: Date.now(),
              }).catch(() => {});
            }
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

      setSharedDocs(shared);
      fetchSharedDocuments(shared, pubkey);
    } catch (err) {
      console.error("Failed to fetch shared pages:", err);
    } finally {
      setLoading(false);
    }
  };

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
    const signer = await signerManager.getSigner();
    if (signer) {
      await saveDocMetadata(
        address,
        { tags: [], viewKey, ...(editKey ? { editKey } : {}) },
        relays,
      );
    }

    const pubkey = signer ? await signer.getPublicKey() : undefined;

    setSharedDocs((prev) => {
      const updated = prev.filter((t) => t[0] !== address);
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
