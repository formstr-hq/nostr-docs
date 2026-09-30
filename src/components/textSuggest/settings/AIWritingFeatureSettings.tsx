import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { TextSuggestPrefs } from "../../../lib/textSuggest/types";
import {
  MAX_PROOFREAD_DOCUMENT_CHARS,
  MAX_PROOFREAD_INSTRUCTION_CHARS,
} from "../../../lib/textSuggest/types";
import type { ProofreadStatus } from "../../../hooks/textSuggest/useProofreadRequest";
import { RuntimeCapabilities } from "../RuntimeCapabilities";

interface Props {
  prefs: TextSuggestPrefs;
  onPatch: (patch: Partial<TextSuggestPrefs>) => void;
  documentLength: number;
  proofreadStatus: ProofreadStatus;
  onProofread: (instruction: string) => Promise<void>;
  onCancelProofread: () => void;
}

const PROOFREAD_PRESETS = [
  "Fix spelling, grammar, and punctuation without changing my tone or Markdown formatting.",
  "Improve clarity while preserving my meaning.",
  "Make this more concise.",
];

export function AIWritingFeatureSettings({
  prefs,
  onPatch,
  documentLength,
  proofreadStatus,
  onProofread,
  onCancelProofread,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [proofreadExpanded, setProofreadExpanded] = useState(false);
  const running = proofreadStatus.kind === "running";
  const hasModel = prefs.activeModelId !== null;
  const documentTooLong = documentLength > MAX_PROOFREAD_DOCUMENT_CHARS;

  const submit = async () => {
    if (!instruction.trim() || running) return;
    setSubmitError(null);
    try {
      await onProofread(instruction.trim());
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A local AI model can suggest the next few words while you type. Press
        <strong> Tab</strong> or tap the ghost text to accept, <strong>Esc</strong>{" "}
        to dismiss. You can also give the proofreader any revision instruction
        below.
      </Typography>

      <RuntimeCapabilities />
      <FormControlLabel
        sx={{ mb: 0.5 }}
        control={
          <Switch
            checked={prefs.enabled}
            disabled={running}
            onChange={(event) => onPatch({ enabled: event.target.checked })}
          />
        }
        label="Enable text suggestions"
      />
      <Box
        component="section"
        aria-labelledby="proofread-document-heading"
        sx={{
          mt: 1.5,
          mb: 2,
          p: 2,
          position: "relative",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
        }}
      >
        {running && (
          <Box
            aria-hidden="true"
            className="proofread-border-orbit"
            data-testid="proofread-border-orbit"
            sx={{ color: (theme) => theme.palette.secondary.main }}
          />
        )}
        <ButtonBase
          aria-expanded={proofreadExpanded}
          aria-controls="proofread-document-content"
          disabled={running}
          onClick={() => setProofreadExpanded((expanded) => !expanded)}
          sx={{
            width: "100%",
            justifyContent: "space-between",
            borderRadius: 1,
            textAlign: "left",
          }}
        >
          <Typography id="proofread-document-heading" variant="subtitle2">
            Proofread document
          </Typography>
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              ml: 1,
              color: "text.secondary",
              transform: proofreadExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: (theme) =>
                theme.transitions.create("transform", {
                  duration: theme.transitions.duration.shortest,
                }),
            }}
          />
        </ButtonBase>
        <Collapse in={proofreadExpanded} timeout="auto">
          <Box id="proofread-document-content" sx={{ pt: 0.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1.5 }}
            >
              Tell the local model what to do. It will review the complete
              document, then show a diff you can accept or reject. Use “Fix
              spelling, grammar, and punctuation” for autocorrection without
              changing your tone or Markdown formatting.
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="What should the proofreader do?"
              placeholder="For example: Fix spelling, grammar, and punctuation without changing my tone or Markdown formatting."
              value={instruction}
              slotProps={{
                htmlInput: { maxLength: MAX_PROOFREAD_INSTRUCTION_CHARS },
              }}
              disabled={running}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1 }}>
              {PROOFREAD_PRESETS.map((preset) => (
                <Chip
                  key={preset}
                  size="small"
                  variant="outlined"
                  label={preset.split(" without")[0].replace(/\.$/, "")}
                  disabled={running}
                  onClick={() => setInstruction(preset)}
                />
              ))}
            </Box>

            {!hasModel && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                Open Model setup below and choose a downloaded GGUF before
                proofreading.
              </Alert>
            )}
            {documentLength === 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1.5 }}
              >
                Start writing before proofreading.
              </Typography>
            )}
            {documentTooLong && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                This document is over the{" "}
                {MAX_PROOFREAD_DOCUMENT_CHARS.toLocaleString()}-character limit
                for one local proofreading pass. Shorten it before reviewing;
                the document will never be silently truncated.
              </Alert>
            )}
            {(submitError ||
              (proofreadStatus.kind === "error" &&
                proofreadStatus.message)) && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {submitError ??
                  (proofreadStatus.kind === "error"
                    ? proofreadStatus.message
                    : "")}
              </Alert>
            )}

            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
                mt: 1.5,
              }}
            >
              {running && <Button onClick={onCancelProofread}>Cancel</Button>}
              <Button
                variant="contained"
                color="secondary"
                disabled={
                  !instruction.trim() ||
                  !documentLength ||
                  documentTooLong ||
                  !hasModel ||
                  running
                }
                onClick={() => void submit()}
                startIcon={
                  running ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : undefined
                }
              >
                {running ? "Proofreading locally…" : "Review changes"}
              </Button>
            </Box>
          </Box>
        </Collapse>
      </Box>
    </>
  );
}
