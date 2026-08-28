import { useState } from "react";
import { IconButton, Tooltip, CircularProgress, Box } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import AutoFixOffIcon from "@mui/icons-material/AutoFixOff";
import type { TextSuggestState } from "../../lib/textSuggest/types";
import TextSuggestSettingsDialog from "./TextSuggestSettingsDialog";
import type { ProofreadStatus } from "../../hooks/textSuggest/useProofreadRequest";

interface Props {
  state: TextSuggestState;
  enabled: boolean;
  onSettingsSaved: () => void | Promise<void>;
  documentLength: number;
  proofreadStatus: ProofreadStatus;
  onProofread: (instruction: string) => Promise<void>;
  onCancelProofread: () => void;
  size?: "small" | "medium";
}

export default function TextSuggestButton({
  state,
  enabled,
  onSettingsSaved,
  documentLength,
  proofreadStatus,
  onProofread,
  onCancelProofread,
  size = "small",
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  let tooltip = "AI writing settings";
  let icon = <AutoFixOffIcon fontSize={size} />;
  let color: "default" | "primary" | "error" = "default";
  let busy = false;

  if (enabled) {
    icon = <AutoFixHighIcon fontSize={size} />;
    color = "primary";
    if (state.kind === "loading") {
      busy = true;
      tooltip = "Loading suggestion model…";
    } else if (state.kind === "downloading") {
      busy = true;
      const pct = state.total ? Math.round((state.bytes / state.total) * 100) : null;
      tooltip = pct !== null ? `Downloading model… ${pct}%` : "Downloading model…";
    } else if (state.kind === "thinking") {
      tooltip = "Thinking…";
    } else if (state.kind === "error") {
      color = "error";
      tooltip = state.message;
    } else if (state.kind === "needs-setup") {
      tooltip = "Set up a model to start suggesting";
    } else {
      tooltip = "Local AI writing tools on — click to configure";
    }
  }

  const handleClick = () => {
    setSettingsOpen(true);
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <Box component="span" sx={{ position: "relative", display: "inline-flex" }}>
          <IconButton
            size={size}
            onClick={handleClick}
            color={color}
            disabled={busy}
            aria-label="AI writing settings"
          >
            {busy ? <CircularProgress size={18} /> : icon}
          </IconButton>
        </Box>
      </Tooltip>
      <TextSuggestSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={onSettingsSaved}
        documentLength={documentLength}
        proofreadStatus={proofreadStatus}
        onProofread={async (instruction) => {
          await onProofread(instruction);
          setSettingsOpen(false);
        }}
        onCancelProofread={onCancelProofread}
      />
    </>
  );
}
