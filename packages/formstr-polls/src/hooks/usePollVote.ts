import { useMemo, useState } from "react";
import type { EventTemplate } from "nostr-tools";
import { KIND_POLL_RESPONSE } from "../constants";
import type { NostrPollAdapter, PollModel } from "../types";
import { isPollExpired } from "../utils";

export function usePollVote(
  poll: PollModel | null,
  userRelays: string[],
  adapter: NostrPollAdapter,
) {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isExpired = useMemo(() => isPollExpired(poll?.endsAt), [poll?.endsAt]);

  const toggleOption = (optionId: string) => {
    if (!poll || submitting || isExpired) return;
    setError(null);

    if (poll.pollType === "singlechoice") {
      setSelected([optionId]);
      return;
    }

    setSelected((prev) =>
      prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId],
    );
  };

  const submit = async () => {
    if (!poll) return false;

    if (isExpired) {
      setError("This poll is expired.");
      return false;
    }

    if (!selected.length) {
      setError("Select at least one option before voting.");
      return false;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const unsigned: EventTemplate = {
        kind: KIND_POLL_RESPONSE,
        content: "",
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", poll.event.id],
          ["p", poll.event.pubkey],
          ...selected.map((value) => ["response", value]),
        ],
      };

      const relays = Array.from(new Set([...poll.relays, ...userRelays]));
      await adapter.signAndPublishVote({ unsigned, relays });
      setSuccess("Vote submitted.");
      return true;
    } catch {
      setError("Could not submit vote.");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    selected,
    submitting,
    error,
    success,
    isExpired,
    toggleOption,
    submit,
  };
}
