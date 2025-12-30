import { getPublicKey, nip44, type Event } from "nostr-tools";
import React, { createContext, useContext, useState } from "react";
import { signerManager } from "../signer";
import { getConversationKey } from "nostr-tools/nip44";
import { hexToBytes } from "nostr-tools/utils";

interface DocumentContextValue {
  documents: Map<string, { event: Event; decryptedContent: string }>;
  selectedDocumentId: string | null;
  setSelectedDocumentId: (id: string | null) => void;
  addDocument: (document: Event, keys?: Record<string, string>) => void;
  removeDocument: (id: string) => void;
  addDeletionRequest: (delEvent: Event) => void;
  deletedEventIds: Set<string>;
  visibleDocuments: Map<string, { event: Event; decryptedContent: string }>;
}

const DocumentContext = createContext<DocumentContextValue | undefined>(
  undefined
);

const getDecryptedContent = async (
  event: Event,
  viewKey?: string
): Promise<string> => {
  try {
    if (viewKey) {
      const conversationKey = getConversationKey(
        hexToBytes(viewKey),
        getPublicKey(hexToBytes(viewKey))
      );
      const decryptedContent = nip44.decrypt(event.content, conversationKey);
      return Promise.resolve(decryptedContent);
    }
    const signer = await signerManager.getSigner();
    return (
      (await signer.nip44Decrypt!(
        await signer.getPublicKey(),
        event.content
      )) ?? ""
    );
  } catch (err) {
    console.error("Failed to decrypt content:", err);
    return "";
  }
};

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [documents, setDocuments] = useState<
    Map<string, { event: Event; decryptedContent: string }>
  >(new Map());
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(
    new Set()
  );

  const addDeletionRequest = (delEvent: Event) => {
    const eTags = delEvent.tags.filter((t) => t[0] === "e").map((t) => t[1]);
    const aTags = delEvent.tags
      .filter((t) => t[0] === "a")
      .map((t) => t[1].split(":")[2]); // extract d-tag from a-tag

    setDeletedEventIds((prev) => new Set([...prev, ...eTags, ...aTags]));

    setDocuments((prev) => {
      const newDocs = new Map(prev);
      [...eTags, ...aTags].forEach((id) => newDocs.delete(id));
      // reset selection if needed
      if (
        selectedDocumentId &&
        [...eTags, ...aTags].includes(selectedDocumentId)
      ) {
        setSelectedDocumentId(null);
      }
      return newDocs;
    });
  };

  const removeDocument = (id: string) => {
    setDocuments((prev) => {
      const newDocuments = new Map(prev);
      newDocuments.delete(id);
      return newDocuments;
    });

    setSelectedDocumentId((current) => (current === id ? null : current));
  };

  const visibleDocuments = React.useMemo(() => {
    return new Map(
      [...documents.entries()].filter(([id]) => !deletedEventIds.has(id))
    );
  }, [documents, deletedEventIds]);

  const addDocument = async (
    document: Event,
    keys?: Record<string, string>
  ) => {
    const dTag = document.tags.find((t: string[]) => t[0] === "d")?.[1];
    if (!dTag) return;
    const existing = documents.get(dTag)?.event;
    if (existing && existing.created_at > document.created_at) return;
    const decryptedContent = await getDecryptedContent(document, keys?.viewKey);
    setDocuments((prev) => {
      const newDocuments = new Map(prev);
      newDocuments.set(dTag, { event: document, decryptedContent }); // Store decrypted content });
      return newDocuments;
    });
  };

  return (
    <DocumentContext.Provider
      value={{
        documents,
        selectedDocumentId,
        setSelectedDocumentId,
        addDocument,
        removeDocument,
        deletedEventIds,
        addDeletionRequest,
        visibleDocuments,
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
      "useDocumentContext must be used within a DocumentProvider"
    );
  }
  return context;
};
