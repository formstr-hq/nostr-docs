import type { Event } from "nostr-tools";
import type { NostrPollAdapter } from "@formstr/polls";
import { KIND_POLL, POLL_RESPONSE_KINDS } from "@formstr/polls";
import { pool, DEFAULT_RELAYS } from "../nostr/relayPool";
import { signerManager } from "../signer";
import { publishEvent } from "../nostr/publish";

const POLLERAMA_RELAY_HINTS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

export const nostrDocsPollAdapter: NostrPollAdapter = {
  async fetchPollEvent({ id, relays }) {
    const queryRelays = Array.from(new Set([...relays, ...DEFAULT_RELAYS, ...POLLERAMA_RELAY_HINTS]));
    const events = await pool.querySync(queryRelays, {
      ids: [id],
      limit: 1,
    });

    const pollEvent = events.find((event) => event.kind === KIND_POLL);
    return pollEvent ?? null;
  },

  async fetchAuthorProfile({ pubkey, relays }) {
    const queryRelays = Array.from(new Set([...relays, ...DEFAULT_RELAYS, ...POLLERAMA_RELAY_HINTS]));
    const events = await pool.querySync(queryRelays, {
      kinds: [0],
      authors: [pubkey],
      limit: 1,
    });

    if (!events.length) return null;
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];

    try {
      const content = JSON.parse(latest.content) as {
        display_name?: string;
        name?: string;
        username?: string;
        nip05?: string;
        picture?: string;
      };
      return {
        // Pollerama UI usually favors `name` over `display_name`.
        displayName: content.name || content.display_name || content.username,
        handle: content.nip05,
        picture: content.picture,
        nip05: content.nip05,
      };
    } catch {
      return null;
    }
  },

  subscribePollResponses({ poll, relays, onEvent }) {
    const resultRelays = Array.from(new Set([...poll.relays, ...relays, ...DEFAULT_RELAYS, ...POLLERAMA_RELAY_HINTS]));
    const filter = {
      "#e": [poll.event.id],
      kinds: [...POLL_RESPONSE_KINDS],
      ...(poll.endsAt ? { until: poll.endsAt } : {}),
    };

    const sub = pool.subscribeMany(resultRelays, filter, {
      onevent: (event: Event) => onEvent(event),
    });

    return {
      close: () => sub.close(),
    };
  },

  async signAndPublishVote({ unsigned, relays }) {
    const signer = await signerManager.getSigner();
    const signed = await signer.signEvent(unsigned);
    const targetRelays = relays.length
      ? Array.from(new Set([...relays, ...DEFAULT_RELAYS, ...POLLERAMA_RELAY_HINTS]))
      : Array.from(new Set([...DEFAULT_RELAYS, ...POLLERAMA_RELAY_HINTS]));
    await publishEvent(signed, targetRelays);
  },
};
