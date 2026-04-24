import { useEffect, useMemo, useState } from "react";
import type { Event } from "nostr-tools";
import type { NostrPollAdapter, PollModel } from "../types";
import { decodeNevent, parsePollEvent } from "../utils";

export function usePollEvent(
  nevent: string,
  userRelays: string[],
  adapter: NostrPollAdapter,
) {
  const [event, setEvent] = useState<Event | null>(null);
  const [relayHints, setRelayHints] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const decoded = decodeNevent(nevent);

    if (!decoded) {
      setError("Invalid poll reference");
      setLoading(false);
      return;
    }

    const relays = Array.from(new Set([...decoded.relays, ...userRelays]));
    setRelayHints(relays);

    setLoading(true);
    setError(null);

    adapter
      .fetchPollEvent({ id: decoded.id, relays })
      .then((nextEvent) => {
        if (cancelled) return;
        if (!nextEvent) {
          setEvent(null);
          setError("Poll not found on available relays");
          return;
        }
        setEvent(nextEvent);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load poll");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nevent, userRelays, adapter]);

  const poll: PollModel | null = useMemo(() => {
    if (!event) return null;
    const parsed = parsePollEvent(event);
    return {
      ...parsed,
      relays: Array.from(new Set([...parsed.relays, ...relayHints, ...userRelays])),
    };
  }, [event, relayHints, userRelays]);

  return { poll, loading, error };
}
