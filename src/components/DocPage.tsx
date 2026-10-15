import { useEffect, useState } from "react";
import { useParams, useLocation, useOutletContext } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import { fetchDocumentByNaddr } from "../nostr/fetchFile";
import { useRelays } from "../contexts/RelayContext";
import { nip19, type Event } from "nostr-tools";
import { decodeNKeys } from "../utils/nkeys";
import { useTextSuggest, type TextSuggestHook } from "../hooks/useTextSuggest";
import { DocumentEditorController } from "./editor/DocEditorController";
import { saveLocalDocState } from "../lib/localStore";
import { cacheLocalEvents } from "../dataLayer";
import { resolveSharedDocument } from "../nostr/sharedDoc";
import { useUser } from "../contexts/UserContext";

import { useSharedPages } from "../contexts/SharedDocsContext";

export default function DocPage({
  textSuggest: textSuggestOverride,
}: {
  textSuggest?: TextSuggestHook;
}) {
  const { naddr } = useParams<{ naddr: string }>();
  const location = useLocation();
  const outletCtx = useOutletContext<{ textSuggest?: TextSuggestHook } | null>();
  const fallbackTextSuggest = useTextSuggest();
  const textSuggest = textSuggestOverride ?? outletCtx?.textSuggest ?? fallbackTextSuggest;
  const {
    documents,
    setSelectedDocumentId,
    addDocument,
    getDocumentKeys,
    unmarkVisited,
  } = useDocumentContext();
  const { relays } = useRelays();
  const { user } = useUser();
  const { getKeys, sharedDocuments } = useSharedPages();

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [decodedKeys, setDecodedKeys] = useState<{
    viewKey?: string;
    editKey?: string;
  }>({});

  useEffect(() => {
    if (!naddr) {
      setLoading(false);
      return;
    }

    // Decode address first so we can check the cache before touching loading state
    let address: string;
    let owner: string;
    let dTag: string;
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== "naddr") throw new Error("Not an naddr");
      owner = decoded.data.pubkey;
      dTag = decoded.data.identifier;
      address = `${decoded.data.kind}:${owner}:${dTag}`;
    } catch (err) {
      console.error("Invalid naddr:", naddr, err);
      setInvalid(true);
      setLoading(false);
      return;
    }

    const hash = location.hash.replace("#", "");
    let keys = hash ? decodeNKeys(hash) : {};
    if (!keys.viewKey) {
      const stored = getDocumentKeys(address);
      if (stored?.viewKey) {
        keys = { ...stored, ...keys };
      }
    }
    setDecodedKeys(keys);

    const docExists = documents.get(address);

    // Document already in context — no loading flash, editor stays mounted
    if (docExists) {
      const docOwner = docExists.owner ?? docExists.versions[0]?.event.pubkey;
      const isVisited = !!keys.viewKey && docOwner !== user?.pubkey;
      if (isVisited) {
        const latestVersion = docExists.versions.at(-1);
        if (latestVersion) {
          cacheLocalEvents([latestVersion.event]);
          saveLocalDocState({
            address,
            viewKey: keys.viewKey,
            editKey: keys.editKey,
            visited: true,
            pendingBroadcast: false,
            savedAt: Date.now(),
            lastEventCreatedAt: latestVersion.event.created_at,
          }).catch(() => {});
        }
      }
      setSelectedDocumentId(address);
      setLoading(false);
      return;
    }

    // Not cached: fetch from relays (shows loading state)
    setLoading(true);
    setInvalid(false);
    setNotFound(false);

    let cancelled = false;
    (async () => {
      // Shared single-author fallback: cache the event, record keys/flags locally
      // and select it. Used for legacy edit-key/view-only shares and for a v2
      // doc before it has a roster.
      const applySingleEvent = async (
        event: Event,
        eventAddress: string,
        eventOwner?: string,
      ) => {
        await addDocument(event, keys);
        if (cancelled) return;

        // A page opened via someone else's shared link is a "visited" page
        // unless it has already been saved to the user's Shared list.
        const eventPubkey = eventOwner ?? event.pubkey;
        const isAlreadyShared =
          getKeys(eventAddress).length > 0 || sharedDocuments.has(eventAddress);
        const isVisited = !isAlreadyShared && !!keys.viewKey && eventPubkey !== user?.pubkey;

        // Cache the event in the local relay (its owner) and remember only the
        // keys/flags locally, so visited pages survive a reload (they
        // repopulate the Visited tab from here — no signer/metadata write, and
        // therefore no prompt just for opening a link). Promotion to the Shared
        // tab is an explicit "Save to Shared" action in the editor.
        cacheLocalEvents([event]);
        saveLocalDocState({
          address: eventAddress,
          viewKey: keys.viewKey,
          editKey: keys.editKey,
          visited: isVisited || undefined,
          pendingBroadcast: false,
          savedAt: Date.now(),
          lastEventCreatedAt: event.created_at,
        }).catch(() => {});

        setSelectedDocumentId(eventAddress);
        if (isAlreadyShared) {
          unmarkVisited(eventAddress);
        }
      };

      try {
        // v2: when we hold a viewKey, resolve the document as a group — fetch the
        // owner's roster, then every authorized author's newest version. With no
        // roster this degrades to the legacy single-author path.
        if (keys.viewKey) {
          const resolved = await resolveSharedDocument(owner, dTag, keys.viewKey, relays);
          if (cancelled) return;

          if (resolved.roster) {
            for (const ev of resolved.events) {
              await addDocument(ev, keys, { documentId: address, owner });
              if (cancelled) return;
            }

            const isAlreadyShared = getKeys(address).length > 0 || sharedDocuments.has(address);
            const isVisited = !isAlreadyShared && owner !== user?.pubkey;

            cacheLocalEvents(resolved.events);
            saveLocalDocState({
              address,
              viewKey: keys.viewKey,
              editKey: keys.editKey,
              visited: isVisited || undefined,
              pendingBroadcast: false,
              savedAt: Date.now(),
              lastEventCreatedAt: resolved.tip?.created_at,
            }).catch(() => {});

            setSelectedDocumentId(address);
            if (isAlreadyShared) unmarkVisited(address);
            return;
          }

          if (resolved.tip) {
            await applySingleEvent(resolved.tip, address, owner);
            return;
          }

          console.error("Document not found on relays:", address);
          if (!cancelled) setNotFound(true);
          return;
        }

        const latestEvent = await fetchDocumentByNaddr(relays, naddr, () => {});
        if (cancelled) return;

        if (!latestEvent) {
          console.error("Document not found on relays:", address);
          setNotFound(true);
          return;
        }

        if (!dTag) {
          if (!cancelled) setInvalid(true);
          return;
        }

        const eventAddress = `${latestEvent.kind}:${latestEvent.pubkey}:${dTag}`;
        await applySingleEvent(latestEvent, eventAddress);
      } catch (err) {
        console.error("Failed to fetch document:", err);
        if (!cancelled) setInvalid(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [naddr, relays, location.hash]);

  if (loading) return <div>Loading document...</div>;
  if (invalid) return <div>Invalid document URL</div>;
  if (notFound) return <div>Document not found. It may have been deleted or not yet propagated to relays.</div>;

  return (
    <DocumentEditorController
      viewKey={decodedKeys.viewKey}
      editKey={decodedKeys.editKey}
      textSuggest={textSuggest}
    />
  );
}
