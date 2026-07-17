import { useState } from "react";
import { IconButton, Tooltip, CircularProgress, Box } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import AutoFixOffIcon from "@mui/icons-material/AutoFixOff";
import type { TextSuggestState } from "../../lib/textSuggest/types";
import TextSuggestSettingsDialog from "./TextSuggestSettingsDialog";

interface Props {
  state: TextSuggestState;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  onSettingsSaved: () => void;
  size?: "small" | "medium";
}

export default function TextSuggestButton({
  state,
  enabled,
  onToggle,
  onSettingsSaved,
  size = "small",
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  let tooltip = "Enable AI text suggestions";
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
      tooltip = "AI text suggestions on — click to configure";
    }
  }

  const handleClick = () => {
    if (!enabled) {
      onToggle(true);
      return;
    }
    if (state.kind === "needs-setup") {
      setSettingsOpen(true);
      return;
    }
    // Already enabled & configured — a normal click opens settings; long
    // press / right click isn't needed since toggling off is one extra click
    // away inside the dialog (keeps a single, discoverable affordance).
    setSettingsOpen(true);
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <Box component="span" sx={{ position: "relative", display: "inline-flex" }}>
          <IconButton size={size} onClick={handleClick} color={color} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : icon}
          </IconButton>
        </Box>
      </Tooltip>
      <TextSuggestSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={onSettingsSaved}
      />
    </>
  );
}
