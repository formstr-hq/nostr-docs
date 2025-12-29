import type { Event } from "nostr-tools";
import React, { createContext, useContext, useState } from "react";
import { signerManager } from "../signer";

interface DocumentContextValue {
  documents: Map<string, { event: Event; decryptedContent: string }>;
  selectedDocumentId: string | null;
  setSelectedDocumentId: (id: string | null) => void;
  addDocument: (document: Event) => void;
}

const DocumentContext = createContext<DocumentContextValue | undefined>(
  undefined
);

const getDecryptedContent = async (event: Event): Promise<string> => {
  try {
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

  const addDocument = async (document: Event) => {
    const dTag = document.tags.find((t: string[]) => t[0] === "d")?.[1];
    if (!dTag) return;
    const existing = documents.get(dTag)?.event;
    if (existing && existing.created_at > document.created_at) return;
    const decryptedContent = await getDecryptedContent(document);
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
