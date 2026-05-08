import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from "react";
import { useUser } from "./UserContext";
import { useRelays } from "./RelayContext";
import { signerManager } from "../signer";
import { fetchAllDocMetadata, saveDocMetadata, type DocMetadata } from "../nostr/docMetadata";

interface DocMetadataContextValue {
  docTags: Map<string, string[]>;
  docTitles: Map<string, string>;
  docSharedAs: Map<string, string>;
  allTags: string[];
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  setDocTags: (address: string, tags: string[]) => Promise<void>;
  setDocTitle: (address: string, title: string) => Promise<void>;
  setDocSharedAs: (address: string, sharedAs: string) => Promise<void>;
  loading: boolean;
}

const DocMetadataContext = createContext<DocMetadataContextValue | undefined>(
  undefined,
);

export const DocMetadataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useUser();
  const { relays } = useRelays();
  // Full metadata kept internally so per-field setters preserve viewKey/editKey/etc.
  const [metadataMap, setMetadataMap] = useState<Map<string, DocMetadata>>(new Map());
  const [docTagsState, setDocTagsState] = useState<Map<string, string[]>>(new Map());
  const [docTitles, setDocTitlesState] = useState<Map<string, string>>(new Map());
  const [docSharedAs, setDocSharedAsState] = useState<Map<string, string>>(new Map());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setMetadataMap(new Map());
      setDocTagsState(new Map());
      setDocTitlesState(new Map());
      setDocSharedAsState(new Map());
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const signer = await signerManager.getSigner();
        if (!signer) return;
        const pubkey = await signer.getPublicKey();
        const metadata = await fetchAllDocMetadata(relays, pubkey);
        setMetadataMap(metadata);
        const tagsMap = new Map<string, string[]>();
        const titlesMap = new Map<string, string>();
        const sharedAsMap = new Map<string, string>();
        for (const [address, meta] of metadata) {
          if (meta.tags.length > 0) tagsMap.set(address, meta.tags);
          if (meta.title) titlesMap.set(address, meta.title);
          if (meta.sharedAs) sharedAsMap.set(address, meta.sharedAs);
        }
        setDocTagsState(tagsMap);
        setDocTitlesState(titlesMap);
        setDocSharedAsState(sharedAsMap);
      } catch (err) {
        console.error("Failed to fetch doc metadata:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, relays]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const tags of docTagsState.values()) {
      for (const tag of tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [docTagsState]);

  const setDocTags = async (address: string, tags: string[]) => {
    const existing = metadataMap.get(address) ?? { tags: [] };
    const newMeta: DocMetadata = { ...existing, tags };
    await saveDocMetadata(address, newMeta, relays);
    setMetadataMap((prev) => {
      const next = new Map(prev);
      next.set(address, newMeta);
      return next;
    });
    setDocTagsState((prev) => {
      const next = new Map(prev);
      if (tags.length === 0) next.delete(address);
      else next.set(address, tags);
      return next;
    });
  };

  const setDocTitle = async (address: string, title: string) => {
    const existing = metadataMap.get(address) ?? { tags: [] };
    const newMeta: DocMetadata = { ...existing, title: title || undefined };
    await saveDocMetadata(address, newMeta, relays);
    setMetadataMap((prev) => {
      const next = new Map(prev);
      next.set(address, newMeta);
      return next;
    });
    setDocTitlesState((prev) => {
      const next = new Map(prev);
      if (!title) next.delete(address);
      else next.set(address, title);
      return next;
    });
  };

  const setDocSharedAs = async (address: string, sharedAs: string) => {
    const existing = metadataMap.get(address) ?? { tags: [] };
    const newMeta: DocMetadata = { ...existing, sharedAs };
    await saveDocMetadata(address, newMeta, relays);
    setMetadataMap((prev) => {
      const next = new Map(prev);
      next.set(address, newMeta);
      return next;
    });
    setDocSharedAsState((prev) => {
      const next = new Map(prev);
      next.set(address, sharedAs);
      return next;
    });
  };

  return (
    <DocMetadataContext.Provider
      value={{
        docTags: docTagsState,
        docTitles,
        docSharedAs,
        allTags,
        selectedTag,
        setSelectedTag,
        setDocTags,
        setDocTitle,
        setDocSharedAs,
        loading,
      }}
    >
      {children}
    </DocMetadataContext.Provider>
  );
};

export const useDocMetadata = () => {
  const context = useContext(DocMetadataContext);
  if (!context)
    throw new Error("useDocMetadata must be used within a DocMetadataProvider");
  return context;
};
