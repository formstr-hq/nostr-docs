import { nip19, type Event } from "nostr-tools";
import {
  POLL_EXPIRY_TAG,
  POLL_LABEL_TAG,
  POLL_OPTION_TAG,
  POLL_RELAY_TAG,
  POLL_TYPE_MULTI,
  POLL_TYPE_SINGLE,
  POLL_TYPE_TAG,
} from "./constants";
import type { PollModel, PollOption, PollType } from "./types";

const POLL_URL_PATTERN = /pollerama\.fun\/respond\/(nevent1[0-9a-z]+)/i;
const NEVENT_PATTERN = /(?:nostr:)?(nevent1[0-9a-z]+)/i;

export function extractNeventRef(input: string): string | null {
  const polleramaMatch = input.match(POLL_URL_PATTERN);
  if (polleramaMatch?.[1]) return polleramaMatch[1];

  const neventMatch = input.match(NEVENT_PATTERN);
  if (neventMatch?.[1]) return neventMatch[1];

  return null;
}

export function decodeNevent(nevent: string): { id: string; relays: string[] } | null {
  try {
    const decoded = nip19.decode(nevent);
    if (decoded.type !== "nevent") return null;

    const data = decoded.data;
    if (!("id" in data) || typeof data.id !== "string") return null;

    const relays = Array.isArray(data.relays)
      ? data.relays.filter((relay): relay is string => typeof relay === "string")
      : [];

    return { id: data.id, relays };
  } catch {
    return null;
  }
}

export function parsePollEvent(event: Event): PollModel {
  const options: PollOption[] = event.tags
    .filter((tag) => tag[0] === POLL_OPTION_TAG && typeof tag[1] === "string")
    .map((tag) => ({
      id: tag[1],
      label: tag[2] || tag[1],
    }));

  const pollTypeTag = event.tags.find((tag) => tag[0] === POLL_TYPE_TAG)?.[1];
  const pollType: PollType = pollTypeTag === POLL_TYPE_MULTI ? POLL_TYPE_MULTI : POLL_TYPE_SINGLE;

  const endsAtRaw = event.tags.find((tag) => tag[0] === POLL_EXPIRY_TAG)?.[1];
  const endsAt = endsAtRaw ? Number(endsAtRaw) : undefined;

  const relays = event.tags
    .filter((tag) => tag[0] === POLL_RELAY_TAG && typeof tag[1] === "string")
    .map((tag) => tag[1]);

  const label = event.tags.find((tag) => tag[0] === POLL_LABEL_TAG)?.[1];

  return {
    event,
    question: label || event.content,
    pollType,
    options,
    endsAt: Number.isFinite(endsAt) ? endsAt : undefined,
    relays,
  };
}

export function isPollExpired(endsAt?: number): boolean {
  if (!endsAt) return false;
  return endsAt * 1000 < Date.now();
}

export function buildPolleramaUrl(nevent: string): string {
  return `https://pollerama.fun/respond/${nevent}`;
}

export function relativeExpiryText(endsAt?: number): string | null {
  if (!endsAt) return null;

  const delta = endsAt * 1000 - Date.now();
  if (delta <= 0) return "Poll expired";

  const totalMinutes = Math.floor(delta / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Expires in ${days}d ${hours}h`;
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
  return `Expires in ${minutes}m`;
}
