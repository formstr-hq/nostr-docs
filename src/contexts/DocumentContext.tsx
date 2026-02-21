import { getPublicKey, nip44, type Event } from "nostr-tools";
import React, { createContext, useContext, useMemo, useState } from "react";
import { signerManager } from "../signer";
import { getConversationKey } from "nostr-tools/nip44";
import { hexToBytes } from "nostr-tools/utils";
import { useUser, type UserProfile } from "./UserContext";
import { getEventAddress } from "../utils/helpers";

type DocumentVersion = {
  event: Event;
  decryptedContent: string;
};

type DocumentHistory = {
  versions: DocumentVersion[]; // sorted oldest → newest
};

interface DocumentContextValue {
  documents: Map<string, DocumentHistory>;
  selectedDocumentId: string | null;

  setSelectedDocumentId: (id: string | null) => void;
  addDocument: (
    document: Event,
    keys?: { viewKey?: string; editKey?: string },
  ) => Promise<void>;

  removeDocument: (id: string) => void;
  addDeletionRequest: (delEvent: Event) => void;

  deletedEventIds: Set<string>;

  visibleDocuments: Map<string, DocumentHistory>;
}

const DocumentContext = createContext<DocumentContextValue | undefined>(
  undefined,
);

const getDecryptedContent = async (
  event: Event,
  viewKey?: string,
  user?: UserProfile | null,
  loginCallback?: () => Promise<void>,
): Promise<string | null> => {
  try {
    if (viewKey) {
      const conversationKey = getConversationKey(
        hexToBytes(viewKey),
        getPublicKey(hexToBytes(viewKey)),
      );
      const decryptedContent = nip44.decrypt(event.content, conversationKey);
      return Promise.resolve(decryptedContent);
    }

    // If no user, trigger login and then decrypt using the freshly-acquired signer
    if (!user) {
      await loginCallback?.();
    }

    // After login (or if user was already set), get signer and decrypt
    const signer = await signerManager.getSigner();
    const pubkey = await signer.getPublicKey();
    if (event.pubkey !== pubkey) return null;
    return await signer.nip44Decrypt!(pubkey, event.content);
  } catch (err) {
    console.error("Failed to decrypt content:", err);
    return null;
  }
};

export const DocumentProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loginModal } = useUser();
  const [documents, setDocuments] = useState<Map<string, DocumentHistory>>(
    new Map(),
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(
    new Set(),
  );

  const addDeletionRequest = (delEvent: Event) => {
    const eTags = delEvent.tags.filter((t) => t[0] === "e").map((t) => t[1]);

    const aTags = delEvent.tags.filter((t) => t[0] === "a").map((t) => t[1]);

    setDeletedEventIds((prev) => new Set([...prev, ...eTags, ...aTags]));
  };

  const removeDocument = (id: string) => {
    setDocuments((prev) => {
      const newDocuments = new Map(prev);
      newDocuments.delete(id);
      return newDocuments;
    });

    setSelectedDocumentId((current) => (current === id ? null : current));
  };

  const visibleDocuments = useMemo(() => {
    return new Map(
      [...documents.entries()]
        .filter(([address]) => !deletedEventIds.has(address))
        .map(([address, history]): [string, DocumentHistory] => [
          address,
          {
            versions: history.versions.filter(
              (v) => !deletedEventIds.has(v.event.id),
            ),
          },
        ])
        .filter(([, h]) => h.versions.length > 0),
    );
  }, [documents, deletedEventIds]);

  const addDocument = async (
    document: Event,
    keys?: Record<string, string>,
  ) => {
    const address = getEventAddress(document);
    if (!address) return;
    const decryptedContent = await getDecryptedContent(
      document,
      keys?.viewKey,
      user,
      loginModal,
    );
    if (!decryptedContent) return;

    setDocuments((prev) => {
      const next = new Map(prev);
      const history = next.get(address) ?? {
        address,
        versions: [],
      };
      if (history.versions.some((v) => v.event.id === document.id)) {
        return prev;
      }

      history.versions = [
        ...history.versions,
        {
          event: document,
          decryptedContent,
        },
      ].sort((a, b) => a.event.created_at - b.event.created_at);

      next.set(address, history);
      return next;
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
      "useDocumentContext must be used within a DocumentProvider",
    );
  }
  return context;
};
