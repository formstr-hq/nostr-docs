import { getPublicKey, nip44, type Event } from "nostr-tools";
import React, { createContext, useContext, useMemo, useState } from "react";
import { signerManager } from "../signer";
import { saveFontResource } from "../lib/fontStore";
import { registerFontFaceFromBlob } from "../lib/fontRegister";
import { getConversationKey } from "nostr-tools/nip44";
import { hexToBytes } from "nostr-tools/utils";
import { useUser, type UserProfile } from "./UserContext";
import { getEventAddress } from "../utils/helpers";
import { sha256Hex } from "../utils/fileEncryption";

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
  /** Addresses navigated to in the current browser session. */
  sessionVisited: Set<string>;
  addDocument: (
    document: Event,
    keys?: { viewKey?: string; editKey?: string },
  ) => Promise<void>;

  removeDocument: (id: string) => void;
  addDeletionRequest: (delEvent: Event) => void;
  clearDeletionRecord: (address: string) => void;

  deletedEventIds: Set<string>;

  /** Docs authored by the current user (not deleted). */
  visibleDocuments: Map<string, DocumentHistory>;
  /** Docs opened by the user but authored by someone else (not deleted). */
  visitedDocuments: Map<string, DocumentHistory>;

  /** Addresses of documents the user has explicitly set to device-only. */
  localOnlyAddresses: Set<string>;
  /** Update the in-memory device-only flag for a document address. */
  markLocalOnly: (address: string, localOnly: boolean) => void;
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
  const [_selectedDocumentId, _setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [sessionVisited, setSessionVisited] = useState<Set<string>>(new Set());
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(
    new Set(),
  );
  const [localOnlyAddresses, setLocalOnlyAddresses] = useState<Set<string>>(
    new Set(),
  );

  const selectedDocumentId = _selectedDocumentId;
  const setSelectedDocumentId = (id: string | null) => {
    _setSelectedDocumentId(id);
    if (id) {
      setSessionVisited((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  };

  const markLocalOnly = (address: string, localOnly: boolean) => {
    setLocalOnlyAddresses((prev) => {
      const next = new Set(prev);
      if (localOnly) next.add(address);
      else next.delete(address);
      return next;
    });
  };
  const addDeletionRequest = (delEvent: Event) => {
    const eTags = delEvent.tags.filter((t) => t[0] === "e").map((t) => t[1]);
    const aTags = delEvent.tags.filter((t) => t[0] === "a").map((t) => t[1]);
    setDeletedEventIds((prev) => new Set([...prev, ...eTags, ...aTags]));
  };

  // Removes a specific address from deletedEventIds so a restored document
  // becomes visible again in the current session.
  const clearDeletionRecord = (address: string) => {
    setDeletedEventIds((prev) => {
      const next = new Set(prev);
      next.delete(address);
      return next;
    });
  };

  const removeDocument = (id: string) => {
    setDocuments((prev) => {
      const newDocuments = new Map(prev);
      newDocuments.delete(id);
      return newDocuments;
    });

    _setSelectedDocumentId((current) => (current === id ? null : current));
  };

  const visibleDocuments = useMemo(() => {
    return new Map(
      [...documents.entries()]
        .filter(([address, history]) => {
          if (deletedEventIds.has(address)) return false;
          const pubkey = history.versions[0]?.event.pubkey;
          return pubkey === user?.pubkey;
        })
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
  }, [documents, deletedEventIds, user?.pubkey]);

  const visitedDocuments = useMemo(() => {
    return new Map(
      [...documents.entries()]
        .filter(([address, history]) => {
          if (!sessionVisited.has(address)) return false;
          if (deletedEventIds.has(address)) return false;
          const pubkey = history.versions[0]?.event.pubkey;
          return pubkey !== user?.pubkey;
        })
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
  }, [documents, deletedEventIds, user?.pubkey, sessionVisited]);

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

      const alreadyPresent = history.versions.some(
        (v) => v.event.id === document.id,
      );
      if (alreadyPresent) {
        // If we now have a viewKey we didn't have before, re-decrypt to correct
        // content that may have been stored via a failed signer attempt.
        if (!keys?.viewKey) return prev;
        history.versions = history.versions.filter(
          (v) => v.event.id !== document.id,
        );
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

    // If the event contains font tags (added when sharing), try to fetch
    // and persist those fonts locally so the editor can register them.
    (async () => {
      try {
        const fontTags = document.tags.filter((t) => t[0] === "font");
        for (const tag of fontTags) {
          // tag format: ["font", family, url, format]
          const family = tag[1];
          const url = tag[2];
          const format = (tag[3] as any) || "woff2";
          if (!url || !family) continue;
          try {
            // 1. Validate URL scheme
            let parsedUrl: URL;
            try {
              parsedUrl = new URL(url);
            } catch (err) {
              throw new Error("Invalid URL format");
            }
            if (parsedUrl.protocol !== "https:") {
              throw new Error("Only HTTPS urls are allowed for fonts");
            }

            // 2. Extract expected hash from Blossom URL
            const expectedHash = parsedUrl.pathname.split("/").pop() || "";
            if (!/^[0-9a-f]{64}$/i.test(expectedHash)) {
              throw new Error("URL does not appear to be a valid Blossom URL (missing sha256 hash)");
            }

            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch font: ${res.status}`);

            // 3. Enforce file size limit (5MB)
            const contentLength = res.headers.get("content-length");
            if (contentLength && Number(contentLength) > 5 * 1024 * 1024) {
              throw new Error("Font file exceeds 5MB limit");
            }

            const blob = await res.blob();
            if (blob.size > 5 * 1024 * 1024) {
              throw new Error("Downloaded font file exceeds 5MB limit");
            }

            // 4. Verify cryptographic hash
            const buf = await blob.arrayBuffer();
            const actualHash = await sha256Hex(buf);
            if (actualHash !== expectedHash.toLowerCase()) {
              throw new Error(`Font hash verification failed (expected ${expectedHash}, got ${actualHash})`);
            }

            // We must re-create the blob because arrayBuffer() might drain it depending on browser, or we just use the buffer.
            // Actually `blob.arrayBuffer()` doesn't consume the blob, so it's safe to reuse it.
            const mimeType = res.headers.get("content-type") || "font/woff2";
            await saveFontResource({
              family,
              blob,
              format: format as any,
              mimeType,
              addedAt: Date.now(),
              blossomUrl: url,
            });
              // register immediately so the UI shows the font without reload
              try {
                registerFontFaceFromBlob(family, blob, format as any);
              } catch (err) {
                console.warn("Failed to register shared font immediately:", err);
              }
          } catch (err) {
            console.warn("Could not persist shared font:", family, url, err);
          }
        }
      } catch (err) {
        /* ignore */
      }
    })();
  };

  return (
    <DocumentContext.Provider
      value={{
        documents,
        selectedDocumentId,
        setSelectedDocumentId,
        sessionVisited,
        addDocument,
        removeDocument,
        deletedEventIds,
        addDeletionRequest,
        clearDeletionRecord,
        visibleDocuments,
        visitedDocuments,
        localOnlyAddresses,
        markLocalOnly,
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
