import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { nip44, type Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { useRelays } from "./RelayContext";
import {
  fetchComments,
  publishComment,
  viewKeyConversationKey,
  type CommentPayload,
  type CommentType,
} from "../nostr/comments";
import {
  saveComment,
  getCommentsForDoc,
  type LocalStoredComment,
} from "../lib/localStore";

export interface DecryptedComment {
  id: string;
  pubkey: string;
  createdAt: number;
  docEventId: string;
  content: string;
  type: CommentType;
  quote?: string;
  context?: { prefix: string; suffix: string };
  event: Event;
}

interface CommentContextValue {
  comments: DecryptedComment[];
  addComment: (payload: CommentPayload, docEventId: string) => Promise<void>;
}

const CommentContext = createContext<CommentContextValue | undefined>(undefined);

function decryptCommentEvent(
  event: Event,
  viewKey: string,
): { comment: DecryptedComment; innerTags: string[][] } | null {
  try {
    const conversationKey = viewKeyConversationKey(viewKey);
    const decrypted = nip44.decrypt(event.content, conversationKey);
    const innerTags: string[][] = JSON.parse(decrypted);

    const get = (name: string) => innerTags.find((t) => t[0] === name);
    const contentTag = get("content");
    const typeTag = get("type");
    if (!contentTag || !typeTag) return null;

    const quoteTag = get("quote");
    const contextTag = get("context");
    const docEventId = event.tags.find((t) => t[0] === "e")?.[1] ?? "";

    return {
      innerTags,
      comment: {
        id: event.id,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        docEventId,
        content: contentTag[1],
        type: typeTag[1] as CommentType,
        quote: quoteTag?.[1],
        context: contextTag
          ? { prefix: contextTag[1], suffix: contextTag[2] }
          : undefined,
        event,
      },
    };
  } catch {
    return null;
  }
}

function commentFromStored(lc: LocalStoredComment): DecryptedComment | null {
  const tags = lc.decryptedTags;
  const get = (name: string) => tags.find((t) => t[0] === name);
  const contentTag = get("content");
  const typeTag = get("type");
  if (!contentTag || !typeTag) return null;

  const quoteTag = get("quote");
  const contextTag = get("context");
  const docEventId = lc.event.tags.find((t) => t[0] === "e")?.[1] ?? "";

  return {
    id: lc.id,
    pubkey: lc.event.pubkey,
    createdAt: lc.event.created_at,
    docEventId,
    content: contentTag[1],
    type: typeTag[1] as CommentType,
    quote: quoteTag?.[1],
    context: contextTag
      ? { prefix: contextTag[1], suffix: contextTag[2] }
      : undefined,
    event: lc.event,
  };
}

function insertSorted(
  prev: DecryptedComment[],
  next: DecryptedComment,
): DecryptedComment[] {
  if (prev.some((c) => c.id === next.id)) return prev;
  return [...prev, next].sort((a, b) => a.createdAt - b.createdAt);
}

export const CommentProvider: React.FC<{
  children: React.ReactNode;
  viewKey: string;
  docAddress: string;
}> = ({
  children,
  viewKey,
  docAddress,
}) => {
  const { relays } = useRelays();
  const [comments, setComments] = useState<DecryptedComment[]>([]);
  const subRef = useRef<SubCloser | null>(null);

  useEffect(() => {
    setComments([]);

    // Hydrate from local store first so comments appear instantly
    getCommentsForDoc(docAddress)
      .then((stored) => {
        const decrypted = stored
          .map(commentFromStored)
          .filter((c): c is DecryptedComment => c !== null)
          .sort((a, b) => a.createdAt - b.createdAt);
        if (decrypted.length > 0) {
          setComments(decrypted);
        }
      })
      .catch(() => {});

    // Subscribe to relay for live + historical comments
    subRef.current?.close();
    subRef.current = fetchComments(docAddress, relays, (event) => {
      const result = decryptCommentEvent(event, viewKey);
      if (!result) return;

      saveComment({
        id: event.id,
        docAddress,
        event,
        decryptedTags: result.innerTags,
        savedAt: Date.now(),
      }).catch(() => {});

      setComments((prev) => insertSorted(prev, result.comment));
    });

    return () => {
      subRef.current?.close();
      subRef.current = null;
    };
  }, [viewKey, docAddress, relays]);

  const addComment = async (
    payload: CommentPayload,
    docEventId: string,
  ): Promise<void> => {
    const event = await publishComment(
      payload,
      viewKey,
      docAddress,
      docEventId,
      relays,
    );

    // Build decryptedTags from payload directly — no need to re-decrypt
    const decryptedTags: string[][] = [
      ["content", payload.content],
      ["type", payload.type],
    ];
    if (payload.quote !== undefined) {
      decryptedTags.push(["quote", payload.quote]);
    }
    if (payload.context !== undefined) {
      decryptedTags.push([
        "context",
        payload.context.prefix,
        payload.context.suffix,
      ]);
    }

    await saveComment({
      id: event.id,
      docAddress,
      event,
      decryptedTags,
      savedAt: Date.now(),
    });

    const result = decryptCommentEvent(event, viewKey);
    if (!result) return;
    setComments((prev) => insertSorted(prev, result.comment));
  };

  return (
    <CommentContext.Provider value={{ comments, addComment }}>
      {children}
    </CommentContext.Provider>
  );
};

export const useComments = () => {
  const context = useContext(CommentContext);
  if (!context)
    throw new Error("useComments must be used within a CommentProvider");
  return context;
};
