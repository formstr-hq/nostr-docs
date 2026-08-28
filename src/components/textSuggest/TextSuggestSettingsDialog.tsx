import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Box,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { AddGGUFModelSection } from "./settings/AddGGUFModelSection";
import { AIWritingFeatureSettings } from "./settings/AIWritingFeatureSettings";
import { ConfiguredModelList } from "./settings/ConfiguredModelList";
import { SuggestionBehaviorSettings } from "./settings/SuggestionBehaviorSettings";
import { useTextSuggestSettings } from "./settings/useTextSuggestSettings";
import type { ProofreadStatus } from "../../hooks/textSuggest/useProofreadRequest";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  documentLength: number;
  proofreadStatus: ProofreadStatus;
  onProofread: (instruction: string) => Promise<void>;
  onCancelProofread: () => void;
}

export default function TextSuggestSettingsDialog({
  open,
  onClose,
  onSaved,
  documentLength,
  proofreadStatus,
  onProofread,
  onCancelProofread,
}: Props) {
  const [modelSettingsExpanded, setModelSettingsExpanded] = useState(false);
  const settings = useTextSuggestSettings(open, onSaved);
  const { prefs } = settings;

  useEffect(() => {
    if (!open) setModelSettingsExpanded(false);
  }, [open]);

  useEffect(() => {
    if (prefs?.activeModelId) setModelSettingsExpanded(false);
  }, [prefs?.activeModelId]);

  if (!prefs) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogContent sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </DialogContent>
      </Dialog>
    );
  }

  const activeModel = prefs.models.find(
    (model) => model.id === prefs.activeModelId,
  );

  return (
    <Dialog
      open={open}
      onClose={proofreadStatus.kind === "running" ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Local AI writing</DialogTitle>
      <DialogContent>
        <AIWritingFeatureSettings
          prefs={prefs}
          onPatch={(patch) => void settings.patchPrefs(patch)}
          documentLength={documentLength}
          proofreadStatus={proofreadStatus}
          onProofread={onProofread}
          onCancelProofread={onCancelProofread}
        />
        <Accordion
          expanded={modelSettingsExpanded}
          onChange={(_, expanded) => setModelSettingsExpanded(expanded)}
          disableGutters
          elevation={0}
          slotProps={{ transition: { unmountOnExit: true } }}
          sx={{
            mt: 0.5,
            backgroundColor: "transparent",
            color: "inherit",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: (theme) =>
              `${Number(theme.shape.borderRadius) * 2}px !important`,
            overflow: "hidden",
            "&:before": { display: "none" },
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="local-ai-model-settings-content"
            id="local-ai-model-settings-header"
            sx={{
              minHeight: 56,
              backgroundColor: "transparent !important",
              "& .MuiAccordionSummary-content": { my: 1 },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2">Model setup</Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ display: "block" }}
              >
                {activeModel
                  ? `Active: ${activeModel.label}`
                  : modelSettingsExpanded
                    ? "No models selected"
                    : "No model selected — expand to get one"}
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails id="local-ai-model-settings-content" sx={{ pt: 0 }}>
            <Box
              component="fieldset"
              disabled={proofreadStatus.kind === "running"}
              sx={{ m: 0, p: 0, minWidth: 0, border: 0 }}
            >
              <ConfiguredModelList
                prefs={prefs}
                busyId={settings.busyId}
                onSelect={(id) => void settings.selectModel(id)}
                onRemove={(id) => void settings.removeModel(id)}
              />
              <SuggestionBehaviorSettings
                prefs={prefs}
                onPreview={settings.previewPrefs}
                onCommit={(patch) => void settings.patchPrefs(patch)}
              />
              <Divider sx={{ mb: 2 }} />
              <AddGGUFModelSection
                loading={settings.loading}
                progress={settings.loadingProgress}
                onFile={settings.addModelFromFile}
                onCancel={settings.cancelLoading}
              />
            </Box>
          </AccordionDetails>
        </Accordion>
        {settings.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {settings.error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={proofreadStatus.kind === "running"}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
