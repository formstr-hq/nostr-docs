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
): DecryptedComment | null {
  try {
    const conversationKey = viewKeyConversationKey(viewKey);
    const decrypted = nip44.decrypt(event.content, conversationKey);
    const tags: string[][] = JSON.parse(decrypted);

    const get = (name: string) => tags.find((t) => t[0] === name);
    const contentTag = get("content");
    const typeTag = get("type");
    if (!contentTag || !typeTag) return null;

    const quoteTag = get("quote");
    const contextTag = get("context");
    const docEventId = event.tags.find((t) => t[0] === "e")?.[1] ?? "";

    return {
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
    };
  } catch {
    return null;
  }
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

    subRef.current?.close();
    subRef.current = fetchComments(docAddress, relays, (event) => {
      const comment = decryptCommentEvent(event, viewKey);
      if (!comment) return;

      setComments((prev) => insertSorted(prev, comment));
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

    const comment: DecryptedComment = {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      docEventId,
      content: payload.content,
      type: payload.type,
      quote: payload.quote,
      context: payload.context,
      event,
    };
    setComments((prev) => insertSorted(prev, comment));
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
