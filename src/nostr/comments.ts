import { getPublicKey, nip44, type Event, type EventTemplate } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { pool } from "./relayPool";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_COMMENT, KIND_COMMENT_RESOLUTION } from "./kinds";

export type CommentType = "comment" | "suggestion";

export interface CommentPayload {
  /** The comment body (plain remark) or proposed replacement text (suggestion). */
  content: string;
  type: CommentType;
 /** The exact selected text, TextQuoteSelector `exact` field. Omit for doc-level comments. */
  quote?: string;
  /** Up to 32 chars before and after the selection for disambiguation. Omit for doc-level comments. */
  context?: { prefix: string; suffix: string };
}

function viewKeyConversationKey(viewKey: string): Uint8Array {
  const keyBytes = hexToBytes(viewKey);
  return nip44.getConversationKey(keyBytes, getPublicKey(keyBytes));
}

function encryptTags(tags: string[][], viewKey: string): string {
  const conversationKey = viewKeyConversationKey(viewKey);
  return nip44.encrypt(JSON.stringify(tags), conversationKey);
}

export async function publishComment(
  payload: CommentPayload,
  viewKey: string,
  docAddress: string,
  docEventId: string,
  relays: string[],
  relayHint = "",
): Promise<Event> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer available");

  // Build inner encrypted tag array
  const innerTags: string[][] = [
    ["content", payload.content],
    ["type", payload.type],
  ];
  if (payload.quote !== undefined) {
    innerTags.push(["quote", payload.quote]);
  }
  if (payload.context !== undefined) {
    innerTags.push(["context", payload.context.prefix, payload.context.suffix]);
  }

  const encryptedContent = encryptTags(innerTags, viewKey);

  const docOwnerPubkey = docAddress.split(":")[1];

  const event: EventTemplate = {
    kind: KIND_COMMENT,
    created_at: Math.floor(Date.now() / 1000),
    content: encryptedContent,
    tags: [
      ["a", docAddress, relayHint],
      ["e", docEventId, relayHint],
      ["p", docOwnerPubkey],
    ],
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);
  return signed;
}

export async function publishResolution(
  commentEventId: string,
  viewKey: string,
  docAddress: string,
  relays: string[],
  resolved = true,
  relayHint = "",
  note?: string,
): Promise<Event> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer available");

  const innerTags: string[][] = [["resolved", String(resolved)]];
  if (note) {
    innerTags.push(["content", note]);
  }

  const encryptedContent = encryptTags(innerTags, viewKey);

  const event: EventTemplate = {
    kind: KIND_COMMENT_RESOLUTION,
    created_at: Math.floor(Date.now() / 1000),
    content: encryptedContent,
    tags: [
      ["d", commentEventId],
      ["a", docAddress, relayHint],
      ["e", commentEventId, relayHint],
    ],
  };

  const signed = await signer.signEvent(event);
  await publishEvent(signed, relays);
  return signed;
}

export function fetchComments(
  docAddress: string,
  relays: string[],
  onEvent: (event: Event) => void,
  onEose?: () => void,
): SubCloser {
  const seenIds = new Set<string>();
  let eoseCount = 0;

  return pool.subscribeMany(
    relays,
    [{ kinds: [KIND_COMMENT], "#a": [docAddress] }],
    {
      onevent(event: Event) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          onEvent(event);
        }
      },
      oneose() {
        eoseCount++;
        if (eoseCount >= relays.length) {
          onEose?.();
        }
      },
    },
  );
}

export function fetchResolutions(
  docAddress: string,
  relays: string[],
  onEvent: (event: Event) => void,
  onEose?: () => void,
): SubCloser {
  const seenIds = new Set<string>();
  let eoseCount = 0;

  return pool.subscribeMany(
    relays,
    [{ kinds: [KIND_COMMENT_RESOLUTION], "#a": [docAddress] }],
    {
      onevent(event: Event) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          onEvent(event);
        }
      },
      oneose() {
        eoseCount++;
        if (eoseCount >= relays.length) {
          onEose?.();
        }
      },
    },
  );
}
