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
import { saveLocalDocState, loadAllLocalEvents, type LocalStoredEvent } from "../lib/localStore";
import { KIND_FILE } from "../nostr/kinds";
import { fetchAllDocMetadata, saveDocMetadata } from "../nostr/docMetadata";
import { subscribe, resolveEventsByAddress, cacheLocalEvents, type Subscription } from "../dataLayer";
import { getEventAddress } from "../utils/helpers";
import { authorSet, collabRoom, fetchRoster, parseRootAddress } from "../nostr/sharedDoc";

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

  const subscriptionRef = useRef<Subscription | null>(null);

  const getKeys = (id: string) => {
    const keys = sharedDocs.find((t) => matchAddress(t[0], id));
    return keys?.slice(1) || [];
  };

  const fetchSharedDocuments = async (
    sharedDocs: string[][],
    currentUserPubkey?: string,
  ) => {
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
      subscriptionRef.current = null;
    }

    if (sharedDocs.length === 0) return;

    // One entry per shared document. For v2 group docs the author set comes from
    // the owner's roster; without a roster it degrades to the single author in
    // the address (legacy edit-key/view-only shares), preserving old behavior.
    type Entry = {
      root: string; // documentId: root address for group docs, author address for legacy
      owner: string;
      d: string;
      viewKey: string;
      editKey?: string;
      room: string;
      open: boolean;
      authors: Set<string>;
    };
    const entries: Entry[] = [];
    const filters: { kinds: number[]; "#d"?: string[]; "#a"?: string[]; authors?: string[] }[] = [];

    for (const t of sharedDocs) {
      const [addr, viewKey, editKey] = t;
      if (!viewKey) continue;
      const parsed = parseRootAddress(addr);
      if (!parsed) continue;

      let roster = null;
      try {
        roster = await fetchRoster(parsed.owner, parsed.d, viewKey, relays);
      } catch {
        roster = null;
      }

      const open = roster?.mode === "open";
      const room = collabRoom(viewKey);
      const authorsList = authorSet(parsed.owner, roster);
      entries.push({
        root: addr,
        owner: parsed.owner,
        d: parsed.d,
        viewKey,
        editKey,
        room,
        open,
        authors: new Set(authorsList),
      });
      // `open` mode has no author set to filter on: discover versions by the
      // capability-derived room tag. Restricted/legacy keeps the author filter.
      if (open) {
        filters.push({ kinds: [KIND_FILE], "#a": [room] });
      } else {
        filters.push({ kinds: [KIND_FILE], authors: authorsList, "#d": [parsed.d] });
      }
    }

    if (filters.length === 0) return;

    subscriptionRef.current = subscribe(
      filters,
      {
        onEvent: (event: Event) => {
          const dTag = event.tags.find((t) => t[0] === "d")?.[1];
          if (!dTag) return;

          const eventRoot = event.tags.find((t) => t[0] === "a")?.[1];
          const entry = entries.find((e) =>
            e.open
              ? eventRoot === e.room || dTag === e.d
              : e.d === dTag && e.authors.has(event.pubkey),
          );
          if (!entry) return;

          const conversationKey = nip44.getConversationKey(
            hexToBytes(entry.viewKey),
            getPublicKey(hexToBytes(entry.viewKey)),
          );

          let decryptedContent: string;
          try {
            decryptedContent = nip44.decrypt(event.content, conversationKey);
          } catch {
            return;
          }

          // The owner's own view of a shared/group doc belongs in their personal
          // documents (keyed by root, owner set) so the editor treats them as the
          // owner; everyone else's versions land in the shared-with-me store.
          if (currentUserPubkey === entry.owner) {
            addDocument(
              event,
              { viewKey: entry.viewKey, editKey: entry.editKey },
              { documentId: entry.root, owner: entry.owner },
            );
            cacheLocalEvents([event]);
            saveLocalDocState({
              address: entry.root,
              viewKey: entry.viewKey,
              editKey: entry.editKey,
              pendingBroadcast: false,
              savedAt: Date.now(),
              lastEventCreatedAt: event.created_at,
            }).catch(() => {});
            return;
          }

          setSharedDocuments((prev) => {
            const next = new Map(prev);
            const history = next.get(entry.root) ?? {
              address: entry.root,
              owner: entry.owner,
              versions: [],
            };

            if (history.versions.some((v) => v.event.id === event.id)) {
              return prev;
            }

            history.versions = [
              ...history.versions,
              { event, decryptedContent },
            ].sort((a, b) => a.event.created_at - b.event.created_at);

            next.set(entry.root, history);
            return next;
          });

          cacheLocalEvents([event]);
          saveLocalDocState({
            address: entry.root,
            viewKey: entry.viewKey,
            editKey: entry.editKey,
            pendingBroadcast: false,
            savedAt: Date.now(),
            lastEventCreatedAt: event.created_at,
          }).catch(() => {});
        },
      },
      relays,
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
      fetchSharedDocuments(shared, pubkey).catch((err) =>
        console.error("Failed to subscribe to shared pages:", err),
      );
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
        const sharedEntries = new Map<string, LocalStoredEvent>();
        for (const entry of entries) {
          if (entry.viewKey && !entry.visited) {
            initialSharedDocs.push([
              entry.address,
              entry.viewKey,
              ...(entry.editKey ? [entry.editKey] : []),
            ]);
            sharedEntries.set(entry.address, entry);
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

        // Event payloads live in the local relay now. Prefer the cached copy and
        // fall back to a legacy row's `event` (read-only back-compat) so docs
        // written by either era still resolve.
        const cached = await resolveEventsByAddress(
          [...sharedEntries.keys()],
          relays,
        );
        const cachedByAddress = new Map<string, Event>();
        for (const ev of cached) {
          const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
          if (dTag) cachedByAddress.set(`${ev.kind}:${ev.pubkey}:${dTag}`, ev);
        }

        for (const [address, entry] of sharedEntries) {
          const viewKey = entry.viewKey;
          if (!viewKey) continue;
          const event = cachedByAddress.get(address) ?? entry.event;
          if (!event || event.pubkey === user?.pubkey) continue;
          try {
            const conversationKey = nip44.getConversationKey(
              hexToBytes(viewKey),
              getPublicKey(hexToBytes(viewKey)),
            );
            const decryptedContent = nip44.decrypt(event.content, conversationKey);
            setSharedDocuments((prev) => {
              const next = new Map(prev);
              const history = next.get(address) ?? { address, versions: [] };
              if (history.versions.some((v) => v.event.id === event.id)) return prev;
              history.versions = [
                ...history.versions,
                { event, decryptedContent },
              ].sort((a, b) => a.event.created_at - b.event.created_at);
              next.set(address, history);
              return next;
            });
          } catch {} // eslint-disable-line no-empty
        }
      } catch (err) {
        console.warn("Failed to load local shared events:", err);
      }
    })();
  }, [user?.pubkey, relays]);

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

    // Also populate sharedDocuments immediately from local state + the relay
    // cache if available, so we don't depend solely on relay subscription
    // round-trips.
    try {
      const entries = await loadAllLocalEvents();
      const entry = entries.find((e) => matchAddress(e.address, address));
      const viewKey2 = entry?.viewKey;
      if (entry && viewKey2) {
        const cached = await resolveEventsByAddress([entry.address], relays);
        const event =
          cached.find((ev) => getEventAddress(ev) === entry.address) ?? entry.event;
        if (event && event.pubkey !== user?.pubkey) {
          const conversationKey = nip44.getConversationKey(
            hexToBytes(viewKey2),
            getPublicKey(hexToBytes(viewKey2)),
          );
          const decryptedContent = nip44.decrypt(event.content, conversationKey);
          setSharedDocuments((prev) => {
            const next = new Map(prev);
            const history = next.get(entry.address) ?? { address: entry.address, versions: [] };
            if (!history.versions.some((v) => v.event.id === event.id)) {
              history.versions = [
                ...history.versions,
                { event, decryptedContent },
              ].sort((a, b) => a.event.created_at - b.event.created_at);
              next.set(entry.address, history);
            }
            return next;
          });
        }
      }
    } catch {} // eslint-disable-line no-empty

    fetchSharedDocuments([tag], pubkey).catch((err) =>
      console.error("Failed to subscribe to shared doc:", err),
    );
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
