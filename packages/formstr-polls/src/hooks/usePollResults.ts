import { useEffect, useMemo, useState } from "react";
import type { Event } from "nostr-tools";
import type { NostrPollAdapter, OptionResult, PollModel } from "../types";

export function usePollResults(
  poll: PollModel | null,
  enabled: boolean,
  userRelays: string[],
  adapter: NostrPollAdapter,
) {
  const [responses, setResponses] = useState<Event[]>([]);

  useEffect(() => {
    if (!poll || !enabled) return;

    setResponses([]);

    const relays = Array.from(new Set([...poll.relays, ...userRelays]));
    const sub = adapter.subscribePollResponses({
      poll,
      relays,
      onEvent: (event) => {
        setResponses((prev) => [...prev, event]);
      },
    });

    return () => sub.close();
  }, [adapter, enabled, poll, userRelays]);

  const byPubkeyLatest = useMemo(() => {
    const latestByPubkey = new Map<string, Event>();
    for (const response of responses) {
      const existing = latestByPubkey.get(response.pubkey);
      if (!existing || response.created_at > existing.created_at) {
        latestByPubkey.set(response.pubkey, response);
      }
    }
    return Array.from(latestByPubkey.values());
  }, [responses]);

  const results = useMemo(() => {
    const map = new Map<string, OptionResult>();
    if (!poll) return map;

    for (const option of poll.options) {
      map.set(option.id, { count: 0, percentage: 0, responders: [] });
    }

    for (const response of byPubkeyLatest) {
      for (const tag of response.tags) {
        if (tag[0] !== "response") continue;

        const option = map.get(tag[1]);
        if (!option) continue;
        if (option.responders.includes(response.pubkey)) continue;

        option.count += 1;
        option.responders.push(response.pubkey);
      }
    }

    const totalResponses = Array.from(map.values()).reduce(
      (sum, option) => sum + option.count,
      0,
    );

    if (totalResponses > 0) {
      for (const [, option] of map) {
        option.percentage = (option.count / totalResponses) * 100;
      }
    }

    return map;
  }, [byPubkeyLatest, poll]);

  return {
    results,
    totalVotes: byPubkeyLatest.length,
  };
}
