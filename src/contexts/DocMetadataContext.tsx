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
import { fetchAllDocMetadata, saveDocMetadata } from "../nostr/docMetadata";

interface DocMetadataContextValue {
  docTags: Map<string, string[]>;
  docTitles: Map<string, string>;
  allTags: string[];
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  setDocTags: (address: string, tags: string[]) => Promise<void>;
  setDocTitle: (address: string, title: string) => Promise<void>;
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
  const [docTags, setDocTagsState] = useState<Map<string, string[]>>(new Map());
  const [docTitles, setDocTitlesState] = useState<Map<string, string>>(new Map());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setDocTagsState(new Map());
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const signer = await signerManager.getSigner();
        if (!signer) return;
        const pubkey = await signer.getPublicKey();
        const metadata = await fetchAllDocMetadata(relays, pubkey);
        const tagsMap = new Map<string, string[]>();
        const titlesMap = new Map<string, string>();
        for (const [address, meta] of metadata) {
          if (meta.tags.length > 0) tagsMap.set(address, meta.tags);
          if (meta.title) titlesMap.set(address, meta.title);
        }
        setDocTagsState(tagsMap);
        setDocTitlesState(titlesMap);
      } catch (err) {
        console.error("Failed to fetch doc metadata:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, relays]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const tags of docTags.values()) {
      for (const tag of tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [docTags]);

  const setDocTags = async (address: string, tags: string[]) => {
    const currentTitle = docTitles.get(address);
    await saveDocMetadata(address, { tags, title: currentTitle }, relays);
    setDocTagsState((prev) => {
      const next = new Map(prev);
      if (tags.length === 0) next.delete(address);
      else next.set(address, tags);
      return next;
    });
  };

  const setDocTitle = async (address: string, title: string) => {
    const currentTags = docTags.get(address) || [];
    await saveDocMetadata(address, { tags: currentTags, title }, relays);
    setDocTitlesState((prev) => {
      const next = new Map(prev);
      if (!title) next.delete(address);
      else next.set(address, title);
      return next;
    });
  };

  return (
    <DocMetadataContext.Provider
      value={{ docTags, docTitles, allTags, selectedTag, setSelectedTag, setDocTags, setDocTitle, loading }}
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
