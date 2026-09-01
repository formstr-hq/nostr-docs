import { useEffect, useMemo, useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { nip19, type Event } from "nostr-tools";
import {
  Box,
  CircularProgress,
  IconButton,
  Typography,
  Chip,
  Tooltip,
  alpha,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ShareIcon from "@mui/icons-material/Share";
import CheckIcon from "@mui/icons-material/Check";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { pool } from "../nostr/relayPool";
import { useRelays } from "../contexts/RelayContext";
import { KIND_LONGFORM, KIND_COMMUNITY_NIP } from "../utils/publishArticle";
import ArticleRenderer from "./ArticleRenderer";
import UserMenu from "./UserMenu";

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
  const outletCtx = useOutletContext<{ onOpenSidebar?: () => void }>() || {};
  const onOpenSidebar = outletCtx?.onOpenSidebar;
  const [copied, setCopied] = useState(false);

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
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* ── Top Navigation & Action Header ── */}
      <Box
        sx={{
          py: 1,
          px: { xs: 2, sm: 3 },
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          minHeight: 56,
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? alpha(t.palette.common.black, 0.45)
              : alpha(t.palette.common.black, 0.04),
          borderBottom: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        {/* Left: Hamburger (mobile) + Breadcrumbs / Title + Badge */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flex: 1 }}>
          {onOpenSidebar && (
            <IconButton
              size="small"
              aria-label="Open sidebar menu"
              onClick={onOpenSidebar}
              sx={{
                display: { xs: "inline-flex", md: "none" },
                p: 0.5,
                borderRadius: 1,
                color: "text.primary",
                flexShrink: 0,
              }}
            >
              <MenuIcon sx={{ fontSize: 20 }} />
            </IconButton>
          )}

          <Typography
            variant="body2"
            noWrap
            sx={{
              fontWeight: 700,
              fontSize: "0.92rem",
              color: "text.primary",
            }}
          >
            {title}
          </Typography>

          <Chip
            label={event.kind === KIND_COMMUNITY_NIP ? "NIP" : "PUBLIC"}
            size="small"
            sx={{
              height: 20,
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              borderRadius: 0.75,
              bgcolor: (t) =>
                alpha(event.kind === KIND_COMMUNITY_NIP ? t.palette.secondary.main : "#10B981", 0.15),
              color: event.kind === KIND_COMMUNITY_NIP ? "secondary.main" : "#10B981",
              border: (t) =>
                `1px solid ${alpha(
                  event.kind === KIND_COMMUNITY_NIP ? t.palette.secondary.main : "#10B981",
                  0.3,
                )}`,
              flexShrink: 0,
            }}
          />
        </Box>

        {/* Right: Share / Copy Link + Open External */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <Tooltip title={copied ? "Copied!" : "Copy Link"}>
            <IconButton
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              sx={{
                color: copied ? "success.main" : "text.secondary",
                p: 0.75,
                borderRadius: 1,
                border: "1px solid",
                borderColor: (t) => alpha(t.palette.text.primary, 0.08),
                bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
              }}
            >
              {copied ? <CheckIcon sx={{ fontSize: 17 }} /> : <ShareIcon sx={{ fontSize: 17 }} />}
            </IconButton>
          </Tooltip>

          {event.kind === KIND_LONGFORM && naddr && (
            <Tooltip title="View on Habla.news">
              <IconButton
                size="small"
                component="a"
                href={`https://habla.news/a/${naddr}`}
                target="_blank"
                rel="noreferrer"
                sx={{
                  color: "text.secondary",
                  p: 0.75,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: (t) => alpha(t.palette.text.primary, 0.08),
                  bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
                }}
              >
                <OpenInNewIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          )}

          {/* On mobile, also render UserMenu avatar on top right */}
          <Box sx={{ display: { xs: "flex", md: "none" }, ml: 0.5 }}>
            <UserMenu triggerMode="avatar" />
          </Box>
        </Box>
      </Box>

      {/* Main Content Area */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
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
    </Box>
  );
}
