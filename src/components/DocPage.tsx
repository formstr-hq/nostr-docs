import { useEffect, useState } from "react";
import { Box, Button } from "@mui/material";
import { useParams, useLocation } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import { fetchDocumentByNaddr } from "../nostr/fetchFile";
import { useRelays } from "../contexts/RelayContext";
import { nip19 } from "nostr-tools";
import { decodeNKeys } from "../utils/nkeys";
import { DocumentEditorController } from "./editor/DocEditorController";
import { storeLocalEvent } from "../lib/localStore";

export default function DocPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const location = useLocation();
  const { documents, setSelectedDocumentId, addDocument } =
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

    // Document already in context — no loading flash, editor stays mounted
    if (docExists) {
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
      try {
        const latestEvent = await fetchDocumentByNaddr(
          relays,
          naddr,
          () => {},
        );

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
    };
  }, [naddr, relays, location.hash]);

  if (loading) return <div>Loading document...</div>;
  if (invalid) return <div>Invalid document URL</div>;
  if (notFound) return <div>Document not found. It may have been deleted or not yet propagated to relays.</div>;

  let pollEventId: string | null = null;
  let computedAddress: string | null = null;
  if (naddr) {
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type === "naddr" && decoded.data) {
        computedAddress = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
      }
    } catch (e) {}
  }

  if (computedAddress) {
    const activeDoc = documents.get(computedAddress);
    const content = activeDoc?.versions[0]?.decryptedContent || "";
    const match = content.match(/(?:nostr:)?(nevent1[0-9a-z]+|note1[0-9a-z]+)/);
    if (match) {
      pollEventId = match[1];
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {pollEventId && (
        <Box sx={{ pb: 1, display: "flex", justifyContent: "center" }}>
          <Button
            variant="outlined"
            color="secondary"
            onClick={() => {
              window.location.href = `https://pollerama.fun/respond/${pollEventId}`;
            }}
          >
            Vote in Pollerama
          </Button>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DocumentEditorController
          viewKey={decodedKeys.viewKey}
          editKey={decodedKeys.editKey}
        />
      </Box>
    </Box>
  );
}
