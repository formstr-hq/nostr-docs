import { finalizeEvent, getPublicKey, nip44, type Event, type EventTemplate } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { pool } from "./relayPool";
import { publishEvent } from "./publish";
import { signerManager } from "../signer";
import { KIND_COMMENT, KIND_COMMENT_RESOLUTION } from "./kinds";

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

/**
 * Comment-resolution authorization model
 * ──────────────────────────────────────
 * Relays are dumb encrypted-blob stores, so we can't enforce "who may resolve"
 * with a server-side ACL. Instead, authority is *proven by the signature* on the
 * resolution event, reusing the keys the document already depends on:
 *
 *   • Solo document (no edit access shared) — the doc lives at an address owned
 *     by the owner's key, so the owner's key is the authority. A viewer the doc
 *     was shared with signs their own comments with their own key.
 *   • Edit access shared — the doc is authored under the shared `editKey`, so the
 *     editKey is the single signing identity for *everyone* with edit access, and
 *     editKey-signed resolutions are authoritative.
 *
 * The authority pubkey is simply the pubkey embedded in the doc address
 * (`<kind>:<pubkey>:<dTag>`), which is public — so even a view-only holder can
 * verify an authority resolution without ever holding the editKey.
 *
 * A resolution is counted (see CommentContext `resolvedIds`) only if signed by:
 *   1. the doc authority (owner key / editKey), or
 *   2. the author of that specific comment — anyone may resolve *and reopen*
 *      their own thread, last-writer-wins (so a comment author can reopen a
 *      thread an editor resolved).
 * Resolutions signed by anyone else are ignored.
 *
 * Accordingly we sign here with the shared editKey when the caller has edit
 * access, otherwise with the user's own signer — which is the owner's key for a
 * solo doc, or a viewer's own key when they resolve their own comment.
 */
export async function publishResolution(
  commentEventId: string,
  viewKey: string,
  docAddress: string,
  relays: string[],
  resolved = true,
  editKey?: string,
): Promise<Event> {
  const encryptedContent = encryptTags(
    [["resolved", String(resolved)]],
    viewKey,
  );

  const template: EventTemplate = {
    kind: KIND_COMMENT_RESOLUTION,
    created_at: Math.floor(Date.now() / 1000),
    content: encryptedContent,
    tags: [
      ["d", commentEventId],
      ["a", docAddress],
      ["e", commentEventId],
      // Authority pubkey (owner key / editKey), also enabling a #p lookup.
      ["p", docAddress.split(":")[1] ?? ""],
    ],
  };

  let signed: Event;
  if (editKey) {
    signed = finalizeEvent(template, hexToBytes(editKey));
  } else {
    const signer = await signerManager.getSigner();
    if (!signer) throw new Error("No signer available");
    signed = await signer.signEvent(template);
  }

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

export function fetchResolutions(
  docAddress: string,
  relays: string[],
  onEvent: (event: Event) => void,
): SubCloser {
  const seenIds = new Set<string>();

  return pool.subscribeMany(
    relays,
    { kinds: [KIND_COMMENT_RESOLUTION], "#a": [docAddress] },
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
