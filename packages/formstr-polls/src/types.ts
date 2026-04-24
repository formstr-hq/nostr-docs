import type { Event, EventTemplate } from "nostr-tools";

export type PollType = "singlechoice" | "multiplechoice";

export type PollOption = {
  id: string;
  label: string;
};

export type PollModel = {
  event: Event;
  question: string;
  pollType: PollType;
  options: PollOption[];
  endsAt?: number;
  relays: string[];
};

export type OptionResult = {
  count: number;
  percentage: number;
  responders: string[];
};

export type PollResponseSubscription = {
  close: () => void;
};

export type NostrPollAdapter = {
  fetchPollEvent: (input: { id: string; relays: string[] }) => Promise<Event | null>;
  fetchAuthorProfile?: (input: { pubkey: string; relays: string[] }) => Promise<{
    displayName?: string;
    handle?: string;
    picture?: string;
    nip05?: string;
  } | null>;
  subscribePollResponses: (input: {
    poll: PollModel;
    relays: string[];
    onEvent: (event: Event) => void;
  }) => PollResponseSubscription;
  signAndPublishVote: (input: {
    unsigned: EventTemplate;
    relays: string[];
  }) => Promise<void>;
};
