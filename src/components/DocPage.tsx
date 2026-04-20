import { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import { fetchDocumentByNaddr } from "../nostr/fetchFile";
import { hasDeleteRequestForAddress } from "../nostr/fetchDelete";
import { useRelays } from "../contexts/RelayContext";
import { nip19 } from "nostr-tools";
import { decodeNKeys } from "../utils/nkeys";
import { DocumentEditorController } from "./editor/DocEditorController";
import { removeLocalEvent, storeLocalEvent } from "../lib/localStore";
import { pool } from "../nostr/relayPool";
import { KIND_FILE } from "../nostr/kinds";

export default function DocPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const location = useLocation();
  const { documents, setSelectedDocumentId, addDocument, removeDocument } =
    useDocumentContext();
  const { relays } = useRelays();

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
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== "naddr") throw new Error("Not an naddr");
      address = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
    } catch (err) {
      console.error("Invalid naddr:", naddr, err);
      setInvalid(true);
      setLoading(false);
      return;
    }

    const hash = location.hash.replace("#", "");
    const keys = hash ? decodeNKeys(hash) : {};
    setDecodedKeys(keys);

    const docExists = documents.get(address);

    // Live guard: if this address gets deleted while the page is open,
    // revoke access immediately without requiring a refresh.
    const deleteSub = pool.subscribeMany(
      relays,
      {
        kinds: [5],
        "#k": [`${KIND_FILE}`],
        "#a": [address],
      },
      {
        onevent: () => {
          removeDocument(address);
          setSelectedDocumentId(null);
          removeLocalEvent(address).catch(() => {});
          setNotFound(true);
          setLoading(false);
        },
      },
    );

    // Not cached: fetch from relays (shows loading state)
    setLoading(true);
    setInvalid(false);
    setNotFound(false);

    let cancelled = false;
    (async () => {
      try {
        // Block access for revoked/deleted addresses even if the document
        // is already cached in memory.
        const deletedAddress = await hasDeleteRequestForAddress(relays, address);
        if (deletedAddress) {
          removeDocument(address);
          removeLocalEvent(address).catch(() => {});
          setNotFound(true);
          return;
        }

        // Document already in context — no fetch needed
        if (docExists) {
          setSelectedDocumentId(address);
          return;
        }

        const latestEvent = await fetchDocumentByNaddr(relays, naddr, () => {});

        if (cancelled) return;

        if (!latestEvent) {
          console.error("Document not found on relays:", address);
          setNotFound(true);
          return;
        }

        const dTag = latestEvent.tags.find(
          (t: string[]) => t[0] === "d",
        )?.[1];
        if (!dTag) {
          if (!cancelled) setInvalid(true);
          return;
        }

        const eventAddress = `${latestEvent.kind}:${latestEvent.pubkey}:${dTag}`;

        const deleted = await hasDeleteRequestForAddress(relays, eventAddress);
        if (deleted) {
          removeLocalEvent(eventAddress).catch(() => {});
          setNotFound(true);
          return;
        }

        await addDocument(latestEvent, keys);
        if (cancelled) return;

        // Cache in IndexedDB so this device has it available offline
        // and so the two-device sync works in both directions.
        storeLocalEvent({
          address: eventAddress,
          event: latestEvent,
          viewKey: keys.viewKey,
          editKey: keys.editKey,
          pendingBroadcast: false,
          savedAt: Date.now(),
        }).catch(() => {});

        setSelectedDocumentId(eventAddress);
      } catch (err) {
        console.error("Failed to fetch document:", err);
        if (!cancelled) setInvalid(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      deleteSub.close();
    };
  }, [naddr, relays, location.hash]);

  if (loading) return <div>Loading document...</div>;
  if (invalid) return <div>Invalid document URL</div>;
  if (notFound) return <div>Document not found. It may have been deleted or not yet propagated to relays.</div>;

  return (
    <DocumentEditorController
      viewKey={decodedKeys.viewKey}
      editKey={decodedKeys.editKey}
    />
  );
}
