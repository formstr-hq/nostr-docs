import type { Event } from "nostr-tools";
import React, { createContext, useContext, useState } from "react";

interface DocumentContextValue {
  documents: Event[];
  selectedDocumentId: string | null;
  setSelectedDocumentId: (id: string | null) => void;
  addDocument: (document: Event) => void;
  updateDocument: (id: string, content: string) => void;
}

const DocumentContext = createContext<DocumentContextValue | undefined>(
  undefined
);

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [documents, setDocuments] = useState<Event[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );

  const addDocument = (document: Event) => {
    setDocuments([...documents, document]);
  };

  const updateDocument = (id: string, content: string) => {
    setDocuments(
      documents.map((doc) => (doc.id === id ? { ...doc, content } : doc))
    );
  };

  return (
    <DocumentContext.Provider
      value={{
        documents,
        selectedDocumentId,
        setSelectedDocumentId,
        addDocument,
        updateDocument,
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
