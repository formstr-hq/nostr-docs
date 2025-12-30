import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import DocEditor from "../components/DocEditor";
import { fetchDocumentByNaddr } from "../nostr/fetchFile";
import { useRelays } from "../contexts/RelayContext";
import { nip19, type Event } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/nip19";
import { decodeNKeys } from "../utils/nkeys";

export default function DocPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const { documents, setSelectedDocumentId, addDocument } =
    useDocumentContext();
  const { relays } = useRelays();
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const hash = window.location.hash.replace("#", "");
  const keys = hash ? decodeNKeys(hash) : {};

  useEffect(() => {
    if (!naddr) return;

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
      setSelectedDocumentId(identifier);
      setLoading(false);
    } else {
      console.log("Fetching...");
      (async () => {
        try {
          await fetchDocumentByNaddr(relays, naddr, (event: Event) => {
            console.log("Keys are", keys);
            addDocument(event, keys);
            setSelectedDocumentId(identifier);
          });
        } catch (err) {
          console.error("Failed to fetch document:", err);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [naddr, documents, relays]);

  if (loading) return <div>Loading document...</div>;
  if (invalid) return <div>Invalid document URL</div>;

  return <DocEditor viewKey={keys.viewKey} editKey={keys.editKey} />;
}
