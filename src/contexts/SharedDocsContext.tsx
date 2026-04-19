import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from "react";
import { fetchEventsByKind } from "../nostr/fetchFile";
import { useRelays } from "./RelayContext";
import { useUser } from "./UserContext";
import { useDocumentContext } from "./DocumentContext";
import { signerManager } from "../signer";
import {
  getPublicKey,
  nip44,
  nip19,
  type Event,
  type EventTemplate,
} from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { publishEvent } from "../nostr/publish";
import { pool, DEFAULT_RELAYS } from "../nostr/relayPool";
import { KIND_FILE, KIND_SHARE_INVITE } from "../nostr/kinds";
import type { SubCloser } from "nostr-tools/abstract-pool";

export interface ShareInvite {
  id: string; // event id of the invite
  address: string;
  viewKey: string;
  editKey?: string;
  title: string;
  senderNpub?: string;
  timestamp: number;
}

type DocumentVersion = {
  event: Event;
  decryptedContent: string;
};

type DocumentHistory = {
  versions: DocumentVersion[]; // sorted oldest → newest
};

interface SharedPagesContextValue {
  loading: boolean;
  getSharedDocs: () => string[][];
  addSharedDoc: (tag: string[]) => Promise<void>;
  refresh: () => Promise<void>;
  sharedDocuments: Map<string, DocumentHistory>;
  getKeys: (id: string) => string[];
  pendingInvites: ShareInvite[];
  acceptInvite: (invite: ShareInvite) => Promise<void>;
  rejectInvite: (inviteId: string) => void;
  addPendingInvite: (invite: ShareInvite) => void;
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
  const [pendingInvites, setPendingInvites] = useState<ShareInvite[]>(() => {
    const stored = localStorage.getItem("formstr:pending_invites");
    return stored ? JSON.parse(stored) : [];
  });

  const inviteSubRef = useRef<SubCloser | null>(null);
  const subscriptionRef = useRef<SubCloser | null>(null);

  useEffect(() => {
    localStorage.setItem("formstr:pending_invites", JSON.stringify(pendingInvites));
  }, [pendingInvites]);

  const getKeys = (id: string) => {
    const keys = sharedDocs.find((t) => t[0] === id);
    return keys?.slice(1) || [];
  };

  const fetchSharedDocuments = (sharedDocs: string[][], currentUserPubkey?: string) => {
    // Close any existing subscription before creating a new one
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
      subscriptionRef.current = null;
    }

    if (sharedDocs.length === 0) return;

    const aTags = sharedDocs.map((t) => t[0]);
    const dTags = aTags
      .map((a) => {
        try {
          return a.split(":")[2];
        } catch (e) {
          return null;
        }
      })
      .filter((b): b is string => b !== null);
    const pubkeys = aTags
      .map((a) => {
        try {
          return a.split(":")[1];
        } catch (e) {
          return null;
        }
      })
      .filter((b): b is string => b !== null);

    if (dTags.length === 0 || pubkeys.length === 0) return;

    const filter = {
      "#d": dTags,
      authors: pubkeys,
      kinds: [KIND_FILE],
    };

    subscriptionRef.current = pool.subscribeMany(relays, filter, {
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

        // If this is the user's own doc re-encrypted with a viewKey, add it to
        // the personal list so it doesn't silently disappear from "My Pages".
        if (event.pubkey === currentUserPubkey) {
          addDocument(event, { viewKey: keys[1] });
          return;
        }

        setSharedDocuments((prev) => {
          const next = new Map(prev);
          const history = next.get(address) ?? {
            address,
            versions: [],
          };

          if (history.versions.some((v) => v.event.id === event.id)) {
            return prev;
          }

          history.versions = [
            ...history.versions,
            {
              event,
              decryptedContent,
            },
          ].sort((a, b) => a.event.created_at - b.event.created_at);

          next.set(address, history);
          return next;
        });
      },
    });
  };

  // --- fetch and decrypt the shared pages list ---
  const refresh = async () => {
    setLoading(true);
    try {
      const signer = await signerManager.getSigner();
      if (!signer) return;

      const pubkey = await signer.getPublicKey();
      // fetch all kind 11234 events for this user
      const events: Event[] = [];
      await fetchEventsByKind(relays, 11234, pubkey, (event: Event) => {
        events.push(event);
      });

      if (events.length === 0) {
        setSharedDocs([]);
        setLoading(false);
        return;
      }

      // pick the latest event
      const latestEvent = events.reduce((prev, curr) =>
        curr.created_at > prev.created_at ? curr : prev,
      );

      // decrypt content
      const decrypted = await signer.nip44Decrypt!(pubkey, latestEvent.content);

      if (!decrypted) {
        setSharedDocs([]);
        setLoading(false);
        return;
      }

      let parsed: string[][] = [];
      try {
        parsed = JSON.parse(decrypted);
      } catch (err) {
        console.error("Failed to parse shared docs list:", err);
      }

      setSharedDocs(parsed);
      fetchSharedDocuments(parsed, pubkey);
    } catch (err) {
      console.error("Failed to fetch shared pages:", err);
    } finally {
      setLoading(false);
    }
  };

  // --- Direct Invite Listener (Kind 211234) ---
  useEffect(() => {
    if (inviteSubRef.current) {
        inviteSubRef.current.close();
        inviteSubRef.current = null;
    }

    if (!user || !user.pubkey) return;

    const filter: import("nostr-tools").Filter = {
        kinds: [KIND_SHARE_INVITE],
        "#p": [user.pubkey],
        since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30, // last 30 days
    };

    console.log("[InviteListener] Subscribing for share invites:", filter);

    // Subscribe to both user relays AND default relays to ensure overlap with sender
    const allRelays = [...new Set([...relays, ...DEFAULT_RELAYS])];
    console.log("[InviteListener] Listening on relays:", allRelays);

    inviteSubRef.current = pool.subscribeMany(allRelays, filter, {
        onevent: async (event: Event) => {
            console.log("[InviteListener] Received invite event:", event.id, "from:", event.pubkey);

            // Skip events authored by ourselves (we are the sender, not recipient)
            if (event.pubkey === user.pubkey) {
                console.log("[InviteListener] Skipping own event");
                return;
            }

            const signer = await signerManager.getSigner();
            if (!signer || !signer.nip44Decrypt) {
                console.warn("[InviteListener] No signer or nip44Decrypt unavailable");
                return;
            }

            try {
                // Decrypt the NIP-44 encrypted content
                const decrypted = await signer.nip44Decrypt(event.pubkey, event.content);
                if (!decrypted) {
                    console.log("[InviteListener] Could not decrypt invite");
                    return;
                }

                const payload = JSON.parse(decrypted);
                if (payload.type !== "share") return;

                console.log("[InviteListener] Valid share invite:", payload.title, payload.address);

                setPendingInvites(prev => {
                    // Dedup by event id
                    if (prev.some(i => i.id === event.id)) return prev;

                    const invite: ShareInvite = {
                        id: event.id,
                        address: payload.address,
                        viewKey: payload.viewKey,
                        editKey: payload.editKey,
                        title: payload.title,
                        senderNpub: nip19.npubEncode(event.pubkey),
                        timestamp: event.created_at,
                    };
                    return [...prev, invite];
                });
            } catch (e) {
                console.error("[InviteListener] Failed to process invite:", e);
            }
        }
    });

    return () => {
        inviteSubRef.current?.close();
    };
  }, [user, relays]);

  useEffect(() => {
    if (user) {
      refresh();
    } else {
      // Clear shared docs when user logs out
      setSharedDocs([]);
      setSharedDocuments(new Map());
      setPendingInvites([]);
      setLoading(false);
    }

    // Cleanup subscription on unmount or when dependencies change
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.close();
        subscriptionRef.current = null;
      }
    };
  }, [relays, user]);

  const getSharedDocs = () => [...sharedDocs];

  const addSharedDoc = async (tag: string[]) => {
    const signer = await signerManager.getSigner();
    if (!signer) return;

    // add or update
    const existingIndex = sharedDocs.findIndex((t) => t[0] === tag[0]);
    const updatedDocs = [...sharedDocs];
    if (existingIndex >= 0) updatedDocs[existingIndex] = tag;
    else updatedDocs.push(tag);

    const serialized = JSON.stringify(updatedDocs);

    // encrypt
    const pubkey = await signer.getPublicKey();
    const encrypted = await signer.nip44Encrypt!(pubkey, serialized);

    // create event
    const event: EventTemplate = {
      kind: 11234,
      tags: [],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    };

    const signed = await signer.signEvent(event);

    await publishEvent(signed, relays);

    // update state and subscribe to newly added document
    setSharedDocs(updatedDocs);
    fetchSharedDocuments(updatedDocs, pubkey);
  };

  const acceptInvite = async (invite: ShareInvite) => {
    const tag = [
        invite.address,
        invite.viewKey,
        ...(invite.editKey ? [invite.editKey] : [])
    ];
    await addSharedDoc(tag);
    setPendingInvites(prev => prev.filter(i => i.id !== invite.id));
  };

  const rejectInvite = (inviteId: string) => {
    setPendingInvites(prev => prev.filter(i => i.id !== inviteId));
  };

  const addPendingInvite = (invite: ShareInvite) => {
    setPendingInvites(prev => {
      if (prev.some(i => i.id === invite.id)) return prev;
      return [...prev, invite];
    });
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
        pendingInvites,
        acceptInvite,
        rejectInvite,
        addPendingInvite,
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
