import { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import { fetchDocumentByNaddr } from "../nostr/fetchFile";
import { useRelays } from "../contexts/RelayContext";
import { nip19, type Event } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/nip19";
import { decodeNKeys } from "../utils/nkeys";
import { DocumentEditorController } from "./editor/DocEditorController";

export default function DocPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const location = useLocation();
  const { documents, setSelectedDocumentId, addDocument } =
    useDocumentContext();
  const { relays } = useRelays();

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [decodedKeys, setDecodedKeys] = useState<{
    viewKey?: string;
    editKey?: string;
  }>({});

  useEffect(() => {
    console.log("NADDR Changed", naddr, loading);
    if (!naddr) {
      setLoading(false);
      return;
    }
    // Decode keys from hash
    setLoading(true);
    setInvalid(false);
    const hash = location.hash.replace("#", "");
    const keys = hash ? decodeNKeys(hash) : {};
    setDecodedKeys(keys);

    let identifier: string;
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== "naddr") throw new Error("Not an naddr");
      identifier = (decoded.data as AddressPointer).identifier;
    } catch (err) {
      console.error("Invalid naddr:", naddr, err);
      setInvalid(true);
      setLoading(false);
      return;
    }

    const docExists = documents.get(identifier);

    if (docExists && Object.keys(keys).length !== 0) {
      // Document already exists in context, just select it
      console.log("Doc exisits with keys", docExists, keys, identifier);
      setSelectedDocumentId(identifier);
      setLoading(false);
    } else {
      console.log("Doc does not exisits or keys does not exists", keys);
      // Fetch document from relays
      (async () => {
        try {
          await fetchDocumentByNaddr(relays, naddr, (event: Event) => {
            const dTag = event.tags.find((t) => t[0] === "d")?.[1];
            if (!dTag) return;
            console.log("Found  document", event);
            addDocument(event, keys);
            setSelectedDocumentId(dTag);
            setLoading(false);
          });
        } catch (err) {
          console.error("Failed to fetch document:", err);
          setInvalid(true);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [naddr, relays, location.hash]);

  if (loading) return <div>Loading document...</div>;
  if (invalid) return <div>Invalid document URL</div>;

  return (
    <DocumentEditorController
      viewKey={decodedKeys.viewKey}
      editKey={decodedKeys.editKey}
    />
  );
}
