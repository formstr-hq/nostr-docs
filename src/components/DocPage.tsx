import { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import DocEditor from "../components/DocEditor";
import { fetchDocumentByNaddr } from "../nostr/fetchFile";
import { useRelays } from "../contexts/RelayContext";
import { nip19, type Event } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/nip19";
import { decodeNKeys } from "../utils/nkeys";

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
    if (!naddr) return;

    // Decode keys from hash
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

    const docExists = !!documents.get(identifier);

    if (docExists && Object.keys(keys).length !== 0) {
      // Document already exists in context, just select it
      setSelectedDocumentId(identifier);
      setLoading(false);
    } else {
      // Fetch document from relays
      console.log("Fetching document from relays...");
      (async () => {
        try {
          await fetchDocumentByNaddr(relays, naddr, (event: Event) => {
            addDocument(event, keys);
            setSelectedDocumentId(identifier);
          });
        } catch (err) {
          console.error("Failed to fetch document:", err);
          setInvalid(true);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [naddr, relays, location.hash, documents]);

  if (loading) return <div>Loading document...</div>;
  if (invalid) return <div>Invalid document URL</div>;

  return (
    <DocEditor viewKey={decodedKeys.viewKey} editKey={decodedKeys.editKey} />
  );
}
