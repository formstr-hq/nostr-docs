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
import { authorSet, collabRoom, fetchRoster, isOpenRoster, parseRootAddress } from "../nostr/sharedDoc";
import { saveFontResource } from "../lib/fontStore";
import { registerFontFaceFromBlob } from "../lib/fontRegister";
import { sha256Hex } from "../utils/fileEncryption";

type DocumentVersion = {
  event: Event;
  decryptedContent: string;
};

type DocumentHistory = {
  versions: DocumentVersion[]; // sorted oldest → newest
  /**
   * Root pubkey that owns the document. For legacy single-author docs this is
   * the author's own pubkey (derived from the event when absent); for v2 group
   * docs it is the owner from the root address, which may differ from the
   * pubkey of any individual version.
   */
  owner?: string;
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
    ref?: { documentId?: string; owner?: string },
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
    options?: { publish?: boolean; awaitBroadcast?: boolean },
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
      const plaintext = nip44.decrypt(event.content, conversationKey);
      return plaintext;
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
    const plaintext = await signer.nip44Decrypt(pubkey, event.content);
    return plaintext;
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
          const pubkey = history.owner ?? history.versions[0]?.event.pubkey;
          if (userPubkey) {
            return pubkey === userPubkey;
          }
          return localOnlyAddresses.has(address) || !history.versions[0]?.event.sig;
        })
        .map(([address, history]): [string, DocumentHistory] => [
          address,
          {
            owner: history.owner,
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
          const pubkey = history.owner ?? history.versions[0]?.event.pubkey;
          return !userPubkey || pubkey !== userPubkey;
        })
        .map(([address, history]): [string, DocumentHistory] => [
          address,
          {
            owner: history.owner,
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
      ref?: { documentId?: string; owner?: string },
    ) => {
      const authorAddress = getEventAddress(document);
      if (!authorAddress) return;

      // v2 group docs are keyed by their root address so every author's version
      // lives under one document. Legacy single-author docs keep keying by the
      // author address (documentId === authorAddress), so behavior is unchanged.
      let documentId = ref?.documentId ?? authorAddress;
      let owner = ref?.owner ?? document.pubkey;

      let cachedEntry = localEntriesRef.current.get(documentId);
      let viewKey = keys?.viewKey ?? cachedEntry?.viewKey;
      if (!viewKey) {
        // A v2 event carries ["a", room] (a capability id, not the root). If we
        // already hold that document's viewKey locally (e.g. the owner's own
        // re-published event, or a participant's own author-slot write), use it
        // instead of wrongly attempting a self-decrypt — and, when it is our own
        // write for a group doc we know, key it under the group's root (not our
        // own address) so the doc isn't duplicated as a personal page.
        const eventRoom = document.tags.find((t) => t[0] === "a")?.[1];
        const wantD = (eventRoom ?? documentId).split(":").slice(2).join(":");
        for (const [addr, e] of localEntriesRef.current.entries()) {
          if (!e.viewKey) continue;
          const roomMatch = !!eventRoom && collabRoom(e.viewKey) === eventRoom;
          const dMatch = addr.split(":").slice(2).join(":") === wantD;
          if (!roomMatch && !dMatch) continue;
          viewKey = e.viewKey;
          if (roomMatch && !ref?.documentId && addr !== documentId) {
            documentId = addr;
            owner = addr.split(":")[1] || owner;
            cachedEntry = e;
          }
          break;
        }
      }

      if (keys?.viewKey || keys?.editKey) {
        const existing = localEntriesRef.current.get(documentId);
        if (existing) {
          existing.viewKey = keys.viewKey ?? existing.viewKey;
          existing.editKey = keys.editKey ?? existing.editKey;
        } else {
          localEntriesRef.current.set(documentId, {
            address: documentId,
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
        const history = next.get(documentId) ?? {
          address: documentId,
          versions: [],
          owner,
        };

        if (!history.owner) history.owner = owner;

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

        next.set(documentId, history);
        return next;
      });

      // If the event contains font tags (added when sharing), try to fetch
      // and persist those fonts locally so the editor can register them.
      (async () => {
        try {
          const fontTags = document.tags.filter((t) => t[0] === "font");
          for (const tag of fontTags) {
            // tag format: ["font", family, url, format]
            const family = tag[1];
            const url = tag[2];
            const format =
              (tag[3] as "woff2" | "woff" | "truetype" | "opentype") || "woff2";
            if (!url || !family) continue;
            try {
              // 1. Validate URL scheme
              let parsedUrl: URL;
              try {
                parsedUrl = new URL(url);
              } catch {
                throw new Error("Invalid URL format");
              }
              if (parsedUrl.protocol !== "https:") {
                throw new Error("Only HTTPS urls are allowed for fonts");
              }

              // 2. Extract expected hash from Blossom URL
              const expectedHash = parsedUrl.pathname.split("/").pop() || "";
              if (!/^[0-9a-f]{64}$/i.test(expectedHash)) {
                throw new Error("URL does not appear to be a valid Blossom URL (missing sha256 hash)");
              }

              const res = await fetch(url);
              if (!res.ok) throw new Error(`Failed to fetch font: ${res.status}`);

              // 3. Enforce file size limit (5MB)
              const contentLength = res.headers.get("content-length");
              if (contentLength && Number(contentLength) > 5 * 1024 * 1024) {
                throw new Error("Font file exceeds 5MB limit");
              }

              const blob = await res.blob();
              if (blob.size > 5 * 1024 * 1024) {
                throw new Error("Downloaded font file exceeds 5MB limit");
              }

              // 4. Verify cryptographic hash
              const buf = await blob.arrayBuffer();
              const actualHash = await sha256Hex(buf);
              if (actualHash !== expectedHash.toLowerCase()) {
                throw new Error(`Font hash verification failed (expected ${expectedHash}, got ${actualHash})`);
              }

              const mimeType = res.headers.get("content-type") || "font/woff2";
              await saveFontResource({
                family,
                blob,
                format,
                mimeType,
                addedAt: Date.now(),
                blossomUrl: url,
              });
              // register immediately so the UI shows the font without reload
              try {
                registerFontFaceFromBlob(family, blob, format);
              } catch (err) {
                console.warn("Failed to register shared font immediately:", err);
              }
            } catch (err) {
              console.warn("Could not persist shared font:", family, url, err);
            }
          }
        } catch {
          /* ignore */
        }
      })();
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
      options?: { publish?: boolean; awaitBroadcast?: boolean },
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

      const broadcast = async () => {
        try {
          await publishEvent(stored, relays);
          await markBroadcast(address);
        } catch (err) {
          console.warn("Imported page kept locally (broadcast failed):", err);
        }
      };
      if (options?.awaitBroadcast === false) {
        void broadcast();
      } else {
        await broadcast();
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

      // Group documents the user owns: also subscribe to every authorized author
      // so an editor's version lands in the owner's document live (previously
      // only the owner's own slot was subscribed). Restored each session from the
      // roster; open-mode docs subscribe by `#a`.
      type GroupSub = { root: string; owner: string; viewKey: string; d: string; room: string };
      const groupByRoom = new Map<string, GroupSub>();
      const groupFilters: {
        kinds: number[];
        authors?: string[];
        "#d"?: string[];
        "#a"?: string[];
      }[] = [];
      for (const entry of localEntries) {
        if (!entry.viewKey) continue;
        const parsed = parseRootAddress(entry.address);
        if (!parsed || parsed.owner !== pubkey) continue;
        const room = collabRoom(entry.viewKey);
        if (groupByRoom.has(room)) continue;
        let roster;
        try {
          roster = await fetchRoster(parsed.owner, parsed.d, entry.viewKey, relays);
        } catch {
          roster = null;
        }
        if (isCancelled) return;
        if (!roster) continue; // not a v2 group document
        groupByRoom.set(room, {
          root: entry.address,
          owner: parsed.owner,
          viewKey: entry.viewKey,
          d: parsed.d,
          room,
        });
        if (isOpenRoster(roster)) {
          groupFilters.push({ kinds: [KIND_FILE], "#a": [room] });
        } else {
          groupFilters.push({
            kinds: [KIND_FILE],
            authors: authorSet(parsed.owner, roster),
            "#d": [parsed.d],
          });
        }
      }

      liveSub = subscribe(
        [{ kinds: [KIND_FILE], authors: [pubkey] }, ...groupFilters],
        {
          onEvent: async (event: Event) => {
            if (isCancelled) return;
            const addr = getEventAddress(event);
            // v2 group versions carry ["a", room]; route them under the root so
            // every author lands in the owner's single document.
            const eventRoom = event.tags.find((t) => t[0] === "a")?.[1];
            const group = eventRoom ? groupByRoom.get(eventRoom) : undefined;
            const documentId = group?.root ?? addr;
            if (documentId) {
              setLocalOnlyAddresses((prev) => {
                if (!prev.has(documentId)) return prev;
                const next = new Set(prev);
                next.delete(documentId);
                return next;
              });
            }
            const localEntry = documentId
              ? localEntriesRef.current.get(documentId)
              : undefined;
            const viewKey = group?.viewKey ?? localEntry?.viewKey;
            const editKey = localEntry?.editKey;
            const owner = group?.owner ?? event.pubkey;

            await addDocument(
              event,
              { viewKey, editKey },
              group ? { documentId: group.root, owner } : undefined,
            );
            if (documentId) {
              saveLocalDocState({
                address: documentId,
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
