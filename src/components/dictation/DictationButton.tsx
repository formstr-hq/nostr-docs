import { useState, useEffect, useCallback } from "react";
import {
  Box,
  IconButton,
  Tooltip,
  CircularProgress,
  Snackbar,
  Alert,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import StopIcon from "@mui/icons-material/Stop";
import { useDictation } from "../../hooks/useDictation";
import DictationSetupDialog from "./DictationSetupDialog";

interface Props {
  onTranscript: (text: string) => void;
  size?: "small" | "medium";
  tooltip?: string;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DictationButton({
  onTranscript,
  size = "small",
  tooltip = "Dictate",
}: Props) {
  const [noSpeechOpen, setNoSpeechOpen] = useState(false);
  const { state, prefs, start, stop, cancel, reload } = useDictation({
    onTranscript,
    onNoSpeech: () => setNoSpeechOpen(true),
  });
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const setupOpen = state.kind === "needs-setup" && !setupDismissed;

  useEffect(() => {
    if (state.kind !== "recording") return;
    const startedAt = state.startedAt;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [state]);

  const handleClick = useCallback(async () => {
    if (state.kind === "idle" || state.kind === "error") {
      setSetupDismissed(false);
      await start();
    } else if (state.kind === "recording") {
      await stop();
    } else if (state.kind === "needs-permission") {
      await start();
    } else if (state.kind === "needs-setup") {
      setSetupDismissed(false);
    }
  }, [state, start, stop]);

  const handleSetupClose = useCallback(
    async (didSetup: boolean) => {
      setSetupDismissed(true);
      await reload();
      if (didSetup) await start();
    },
    [reload, start],
  );

  let icon = <MicIcon fontSize={size} />;
  let color: "default" | "error" | "secondary" = "default";
  let tooltipText = tooltip;
  let busy = false;

  if (state.kind === "recording") {
    icon = <StopIcon fontSize={size} />;
    color = "error";
    tooltipText = `Stop (${formatElapsed(elapsed)})`;
  } else if (state.kind === "transcribing" || state.kind === "loading") {
    busy = true;
    tooltipText =
      state.kind === "loading" ? "Loading model…" : "Transcribing…";
  } else if (state.kind === "downloading") {
    busy = true;
    const pct = state.total
      ? Math.round((state.bytes / state.total) * 100)
      : null;
    tooltipText = pct !== null ? `Downloading ${pct}%` : "Downloading…";
  } else if (state.kind === "needs-permission") {
    icon = <MicOffIcon fontSize={size} />;
    color = "error";
    tooltipText = "Microphone permission needed";
  } else if (state.kind === "needs-setup") {
    tooltipText = "Set up dictation";
  } else if (state.kind === "error") {
    icon = <MicOffIcon fontSize={size} />;
    color = "error";
    tooltipText = state.message;
  }

  return (
    <>
      <Tooltip title={tooltipText}>
        <Box
          component="span"
          sx={{ position: "relative", display: "inline-flex" }}
          onContextMenu={(e) => {
            if (state.kind === "recording") {
              e.preventDefault();
              cancel();
            }
          }}
        >
          <IconButton
            size={size}
            onClick={handleClick}
            color={color}
            disabled={busy}
            sx={
              state.kind === "recording"
                ? {
                    animation: "dictation-pulse 1.2s ease-in-out infinite",
                    "@keyframes dictation-pulse": {
                      "0%, 100%": { opacity: 1 },
                      "50%": { opacity: 0.5 },
                    },
                  }
                : undefined
            }
          >
            {busy ? <CircularProgress size={18} /> : icon}
          </IconButton>
          {state.kind === "recording" && (
            <Box
              sx={{
                position: "absolute",
                left: "50%",
                bottom: -2,
                transform: "translateX(-50%)",
                width: 24,
                height: 2,
                bgcolor: "error.main",
                opacity: 0.3 + state.level * 0.7,
                borderRadius: 1,
                pointerEvents: "none",
              }}
            />
          )}
        </Box>
      </Tooltip>
      <DictationSetupDialog
        open={setupOpen}
        prefs={prefs}
        onClose={handleSetupClose}
      />
      <Snackbar
        open={noSpeechOpen}
        autoHideDuration={3000}
        onClose={() => setNoSpeechOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="info" sx={{ width: "100%" }} variant="filled">
          No speech detected
        </Alert>
      </Snackbar>
    </>
  );
}
