import { type Event } from "nostr-tools";

export const getEventAddress = (event: Event): string | null => {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (!dTag) return null;

  return `${event.kind}:${event.pubkey}:${dTag}`;
};

export const getLatestVersion = (history: {
  versions: { event: Event; decryptedContent: string }[];
}) => history.versions.at(-1) ?? null;
