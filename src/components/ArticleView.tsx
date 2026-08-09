import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { nip19, type Event } from "nostr-tools";
import { Box, CircularProgress } from "@mui/material";
import { pool } from "../nostr/relayPool";
import { useRelays } from "../contexts/RelayContext";
import { KIND_LONGFORM, KIND_COMMUNITY_NIP } from "../utils/publishArticle";
import ArticleRenderer from "./ArticleRenderer";

type Parsed = { kind: number; pubkey: string; identifier: string; relays?: string[] };

/**
 * Read-only, in-app viewer for a page published as a public article (NIP-23,
 * kind 30023) or a community NIP (kind 30817). Fetches the addressable event by
 * naddr and renders its markdown — so a published link opens inside our own app
 * rather than depending on a third-party renderer.
 */
export default function ArticleView() {
  const { naddr } = useParams<{ naddr: string }>();
  const { relays } = useRelays();

  // Parse + validate the naddr synchronously — no effect/state needed.
  const parsed = useMemo<Parsed | null>(() => {
    if (!naddr) return null;
    try {
      const d = nip19.decode(naddr);
      if (d.type !== "naddr") return null;
      if (d.data.kind !== KIND_LONGFORM && d.data.kind !== KIND_COMMUNITY_NIP) return null;
      return d.data;
    } catch {
      return null;
    }
  }, [naddr]);

  const [event, setEvent] = useState<Event | null>(null);
  // Route is keyed by path (remounts per article), so "loading" is the correct
  // initial state and we only ever update it from the async fetch callbacks.
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");

  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    // Query the article's own relay hints first, falling back to our defaults.
    const queryRelays = parsed.relays?.length ? parsed.relays : relays;
    pool
      .get(queryRelays, {
        kinds: [parsed.kind],
        authors: [parsed.pubkey],
        "#d": [parsed.identifier],
      })
      .then((ev) => {
        if (cancelled) return;
        if (!ev) {
          setState("notfound");
          return;
        }
        setEvent(ev);
        setState("ready");
      })
      .catch(() => !cancelled && setState("notfound"));

    return () => {
      cancelled = true;
    };
  }, [parsed, relays]);

  if (!parsed) return <Box sx={{ p: 4 }}>Invalid article link.</Box>;
  if (state === "loading") {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (state === "notfound" || !event) {
    return <Box sx={{ p: 4 }}>Article not found. It may not have propagated to relays yet.</Box>;
  }

  const title = event.tags.find((t) => t[0] === "title")?.[1] ?? "Untitled";
  const banner = event.tags.find((t) => t[0] === "image")?.[1];
  const topics = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);

  return (
    // The main content area is a fixed-height, overflow:hidden shell, so this
    // container owns its own vertical scroll. Full height + overflowY:auto makes
    // long articles scrollable rather than clipped.
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      <Box sx={{ maxWidth: 760, mx: "auto", px: 3, py: 4, width: "100%" }}>
        <ArticleRenderer
          title={title}
          content={event.content}
          banner={banner}
          topics={topics}
          isNip={event.kind === KIND_COMMUNITY_NIP}
        />
      </Box>
    </Box>
  );
}
