import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { nip44, type Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import type { Editor } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { commentHighlightPluginKey } from "../utils/commentHighlightKey";
import { useRelays } from "./RelayContext";
import { locateComment } from "../utils/commentAnchoring";
import {
  fetchComments,
  fetchResolutions,
  publishComment,
  publishResolution,
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
  resolvedIds: Set<string>;
  resolveComment: (commentId: string) => Promise<void>;
  unresolveComment: (commentId: string) => Promise<void>;
  applyHighlights: (editor: Editor) => void;
  isOutdated: (comment: DecryptedComment) => boolean;
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

function decryptResolutionEvent(
  event: Event,
  viewKey: string,
): { commentId: string; resolved: boolean } | null {
  try {
    const conversationKey = viewKeyConversationKey(viewKey);
    const decrypted = nip44.decrypt(event.content, conversationKey);
    const tags: string[][] = JSON.parse(decrypted);

    const resolvedTag = tags.find((t) => t[0] === "resolved");
    if (!resolvedTag) return null;

    const commentId = event.tags.find((t) => t[0] === "d")?.[1];
    if (!commentId) return null;

    return { commentId, resolved: resolvedTag[1] === "true" };
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

function applyCommentHighlights(
  editor: Editor,
  comments: DecryptedComment[],
  resolvedIds: Set<string>,
): void {
  const { doc } = editor.state;
  const decorations: Decoration[] = [];

  for (const comment of comments) {
    if (!comment.quote || resolvedIds.has(comment.id)) continue;
    const range = locateComment(doc, comment.quote, comment.context);
    if (!range) continue;
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: "comment-highlight",
        style: "cursor: pointer; background-color: var(--comment-highlight-color, rgba(255, 213, 0, 0.4)); border-radius: 2px;",
        "data-comment-id": comment.id,
      }),
    );
  }

  const decoSet = DecorationSet.create(doc, decorations);
  editor.view.dispatch(editor.state.tr.setMeta(commentHighlightPluginKey, decoSet));
}

export const CommentProvider: React.FC<{
  children: React.ReactNode;
  viewKey: string;
  docAddress: string;
  currentDocText: string;
}> = ({
  children,
  viewKey,
  docAddress,
  currentDocText,
}) => {
  const { relays } = useRelays();
  const [comments, setComments] = useState<DecryptedComment[]>([]);
  const [resolverMap, setResolverMap] = useState<Map<string, { resolved: boolean; createdAt: number }>>(new Map());
  const subRef = useRef<SubCloser | null>(null);
  const resolutionsSubRef = useRef<SubCloser | null>(null);

  useEffect(() => {
    setComments([]);
    setResolverMap(new Map());

    subRef.current?.close();
    subRef.current = fetchComments(docAddress, relays, (event) => {
      const comment = decryptCommentEvent(event, viewKey);
      if (!comment) return;

      setComments((prev) => insertSorted(prev, comment));
    });

    resolutionsSubRef.current?.close();
    resolutionsSubRef.current = fetchResolutions(docAddress, relays, (event) => {
      const result = decryptResolutionEvent(event, viewKey);
      if (!result) return;

      const tsKey = `${event.pubkey}:${result.commentId}`;
      setResolverMap((prev) => {
        const existing = prev.get(tsKey);
        if (existing && event.created_at <= existing.createdAt) return prev;
        return new Map(prev).set(tsKey, { resolved: result.resolved, createdAt: event.created_at });
      });
    });

    return () => {
      subRef.current?.close();
      subRef.current = null;
      resolutionsSubRef.current?.close();
      resolutionsSubRef.current = null;
    };
  }, [viewKey, docAddress, relays]);

  const resolvedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [tsKey, { resolved }] of resolverMap) {
      if (resolved) ids.add(tsKey.split(":")[1]);
    }
    return ids;
  }, [resolverMap]);

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

  const resolveComment = async (commentId: string): Promise<void> => {
    const event = await publishResolution(commentId, viewKey, docAddress, relays, true);
    const tsKey = `${event.pubkey}:${commentId}`;
    setResolverMap((m) => new Map(m).set(tsKey, { resolved: true, createdAt: event.created_at }));
  };

  const unresolveComment = async (commentId: string): Promise<void> => {
    const event = await publishResolution(commentId, viewKey, docAddress, relays, false);
    const tsKey = `${event.pubkey}:${commentId}`;
    setResolverMap((m) => new Map(m).set(tsKey, { resolved: false, createdAt: event.created_at }));
  };

  const isOutdated = useCallback(
    (comment: DecryptedComment) => {
      if (!comment.quote) return false;
      if (!currentDocText) return false;
      return !currentDocText.includes(comment.quote);
    },
    [currentDocText],
  );

  const activeComments = useMemo(
    () => comments.filter((c) => !isOutdated(c)),
    [comments, isOutdated],
  );

  const applyHighlights = useCallback(
    (editor: Editor) =>
      applyCommentHighlights(editor, activeComments, resolvedIds),
    [activeComments, resolvedIds],
  );

  return (
    <CommentContext.Provider
      value={{ comments, addComment, resolvedIds, resolveComment, unresolveComment, applyHighlights, isOutdated }}
    >
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
