import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Popover,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SyncIcon from "@mui/icons-material/Sync";
import type { Event } from "nostr-tools";
import {
  checkRelayPresence,
  clearRelayPresence,
  relayHost,
} from "../nostr/relayPresence";
import { publishEvent } from "../nostr/publish";

const GREEN = "#34D399";
const AMBER = "#F59E0B";

/**
 * Relay coverage for a page: shows how many of the user's relays hold it and,
 * on click, which ones. When none do, it shows a warning and offers a
 * re-broadcast. Only meaningful for signed pages — the caller skips device-only
 * (unsigned) documents.
 */
export default function RelayPresenceIndicator({
  event,
  relays,
  disabled = false,
}: {
  event: Event | null;
  relays: string[];
  disabled?: boolean;
}) {
  const [present, setPresent] = useState<string[] | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [rebroadcasting, setRebroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!event || disabled) {
      setPresent(null);
      return;
    }
    setPresent(null);
    checkRelayPresence(event, relays)
      .then((result) => {
        if (!cancelled) setPresent(result);
      })
      .catch(() => {
        if (!cancelled) setPresent([]);
      });
    return () => {
      cancelled = true;
    };
  }, [event, relays, disabled]);

  const checking = present === null;
  const missing = !checking && present.length === 0;
  const label = checking
    ? "Checking relays…"
    : missing
    ? "Not on any relay"
    : `On ${present.length} of ${relays.length} relay${relays.length === 1 ? "" : "s"}`;

  const handleRebroadcast = async () => {
    if (!event || rebroadcasting) return;
    setRebroadcasting(true);
    setError(null);
    try {
      await publishEvent(event, relays);
      clearRelayPresence(event);
      const fresh = await checkRelayPresence(event, relays, { force: true });
      setPresent(fresh);
    } catch (err) {
      console.error("Re-broadcast failed:", err);
      setError("Re-broadcast failed. Check your connection and try again.");
    } finally {
      setRebroadcasting(false);
    }
  };

  return (
    <>
      <Tooltip title={label}>
        <Box
          role="button"
          tabIndex={0}
          aria-label={`Relay status: ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setAnchorEl(e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setAnchorEl(e.currentTarget);
            }
          }}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.3,
            px: 0.4,
            py: 0.2,
            borderRadius: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: (t) => alpha(t.palette.text.primary, 0.06) },
          }}
        >
          {checking ? (
            <Box sx={{ display: "inline-flex", gap: 0.3 }}>
              <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "text.disabled", opacity: 0.5 }} />
              <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "text.disabled", opacity: 0.5 }} />
            </Box>
          ) : missing ? (
            <WarningAmberIcon sx={{ fontSize: 15, color: AMBER }} />
          ) : (
            <Box sx={{ display: "inline-flex", gap: 0.3 }}>
              {Array.from({ length: Math.min(present.length, 3) }).map((_, i) => (
                <Box key={i} sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: GREEN }} />
              ))}
            </Box>
          )}
        </Box>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label": "Relay status",
            sx: {
              mt: -1,
              p: 1.5,
              width: 280,
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: "divider",
              backgroundImage: "none",
            },
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "text.disabled" }}>
            Relays
          </Typography>
          {!checking && (
            <Chip
              label={missing ? "Not synced" : `${present.length}/${relays.length}`}
              size="small"
              sx={{
                height: 18,
                fontSize: "0.62rem",
                fontWeight: 700,
                bgcolor: alpha(missing ? AMBER : GREEN, 0.15),
                color: missing ? AMBER : "#0f9d6b",
              }}
            />
          )}
        </Box>

        {missing && (
          <Alert severity="warning" sx={{ mb: 1, py: 0.25, fontSize: "0.72rem" }}>
            None of your relays have this page.
          </Alert>
        )}

        {checking ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 1.5 }}>
            <CircularProgress size={18} />
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mb: 1 }}>
            {relays.map((relay) => {
              const has = present.includes(relay);
              return (
                <Box key={relay} sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                  {has ? (
                    <CheckCircleIcon sx={{ fontSize: 14, color: GREEN, flexShrink: 0 }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: "text.disabled", flexShrink: 0 }} />
                  )}
                  <Typography variant="caption" noWrap sx={{ fontSize: "0.72rem", color: has ? "text.primary" : "text.secondary" }}>
                    {relayHost(relay)}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 1, py: 0.25, fontSize: "0.72rem" }}>
            {error}
          </Alert>
        )}

        <Divider sx={{ mb: 1 }} />
        <Button
          fullWidth
          size="small"
          variant={missing ? "contained" : "outlined"}
          color={missing ? "warning" : "secondary"}
          disabled={rebroadcasting || !event}
          onClick={handleRebroadcast}
          startIcon={
            rebroadcasting ? <CircularProgress size={14} color="inherit" /> : <SyncIcon sx={{ fontSize: 16 }} />
          }
          sx={{ textTransform: "none", fontWeight: 700, fontSize: "0.78rem" }}
        >
          {rebroadcasting ? "Re-broadcasting…" : "Re-broadcast to relays"}
        </Button>
      </Popover>
    </>
  );
}
