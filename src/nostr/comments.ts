import { getPublicKey, nip44, type Event, type EventTemplate } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { pool } from "./relayPool";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_COMMENT } from "./kinds";

export type CommentType = "comment" | "suggestion";

export interface CommentPayload {
  content: string;
  type: CommentType;
  quote?: string;
  context?: { prefix: string; suffix: string };
}

export function viewKeyConversationKey(viewKey: string): Uint8Array {
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
): Promise<Event> {
  const signer = await signerManager.getSigner();
  if (!signer) throw new Error("No signer available");

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
      ["a", docAddress],
      ["e", docEventId],
      ["p", docOwnerPubkey],
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
): SubCloser {
  const seenIds = new Set<string>();

  return pool.subscribeMany(
    relays,
    { kinds: [KIND_COMMENT], "#a": [docAddress] },
    {
      onevent(event: Event) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          onEvent(event);
        }
      },
    },
  );
}
