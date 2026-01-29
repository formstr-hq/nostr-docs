import { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import { fetchDocumentByNaddr } from "../nostr/fetchFile";
import { useRelays } from "../contexts/RelayContext";
import { nip19 } from "nostr-tools";
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
    // Decode keys from hash
    setLoading(true);
    setInvalid(false);
    setNotFound(false);
    const hash = location.hash.replace("#", "");
    const keys = hash ? decodeNKeys(hash) : {};
    setDecodedKeys(keys);

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

    const docExists = documents.get(address);

    // If document exists in context, use it
    if (docExists) {
      setSelectedDocumentId(address);
      setLoading(false);
    } else {
      // Fetch document from relays
      (async () => {
        try {
          // fetchDocumentByNaddr returns the latest event after subscription ends
          const latestEvent = await fetchDocumentByNaddr(
            relays,
            naddr,
            () => {}, // We use the return value instead of callback
          );

          if (!latestEvent) {
            console.error("Document not found on relays:", address);
            setNotFound(true);
            return;
          }

          const dTag = latestEvent.tags.find(
            (t: string[]) => t[0] === "d",
          )?.[1];
          if (!dTag) {
            setInvalid(true);
            return;
          }

          const eventAddress = `${latestEvent.kind}:${latestEvent.pubkey}:${dTag}`;

          // Await addDocument to ensure it completes before setting selected
          await addDocument(latestEvent, keys);
          setSelectedDocumentId(eventAddress);
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
  if (notFound) return <div>Document not found. It may have been deleted or not yet propagated to relays.</div>;

  return (
    <DocumentEditorController
      viewKey={decodedKeys.viewKey}
      editKey={decodedKeys.editKey}
    />
  );
}
