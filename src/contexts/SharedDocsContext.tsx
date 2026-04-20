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
import { removeLocalEvent } from "../lib/localStore";
import { shareDocumentToNpub } from "../nostr/shareDocument";

export interface ShareInvite {
  id: string; // event id of the invite
  address: string;
  replacesAddress?: string;
  viewKey: string;
  editKey?: string;
  title: string;
  senderPubkey?: string;
  senderNpub?: string;
  timestamp: number;
}

export interface ShareDeclineNotification {
  id: string;
  inviteId?: string;
  recipientPubkey: string;
  recipientNpub?: string;
  address: string;
  viewKey: string;
  editKey?: string;
  title: string;
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
  removeSharedDoc: (address: string) => Promise<void>;
  replaceSharedDoc: (oldAddress: string, nextTag: string[]) => Promise<void>;
  refresh: () => Promise<void>;
  sharedDocuments: Map<string, DocumentHistory>;
  getKeys: (id: string) => string[];
  pendingInvites: ShareInvite[];
  declineNotifications: ShareDeclineNotification[];
  acceptInvite: (invite: ShareInvite) => Promise<void>;
  rejectInvite: (inviteId: string) => Promise<void>;
  resendDeclineInvite: (id: string) => Promise<void>;
  addPendingInvite: (invite: ShareInvite) => void;
  registerOutgoingInviteId: (inviteId: string) => void;
}

const SharedPagesContext = createContext<SharedPagesContextValue | undefined>(
  undefined,
);

export const SharedPagesProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { relays } = useRelays();
  const { user } = useUser();
  const { addDocument, removeDocument } = useDocumentContext();
  const [sharedDocs, setSharedDocs] = useState<string[][]>([]);
  const sharedDocsRef = useRef<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [sharedDocuments, setSharedDocuments] = useState<
    Map<string, DocumentHistory>
  >(new Map());
  const [pendingInvites, setPendingInvites] = useState<ShareInvite[]>([]);
  const [declineNotifications, setDeclineNotifications] = useState<ShareDeclineNotification[]>([]);
  const [dismissedInviteIds, setDismissedInviteIds] = useState<string[]>([]);
  const [outgoingInviteIds, setOutgoingInviteIds] = useState<string[]>([]);
  const [autoReplacedDocs, setAutoReplacedDocs] = useState<Record<string, string>>({});
  const [suppressedSharedDocs, setSuppressedSharedDocs] = useState<string[]>([]);

  const userStorageScope = user?.pubkey ?? "anonymous";
  const pendingInvitesStorageKey = `formstr:pending_invites:${userStorageScope}`;
  const dismissedInviteIdsStorageKey = `formstr:dismissed_invite_ids:${userStorageScope}`;
  const outgoingInviteIdsStorageKey = `formstr:outgoing_invite_ids:${userStorageScope}`;
  const autoReplacedDocsStorageKey = `formstr:auto_replaced_docs:${userStorageScope}`;
  const suppressedSharedDocsStorageKey = `formstr:suppressed_shared_docs:${userStorageScope}`;
  const lastInviteSyncStorageKey = `formstr:last_invite_sync:${userStorageScope}`;

  const inviteSubRef = useRef<SubCloser | null>(null);
  const ownInviteSubRef = useRef<SubCloser | null>(null);
  const sharedDocsSubRef = useRef<SubCloser | null>(null);
  const subscriptionRef = useRef<SubCloser | null>(null);
  const deleteSubRef = useRef<SubCloser | null>(null);
  const pendingInvitesRef = useRef<ShareInvite[]>([]);
  const outgoingInviteIdsRef = useRef<Set<string>>(new Set(outgoingInviteIds));
  const dismissedInviteIdsRef = useRef<Set<string>>(new Set(dismissedInviteIds));

  const inviteIdentityKey = (invite: {
    address: string;
    viewKey: string;
    editKey?: string;
    replacesAddress?: string;
    senderPubkey?: string;
  }) =>
    [
      invite.senderPubkey ?? "",
      invite.address,
      invite.viewKey,
      invite.editKey ?? "",
      invite.replacesAddress ?? "",
    ].join("|");

  const isInviteAlreadyAccessible = (invite: {
    address: string;
    viewKey: string;
    editKey?: string;
  }) => {
    return sharedDocsRef.current.some((tag) => {
      const sameAddress = tag[0] === invite.address;
      const sameViewKey = tag[1] === invite.viewKey;
      const sameEditKey = (tag[2] ?? "") === (invite.editKey ?? "");
      return sameAddress && sameViewKey && sameEditKey;
    });
  };

  const dedupeInvites = (invites: ShareInvite[]) => {
    const latestByIdentity = new Map<string, ShareInvite>();
    for (const invite of invites) {
      const key = inviteIdentityKey(invite);
      const current = latestByIdentity.get(key);
      if (!current || invite.timestamp >= current.timestamp) {
        latestByIdentity.set(key, invite);
      }
    }
    return Array.from(latestByIdentity.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  };

  const readStored = <T,>(key: string, fallback: T): T => {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    try {
      return JSON.parse(stored) as T;
    } catch {
      return fallback;
    }
  };

  useEffect(() => {
    sharedDocsRef.current = sharedDocs;
  }, [sharedDocs]);

  useEffect(() => {
    setPendingInvites((prev) => prev.filter((invite) => !isInviteAlreadyAccessible(invite)));
  }, [sharedDocs]);

  useEffect(() => {
    pendingInvitesRef.current = pendingInvites;
  }, [pendingInvites]);

  useEffect(() => {
    outgoingInviteIdsRef.current = new Set(outgoingInviteIds);
  }, [outgoingInviteIds]);

  useEffect(() => {
    if (ownInviteSubRef.current) {
      ownInviteSubRef.current.close();
      ownInviteSubRef.current = null;
    }

    if (!user?.pubkey) return;

    const allRelays = [...new Set([...relays, ...DEFAULT_RELAYS])];
    ownInviteSubRef.current = pool.subscribeMany(
      allRelays,
      { kinds: [KIND_SHARE_INVITE], authors: [user.pubkey] },
      {
        onevent: (event: Event) => {
          setOutgoingInviteIds((prev) => (prev.includes(event.id) ? prev : [...prev, event.id]));
        },
      },
    );

    return () => {
      ownInviteSubRef.current?.close();
      ownInviteSubRef.current = null;
    };
  }, [user?.pubkey, relays]);

  useEffect(() => {
    if (sharedDocsSubRef.current) {
      sharedDocsSubRef.current.close();
      sharedDocsSubRef.current = null;
    }

    if (!user?.pubkey) return;

    const allRelays = [...new Set([...relays, ...DEFAULT_RELAYS])];
    sharedDocsSubRef.current = pool.subscribeMany(
      allRelays,
      { kinds: [11234], authors: [user.pubkey] },
      {
        onevent: () => {
          refresh().catch(() => {});
        },
      },
    );

    return () => {
      sharedDocsSubRef.current?.close();
      sharedDocsSubRef.current = null;
    };
  }, [user?.pubkey, relays]);

  useEffect(() => {
    if (!user?.pubkey) return;

    fetchEventsByKind(relays, KIND_SHARE_INVITE, user.pubkey, (event: Event) => {
      setOutgoingInviteIds((prev) => (prev.includes(event.id) ? prev : [...prev, event.id]));
    }).catch(() => {});
  }, [user?.pubkey, relays]);

  useEffect(() => {
    const hasInviteSyncMarker = Boolean(localStorage.getItem(lastInviteSyncStorageKey));

    setPendingInvites(
      hasInviteSyncMarker
        ? dedupeInvites(readStored<ShareInvite[]>(pendingInvitesStorageKey, []))
        : [],
    );
    setDeclineNotifications([]);
    setDismissedInviteIds(readStored<string[]>(dismissedInviteIdsStorageKey, []));
    setOutgoingInviteIds(readStored<string[]>(outgoingInviteIdsStorageKey, []));
    setAutoReplacedDocs(readStored<Record<string, string>>(autoReplacedDocsStorageKey, {}));
    setSuppressedSharedDocs(readStored<string[]>(suppressedSharedDocsStorageKey, []));
  }, [
    pendingInvitesStorageKey,
    dismissedInviteIdsStorageKey,
    outgoingInviteIdsStorageKey,
    autoReplacedDocsStorageKey,
    suppressedSharedDocsStorageKey,
    lastInviteSyncStorageKey,
  ]);

  useEffect(() => {
    localStorage.setItem(pendingInvitesStorageKey, JSON.stringify(pendingInvites));
  }, [pendingInvites, pendingInvitesStorageKey]);

  useEffect(() => {
    localStorage.setItem(
      dismissedInviteIdsStorageKey,
      JSON.stringify(dismissedInviteIds),
    );
    dismissedInviteIdsRef.current = new Set(dismissedInviteIds);
    setPendingInvites((prev) =>
      prev.filter((invite) => !dismissedInviteIdsRef.current.has(invite.id)),
    );
  }, [dismissedInviteIds, dismissedInviteIdsStorageKey]);

  useEffect(() => {
    localStorage.setItem(
      outgoingInviteIdsStorageKey,
      JSON.stringify(outgoingInviteIds),
    );
  }, [outgoingInviteIds, outgoingInviteIdsStorageKey]);

  useEffect(() => {
    localStorage.setItem(
      autoReplacedDocsStorageKey,
      JSON.stringify(autoReplacedDocs),
    );
  }, [autoReplacedDocs, autoReplacedDocsStorageKey]);

  useEffect(() => {
    localStorage.setItem(
      suppressedSharedDocsStorageKey,
      JSON.stringify(suppressedSharedDocs),
    );
  }, [suppressedSharedDocs, suppressedSharedDocsStorageKey]);

  const markInviteDismissed = (inviteId: string) => {
    setDismissedInviteIds((prev) =>
      prev.includes(inviteId) ? prev : [...prev, inviteId],
    );
    setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
  };

  const dismissInviteGroup = (invite: ShareInvite) => {
    const key = inviteIdentityKey(invite);
    const relatedIds = pendingInvites
      .filter((item) => inviteIdentityKey(item) === key)
      .map((item) => item.id);
    const idsToDismiss = relatedIds.includes(invite.id)
      ? relatedIds
      : [...relatedIds, invite.id];

    setDismissedInviteIds((prev) => {
      const set = new Set(prev);
      idsToDismiss.forEach((id) => set.add(id));
      return Array.from(set);
    });
    setPendingInvites((prev) =>
      prev.filter((item) => !idsToDismiss.includes(item.id)),
    );
  };

  const suppressSharedDoc = (address: string) => {
    setSuppressedSharedDocs((prev) => (prev.includes(address) ? prev : [...prev, address]));
  };

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
    if (deleteSubRef.current) {
      deleteSubRef.current.close();
      deleteSubRef.current = null;
    }

    if (sharedDocs.length === 0) return;

    const resolvedDocs = sharedDocs
      .filter((tag) => !suppressedSharedDocs.includes(tag[0]))
      .map((tag) => {
      const replacement = autoReplacedDocs[tag[0]];
      return replacement ? [replacement, ...tag.slice(1)] : tag;
      });

    const aTags = resolvedDocs.map((t) => t[0]);
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
        const keys = resolvedDocs.find((t) => t[0] === address);
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

    // Listen for deletions that target any currently tracked shared addresses.
    deleteSubRef.current = pool.subscribeMany(relays, {
      kinds: [5],
      "#a": aTags,
    }, {
      onevent: async (event: Event) => {
        const deletedAddresses = event.tags
          .filter((t) => t[0] === "a")
          .map((t) => t[1]);

        for (const address of deletedAddresses) {
          if (sharedDocs.some((t) => t[0] === address)) {
            await removeSharedDoc(address, false);
          }
        }
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

      const filtered = parsed.filter((tag) => !suppressedSharedDocs.includes(tag[0]));
      setSharedDocs(filtered);
      sharedDocsRef.current = filtered;
      fetchSharedDocuments(filtered, pubkey);
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

    const now = Math.floor(Date.now() / 1000);
    const storedLastSync = Number(localStorage.getItem(lastInviteSyncStorageKey) ?? "0");
    // First run for an account should not backfill old relay history as pending invites.
    const syncSince = Number.isFinite(storedLastSync) && storedLastSync > 0
      ? Math.max(0, storedLastSync - 120)
      : now - 120;
    localStorage.setItem(lastInviteSyncStorageKey, String(now));

    const filter: import("nostr-tools").Filter = {
        kinds: [KIND_SHARE_INVITE],
        "#p": [user.pubkey],
        since: syncSince,
    };

    console.log("[InviteListener] Subscribing for share invites:", filter);

    // Subscribe to both user relays AND default relays to ensure overlap with sender
    const allRelays = [...new Set([...relays, ...DEFAULT_RELAYS])];
    console.log("[InviteListener] Listening on relays:", allRelays);

    inviteSubRef.current = pool.subscribeMany(allRelays, filter, {
        onevent: async (event: Event) => {
            console.log("[InviteListener] Received invite event:", event.id, "from:", event.pubkey);

        // Persisted declines/accepts should not reappear after refresh.
        if (dismissedInviteIdsRef.current.has(event.id)) {
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
                if (payload.type === "declined") {
                  const originalInviteId = payload.originalInviteId;
                  if (!originalInviteId) return;

                  // If this decline is addressed to the current user, treat it as a
                  // dismissal signal so every device signed into that npub clears it.
                  if (payload.recipientPubkey && payload.recipientPubkey === user.pubkey) {
                    const matchingInvite = pendingInvitesRef.current.find(
                      (invite) => invite.id === originalInviteId,
                    );
                    if (matchingInvite) {
                      dismissInviteGroup(matchingInvite);
                    } else {
                      markInviteDismissed(originalInviteId);
                    }
                    return;
                  }

                  if (!outgoingInviteIdsRef.current.has(originalInviteId)) return;

                  setDeclineNotifications((prev) => {
                    if (prev.some((n) => n.id === event.id)) return prev;
                    return [
                      ...prev,
                      {
                        id: event.id,
                        inviteId: originalInviteId,
                        recipientPubkey: payload.recipientPubkey ?? event.pubkey,
                        recipientNpub: payload.recipientNpub,
                        address: payload.address,
                        viewKey: payload.viewKey,
                        editKey: payload.editKey,
                        title: payload.title ?? "Untitled",
                        timestamp: event.created_at,
                      },
                    ];
                  });
                  return;
                }

                if (payload.type !== "share") return;

                if (!payload.address || !payload.viewKey) {
                  return;
                }

                if (
                  isInviteAlreadyAccessible({
                    address: payload.address,
                    viewKey: payload.viewKey,
                    editKey: payload.editKey,
                  })
                ) {
                  markInviteDismissed(event.id);
                  return;
                }

                // Seamless rotation path: if this invite replaces a document that
                // is already in the recipient's shared list, auto-apply it.
                if (
                  payload.replacesAddress &&
                  sharedDocsRef.current.some((t) => t[0] === payload.replacesAddress)
                ) {
                  const nextTag = [
                    payload.address,
                    payload.viewKey,
                    ...(payload.editKey ? [payload.editKey] : []),
                  ];
                  const updatedDocs = sharedDocsRef.current.filter(
                    (t) => t[0] !== payload.replacesAddress,
                  );
                  const existingIndex = updatedDocs.findIndex(
                    (t) => t[0] === nextTag[0],
                  );
                  if (existingIndex >= 0) updatedDocs[existingIndex] = nextTag;
                  else updatedDocs.push(nextTag);

                  sharedDocsRef.current = updatedDocs;
                  setSharedDocs(updatedDocs);
                  suppressSharedDoc(payload.replacesAddress);
                  removeDocument(payload.replacesAddress);
                  removeLocalEvent(payload.replacesAddress).catch(() => {});
                  setAutoReplacedDocs((prev) => {
                    if (prev[payload.replacesAddress!] === payload.address) return prev;
                    return {
                      ...prev,
                      [payload.replacesAddress!]: payload.address,
                    };
                  });
                  fetchSharedDocuments(updatedDocs, user.pubkey);
                  setSharedDocuments((prev) => {
                    if (!prev.has(payload.replacesAddress)) return prev;
                    const next = new Map(prev);
                    next.delete(payload.replacesAddress);
                    return next;
                  });
                  markInviteDismissed(event.id);
                  return;
                }

                console.log("[InviteListener] Valid share invite:", payload.title, payload.address);

                setPendingInvites(prev => {
                    // Dedup by event id
                    if (prev.some(i => i.id === event.id)) return prev;
                  if (dismissedInviteIdsRef.current.has(event.id)) return prev;

                    const invite: ShareInvite = {
                        id: event.id,
                        address: payload.address,
                        replacesAddress: payload.replacesAddress,
                        viewKey: payload.viewKey,
                        editKey: payload.editKey,
                        title: payload.title,
                        senderPubkey: event.pubkey,
                        senderNpub: nip19.npubEncode(event.pubkey),
                        timestamp: event.created_at,
                    };
                    const sameInvite = prev.find(
                      (item) => inviteIdentityKey(item) === inviteIdentityKey(invite),
                    );
                    if (!sameInvite) {
                      return [...prev, invite];
                    }

                    // Keep only the latest event for identical invite content.
                    if (sameInvite.timestamp >= invite.timestamp) {
                      return prev;
                    }

                    return prev.map((item) =>
                      item.id === sameInvite.id ? invite : item,
                    );
                });
            } catch (e) {
                console.error("[InviteListener] Failed to process invite:", e);
            }
        }
    });

    return () => {
        inviteSubRef.current?.close();
    };
  }, [user, relays, lastInviteSyncStorageKey]);

  useEffect(() => {
    if (user) {
      refresh();
    } else {
      // Clear shared docs when user logs out
      setSharedDocs([]);
      setSharedDocuments(new Map());
      setPendingInvites([]);
      setDeclineNotifications([]);
      setDismissedInviteIds([]);
      setLoading(false);
    }

    // Cleanup subscription on unmount or when dependencies change
    return () => {
      if (deleteSubRef.current) {
        deleteSubRef.current.close();
        deleteSubRef.current = null;
      }
      if (subscriptionRef.current) {
        subscriptionRef.current.close();
        subscriptionRef.current = null;
      }
    };
  }, [relays, user]);

  const getSharedDocs = () => [...sharedDocs];

  const publishSharedDocs = async (
    nextSharedDocs: string[][],
    signer: Awaited<ReturnType<typeof signerManager.getSigner>>,
    pubkey: string,
  ) => {
    const serialized = JSON.stringify(nextSharedDocs);
    const encrypted = await signer.nip44Encrypt!(pubkey, serialized);

    const event: EventTemplate = {
      kind: 11234,
      tags: [],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    };

    const signed = await signer.signEvent(event);
    await publishEvent(signed, relays);
  };

  const addSharedDoc = async (tag: string[]) => {
    const signer = await signerManager.getSigner();
    if (!signer) return;

    // add or update
    const existingIndex = sharedDocs.findIndex((t) => t[0] === tag[0]);
    const updatedDocs = [...sharedDocs];
    if (existingIndex >= 0) updatedDocs[existingIndex] = tag;
    else updatedDocs.push(tag);

    const pubkey = await signer.getPublicKey();
    await publishSharedDocs(updatedDocs, signer, pubkey);

    // update state and subscribe to newly added document
    sharedDocsRef.current = updatedDocs;
    setSharedDocs(updatedDocs);
    fetchSharedDocuments(updatedDocs, pubkey);
  };

  const removeSharedDoc = async (address: string, persist = true) => {
    const updatedDocs = sharedDocs.filter((t) => t[0] !== address);

    if (updatedDocs.length !== sharedDocs.length) {
      const signer = await signerManager.getSigner();
      if (persist && signer) {
        const pubkey = await signer.getPublicKey();
        await publishSharedDocs(updatedDocs, signer, pubkey);
      }
      sharedDocsRef.current = updatedDocs;
      setSharedDocs(updatedDocs);
      suppressSharedDoc(address);
      removeDocument(address);
      removeLocalEvent(address).catch(() => {});
      if (user?.pubkey) {
        fetchSharedDocuments(updatedDocs, user.pubkey);
      }
    }

    setAutoReplacedDocs((prev) => {
      if (!(address in prev)) return prev;
      const next = { ...prev };
      delete next[address];
      return next;
    });

    setSharedDocuments((prev) => {
      if (!prev.has(address)) return prev;
      const next = new Map(prev);
      next.delete(address);
      return next;
    });
  };

  const replaceSharedDoc = async (oldAddress: string, nextTag: string[]) => {
    const updatedDocs = sharedDocs.filter((t) => t[0] !== oldAddress);
    const existingIndex = updatedDocs.findIndex((t) => t[0] === nextTag[0]);
    if (existingIndex >= 0) updatedDocs[existingIndex] = nextTag;
    else updatedDocs.push(nextTag);

    const signer = await signerManager.getSigner();
    if (!signer) return;

    const pubkey = await signer.getPublicKey();
    await publishSharedDocs(updatedDocs, signer, pubkey);

    sharedDocsRef.current = updatedDocs;
    setSharedDocs(updatedDocs);
    setAutoReplacedDocs((prev) => ({
      ...prev,
      [oldAddress]: nextTag[0],
    }));
    suppressSharedDoc(oldAddress);
    removeDocument(oldAddress);
    removeLocalEvent(oldAddress).catch(() => {});
    setSharedDocuments((prev) => {
      if (!prev.has(oldAddress)) return prev;
      const next = new Map(prev);
      next.delete(oldAddress);
      return next;
    });
    fetchSharedDocuments(updatedDocs, pubkey);
  };

  const acceptInvite = async (invite: ShareInvite) => {
    const nextTag = [
        invite.address,
        invite.viewKey,
        ...(invite.editKey ? [invite.editKey] : [])
    ];

    const replacedAddress = invite.replacesAddress;
    const updatedDocs = replacedAddress
      ? sharedDocs.filter((t) => t[0] !== replacedAddress)
      : [...sharedDocs];

    const existingIndex = updatedDocs.findIndex((t) => t[0] === nextTag[0]);
    if (existingIndex >= 0) updatedDocs[existingIndex] = nextTag;
    else updatedDocs.push(nextTag);

    const signer = await signerManager.getSigner();
    if (signer) {
      const pubkey = await signer.getPublicKey();
      await publishSharedDocs(updatedDocs, signer, pubkey);
      sharedDocsRef.current = updatedDocs;
      fetchSharedDocuments(updatedDocs, pubkey);
    }

    setSharedDocs(updatedDocs);
    if (replacedAddress) {
      setAutoReplacedDocs((prev) => ({
        ...prev,
        [replacedAddress]: nextTag[0],
      }));
      suppressSharedDoc(replacedAddress);
      removeDocument(replacedAddress);
      removeLocalEvent(replacedAddress).catch(() => {});
    }
    if (replacedAddress) {
      setSharedDocuments((prev) => {
        if (!prev.has(replacedAddress)) return prev;
        const next = new Map(prev);
        next.delete(replacedAddress);
        return next;
      });
    }
    dismissInviteGroup(invite);
  };

  const rejectInvite = async (inviteId: string) => {
    const invite = pendingInvites.find((i) => i.id === inviteId);
    if (invite?.senderPubkey) {
      try {
        const declinePayload = {
          type: "declined" as const,
          address: invite.address,
          viewKey: invite.viewKey,
          ...(invite.editKey ? { editKey: invite.editKey } : {}),
          title: invite.title,
          recipientPubkey: user?.pubkey,
          recipientNpub: user?.pubkey ? nip19.npubEncode(user.pubkey) : undefined,
          originalInviteId: invite.id,
        };

        await shareDocumentToNpub(
          invite.senderPubkey,
          declinePayload,
          relays,
        );
        if (user?.pubkey) {
          await shareDocumentToNpub(user.pubkey, declinePayload, relays);
        }
      } catch (err) {
        console.error("Failed to notify sender about decline:", err);
      }
    }
    if (invite) dismissInviteGroup(invite);
    else markInviteDismissed(inviteId);
  };

  const resendDeclineInvite = async (id: string) => {
    const note = declineNotifications.find((n) => n.id === id);
    if (!note) return;

    const inviteId = await shareDocumentToNpub(
      note.recipientPubkey,
      {
        type: "share",
        address: note.address,
        viewKey: note.viewKey,
        ...(note.editKey ? { editKey: note.editKey } : {}),
        title: note.title,
      },
      relays,
    );
    registerOutgoingInviteId(inviteId);
  };

  const addPendingInvite = (invite: ShareInvite) => {
    setPendingInvites(prev => {
      if (dismissedInviteIdsRef.current.has(invite.id)) return prev;
      if (prev.some(i => i.id === invite.id)) return prev;
      const sameInvite = prev.find(
        (item) => inviteIdentityKey(item) === inviteIdentityKey(invite),
      );
      if (!sameInvite) return [...prev, invite];
      if (sameInvite.timestamp >= invite.timestamp) return prev;
      return prev.map((item) => (item.id === sameInvite.id ? invite : item));
    });
  };

  const registerOutgoingInviteId = (inviteId: string) => {
    setOutgoingInviteIds((prev) => (prev.includes(inviteId) ? prev : [...prev, inviteId]));
  };

  return (
    <SharedPagesContext.Provider
      value={{
        sharedDocuments,
        loading,
        getSharedDocs,
        addSharedDoc,
        removeSharedDoc,
        replaceSharedDoc,
        refresh,
        getKeys,
        pendingInvites,
        declineNotifications,
        acceptInvite,
        rejectInvite,
        resendDeclineInvite,
        addPendingInvite,
        registerOutgoingInviteId,
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
