import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { pool } from "../nostr/relayPool";
import { useRelays } from "./RelayContext";
import { useUser } from "./UserContext";
import type { DocumentHistory } from "../lib/docSearch";
import { KIND_LONGFORM, KIND_COMMUNITY_NIP } from "../utils/publishArticle";

interface PublishedContextValue {
  /** address ("kind:pubkey:dtag") → history, so it plugs into the doc list. */
  publishedDocuments: Map<string, DocumentHistory>;
  loading: boolean;
}

const PublishedContext = createContext<PublishedContextValue | undefined>(undefined);

/**
 * Tracks the current user's own public posts — long-form articles (30023) and
 * community NIPs (30817) — so they can be listed in a "Published" tab. Content
 * is plaintext markdown, so no decryption is needed.
 */
export const PublishedProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { relays } = useRelays();
  const { user } = useUser();
  const [publishedDocuments, setPublishedDocuments] = useState<Map<string, DocumentHistory>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const subRef = useRef<SubCloser | null>(null);

  useEffect(() => {
    subRef.current?.close();
    subRef.current = null;

    if (!user?.pubkey) {
      setPublishedDocuments(new Map());
      return;
    }

    setLoading(true);
    setPublishedDocuments(new Map());

    subRef.current = pool.subscribeMany(
      relays,
      { kinds: [KIND_LONGFORM, KIND_COMMUNITY_NIP], authors: [user.pubkey] },
      {
        onevent: (event: Event) => {
          const dTag = event.tags.find((t) => t[0] === "d")?.[1];
          if (!dTag) return;
          const address = `${event.kind}:${event.pubkey}:${dTag}`;
          setPublishedDocuments((prev) => {
            // Addressable: keep only the newest event per address.
            const existing = prev.get(address)?.versions[0]?.event;
            if (existing && existing.created_at >= event.created_at) return prev;
            const next = new Map(prev);
            next.set(address, { versions: [{ event, decryptedContent: event.content }] });
            return next;
          });
        },
        oneose: () => setLoading(false),
      },
    );

    return () => {
      subRef.current?.close();
      subRef.current = null;
    };
  }, [relays, user?.pubkey]);

  return (
    <PublishedContext.Provider value={{ publishedDocuments, loading }}>
      {children}
    </PublishedContext.Provider>
  );
};

export const usePublished = () => {
  const context = useContext(PublishedContext);
  if (!context) throw new Error("usePublished must be used within a PublishedProvider");
  return context;
};
