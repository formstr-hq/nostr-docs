import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  GlobalStyles,
  Paper,
  Radio,
  Checkbox,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { nip19 } from "nostr-tools";
import type { NostrPollAdapter } from "../types";
import { usePollEvent } from "../hooks/usePollEvent";
import { usePollResults } from "../hooks/usePollResults";
import { usePollVote } from "../hooks/usePollVote";
import { buildPolleramaUrl } from "../utils";
import { Nip05Badge } from "./Nip05Badge";

function formatCountdown(endsAt?: number, nowMs = Date.now()): string | null {
  if (!endsAt) return null;
  const diff = endsAt * 1000 - nowMs;
  if (diff <= 0) return "Poll expired";

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `Expires in ${hours}h ${minutes}m ${seconds}s`;
}

export function InlinePollCard({
  nevent,
  userRelays,
  adapter,
}: {
  nevent: string;
  userRelays: string[];
  adapter: NostrPollAdapter;
}) {
  const { poll, loading, error } = usePollEvent(nevent, userRelays, adapter);
  const [showResults, setShowResults] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [authorName, setAuthorName] = useState<string>("");
  const [authorHandle, setAuthorHandle] = useState<string>("");
  const [authorPicture, setAuthorPicture] = useState<string>("");
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("sm"));
  const vote = usePollVote(poll, userRelays, adapter);
  const { results, totalVotes } = usePollResults(
    poll,
    showResults || !!vote.success,
    userRelays,
    adapter,
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!vote.success) return;
    setShowResults(true);
  }, [vote.success]);

  useEffect(() => {
    if (!poll || !adapter.fetchAuthorProfile) return;
    let cancelled = false;

    adapter
      .fetchAuthorProfile({
        pubkey: poll.event.pubkey,
        relays: poll.relays,
      })
      .then((profile) => {
        if (cancelled || !profile) return;
        setAuthorName(profile.displayName ?? "");
        setAuthorHandle(profile.nip05 ?? profile.handle ?? "");
        setAuthorPicture(profile.picture ?? "");
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [adapter, poll]);

  const expiryText = useMemo(
    () => formatCountdown(poll?.endsAt, nowMs),
    [poll?.endsAt, nowMs],
  );

  const createdAgo = useMemo(() => {
    if (!poll) return "";
    const delta = Math.max(1, Math.floor(Date.now() / 1000) - poll.event.created_at);
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return `${Math.floor(delta / 86400)}d ago`;
  }, [poll, nowMs]);

  const authorProfileUrl = useMemo(() => {
    if (!poll) return "https://pollerama.fun";
    try {
      const npub = nip19.npubEncode(poll.event.pubkey);
      return `https://pollerama.fun/profile/${npub}`;
    } catch {
      return "https://pollerama.fun";
    }
  }, [poll]);

  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5, my: 1, borderRadius: 2.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <Typography variant="body2">Loading poll...</Typography>
        </Stack>
      </Paper>
    );
  }

  if (error || !poll) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5, my: 1, borderRadius: 2.5 }}>
        <Typography variant="body2" color="error.main">
          {error ?? "Poll unavailable"}
        </Typography>
        <Button size="small" sx={{ mt: 1 }} href={buildPolleramaUrl(nevent)} target="_blank" rel="noreferrer">
          Open in Pollerama
        </Button>
      </Paper>
    );
  }

  return (
    <>
      <GlobalStyles
        styles={{
          "@font-face": [
            {
              fontFamily: "Shantell Sans",
              src: 'url("/fonts/ShantellSans.ttf") format("truetype")',
              fontWeight: 400,
              fontStyle: "normal",
              fontDisplay: "swap",
            },
            {
              fontFamily: "Shantell Sans",
              src: 'url("/fonts/ShantellSans-Italic.ttf") format("truetype")',
              fontWeight: 400,
              fontStyle: "italic",
              fontDisplay: "swap",
            },
          ],
        }}
      />
      <Box sx={{ width: "100%", maxWidth: { xs: "100%", sm: 600 }, mx: "auto", my: { xs: 0.75, sm: 1 } }}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.1, sm: 1.5 },
          borderRadius: { xs: 1.5, sm: 2 },
          borderColor: alpha(theme.palette.text.primary, 0.2),
          bgcolor: alpha(theme.palette.background.paper, 0.9),
          WebkitTextSizeAdjust: "none",
          textSizeAdjust: "none",
          fontFamily: '"Shantell Sans", sans-serif',
          transition: "border-color 180ms ease, box-shadow 220ms ease, transform 220ms ease",
          "@media (hover: hover) and (pointer: fine)": {
            "&:hover": {
              borderColor: alpha(theme.palette.secondary.main, 0.55),
              boxShadow: `0 8px 24px ${alpha(theme.palette.common.black, 0.25)}`,
              transform: "translateY(-1px)",
            },
          },
          // ReactMarkdown preview applies global anchor underline styles.
          // Force local card links to start non-underlined.
          "& a": {
            textDecoration: "none !important",
          },
          // Keep typography/buttons consistent with Pollerama's handwritten look.
          "& .MuiTypography-root, & .MuiButton-root": {
            fontFamily: '"Shantell Sans", sans-serif !important',
          },
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: { xs: 0.45, sm: 0.6 } }}>
          <Stack direction="row" spacing={1.2} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              component="a"
              href={authorProfileUrl}
              target="_blank"
              rel="noreferrer"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                color: "inherit",
                textDecoration: "none",
                cursor: "pointer",
                transition: "transform 180ms ease, opacity 180ms ease",
                "&:hover": { transform: "scale(1.03)", opacity: 0.95 },
              }}
            >
              <Avatar src={authorPicture || undefined} sx={{ width: { xs: 36, sm: 42 }, height: { xs: 36, sm: 42 } }}>
                {(authorName || "P").slice(0, 1).toUpperCase()}
              </Avatar>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Box
                component="a"
                href={authorProfileUrl}
                target="_blank"
                rel="noreferrer"
                sx={{
                  color: "inherit",
                  textDecoration: "none",
                  cursor: "pointer",
                  display: "inline-block",
                  transition: "opacity 180ms ease",
                  "&:hover .poll-author-name": {
                    textDecoration: "underline !important",
                    textUnderlineOffset: "3px",
                  },
                }}
              >
                <Typography
                  className="poll-author-name"
                  variant="subtitle1"
                  sx={{
                    lineHeight: 1.1,
                    fontWeight: 700,
                    fontSize: { xs: "16px", sm: "18px" },
                    textDecoration: "none !important",
                  }}
                >
                  {authorName || "Poll Author"}
                </Typography>
              </Box>
              {authorHandle && (
                <Nip05Badge nip05={authorHandle} pubkey={poll.event.pubkey} />
              )}
            </Box>
          </Stack>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.1, mb: 0.5, fontSize: { xs: "14px", sm: "16px" } }}>
          {createdAgo}
        </Typography>

        <Typography
          variant="h5"
          sx={{
            fontSize: { xs: "16px", sm: "20px" },
            mb: { xs: 0.55, sm: 0.7 },
            lineHeight: 1.2,
          }}
        >
          {poll.question || "Untitled poll"}
        </Typography>

      {expiryText && (
        <Typography
          variant="caption"
          color={vote.isExpired ? "error.main" : "text.secondary"}
          sx={{ display: "block", mb: { xs: 0.75, sm: 1 }, fontSize: { xs: "12px", sm: "14px" } }}
        >
          {expiryText}
        </Typography>
      )}

      <Stack spacing={0} sx={{ mt: 0.5 }}>
        {poll.options.map((option) => {
          const checked = vote.selected.includes(option.id);
          const result = results.get(option.id);
          const percentage = result?.percentage ?? 0;
          return (
            <Box
              key={option.id}
              onClick={() => vote.toggleOption(option.id)}
              sx={{
                position: "relative",
                borderBottom: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
                "&:last-child": { borderBottom: "none" },
                cursor: vote.isExpired ? "not-allowed" : "pointer",
                opacity: vote.isExpired ? 0.6 : 1,
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: showResults ? `${percentage}%` : "0%",
                  background: `linear-gradient(90deg, ${alpha("#3b82f6", 0.3)} 0%, ${alpha("#3b82f6", 0.06)} 100%)`,
                  transition: "width 0.7s cubic-bezier(0.25, 1, 0.5, 1)",
                }}
              />

              <Stack
                direction="row"
                justifyContent="space-between"
                spacing={1}
                alignItems="center"
                sx={{ position: "relative", px: { xs: 0.1, sm: 0.2 }, py: { xs: 0.25, sm: 0.45 } }}
              >
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                  {poll.pollType === "singlechoice" ? (
                    <Radio
                      checked={checked}
                      onChange={() => vote.toggleOption(option.id)}
                      disabled={vote.isExpired}
                      size="small"
                      sx={{ p: { xs: 0.35, sm: 0.5 }, flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <Checkbox
                      checked={checked}
                      onChange={() => vote.toggleOption(option.id)}
                      disabled={vote.isExpired}
                      size="small"
                      sx={{ p: { xs: 0.35, sm: 0.5 }, flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: { xs: "14px", sm: "17px" },
                      lineHeight: { xs: 1.2, sm: 1.15 },
                      wordBreak: "break-word",
                    }}
                  >
                    {option.label}
                  </Typography>
                </Stack>
                {showResults && result && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ flexShrink: 0, fontWeight: 700, fontSize: { xs: "12px", sm: "14px" } }}
                  >
                    {result.percentage.toFixed(0)}%
                  </Typography>
                )}
              </Stack>
            </Box>
          );
        })}
      </Stack>

      {vote.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {vote.error}
        </Alert>
      )}
      {vote.success && (
        <Alert severity="success" sx={{ mt: 1 }}>
          {vote.success} {showResults ? `(${totalVotes} voters)` : ""}
        </Alert>
      )}

      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: { xs: 0.95, sm: 1.2 }, justifyContent: "space-between", alignItems: "center" }}
      >
        <Button
          variant="contained"
          size="medium"
          disabled={vote.submitting || vote.isExpired}
          onClick={() => {
            void vote.submit();
          }}
          sx={{
            borderRadius: 999,
            px: 2.3,
            bgcolor: "#FAD13F",
            color: "#101010",
            fontFamily: '"Shantell Sans", sans-serif',
            fontSize: { xs: "15px", sm: "18px" },
            py: { xs: 0.8, sm: 0.55 },
            "&:hover": { bgcolor: "#efc62f" },
          }}
        >
          {vote.submitting ? "Submitting..." : "Submit Response"}
        </Button>
        <Stack
          direction="row"
          spacing={0.8}
          alignItems="center"
          sx={{
            justifyContent: "flex-start",
            flexWrap: "nowrap",
          }}
        >
          <Button
            variant="contained"
            size="medium"
            onClick={() => setShowResults((prev) => !prev)}
            sx={{
              borderRadius: 999,
              px: { xs: 1.6, sm: 2 },
              bgcolor: "#c9c9c9",
              color: "#101010",
              fontFamily: '"Shantell Sans", sans-serif',
              fontSize: { xs: "15px", sm: "18px" },
              py: { xs: 0.8, sm: 0.55 },
              "&:hover": { bgcolor: "#b7b7b7" },
            }}
          >
            {showResults ? "hide results" : "results"}
          </Button>
          <Button
            size="small"
            href={buildPolleramaUrl(nevent)}
            target="_blank"
            rel="noreferrer"
            sx={{
              textDecoration: "none",
              fontFamily: '"Shantell Sans", sans-serif',
              fontSize: { xs: "14px", sm: "16px" },
              px: { xs: 0.2, sm: 1 },
              ml: { xs: "auto", sm: 0 },
              minHeight: isCompact ? 36 : "auto",
              display: { xs: "none", sm: "inline-flex" },
              transition: "opacity 160ms ease",
              "&:hover": {
                textDecoration: "underline !important",
                textUnderlineOffset: "3px",
                opacity: 0.9,
              },
            }}
          >
            Open in Pollerama
          </Button>
        </Stack>
      </Stack>
      </Paper>
    </Box>
    </>
  );
}
