import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert,
  LinearProgress,
} from "@mui/material";
import {
  resolveModel,
  pickDefaultModel,
  BUILTIN_MODELS,
  formatBytes,
  getModelBytes,
} from "../../lib/dictation";
import { savePrefs } from "../../lib/dictation/prefs";
import type { DictationPrefs } from "../../lib/dictation/types";
import { isCapacitor } from "../../signer/secureStorage";

interface Props {
  open: boolean;
  prefs: DictationPrefs | null;
  onClose: (didSetup: boolean) => void;
}

export default function DictationSetupDialog({
  open,
  prefs,
  onClose,
}: Props) {
  const [networkType, setNetworkType] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ bytes: number; total: number }>({
    bytes: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const model =
    (prefs && resolveModel(prefs.modelId, prefs.customModels)) ??
    BUILTIN_MODELS[pickDefaultModel()];

  useEffect(() => {
    if (!open || !isCapacitor) return;
    let alive = true;
    (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const status = await Network.getStatus();
        if (alive) setNetworkType(status.connectionType);
      } catch {
        // ignore — fall through with no warning
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const handleDownload = async () => {
    if (!prefs) return;
    setDownloading(true);
    setError(null);
    try {
      await getModelBytes(model.url, model.storageKey, (p) => {
        setProgress({ bytes: p.bytes, total: p.total });
      });
      await savePrefs({ ...prefs, setupComplete: true });
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const onCellular =
    networkType === "cellular" || networkType === "2g" || networkType === "3g";

  const pct = progress.total
    ? Math.round((progress.bytes / progress.total) * 100)
    : null;

  return (
    <Dialog open={open} onClose={() => !downloading && onClose(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Set up dictation</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Dictation runs entirely on your device. To get started, download the
          speech recognition model:
        </Typography>
        <Box
          sx={{
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            mb: 2,
          }}
        >
          <Typography variant="body2" fontWeight={600}>
            {model.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatBytes(model.sizeBytes)} • one-time download
          </Typography>
        </Box>
        {onCellular && !downloading && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            You're on cellular data — this download is {formatBytes(model.sizeBytes)}.
          </Alert>
        )}
        {downloading && (
          <Box sx={{ mb: 1 }}>
            <LinearProgress
              variant={pct === null ? "indeterminate" : "determinate"}
              value={pct ?? 0}
            />
            <Typography variant="caption" color="text.secondary">
              {pct !== null
                ? `${pct}% • ${formatBytes(progress.bytes)} / ${formatBytes(progress.total)}`
                : `${formatBytes(progress.bytes)} downloaded`}
            </Typography>
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary">
          You can change the model later in Dictation Settings.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)} disabled={downloading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleDownload}
          disabled={downloading || !prefs}
        >
          {downloading ? "Downloading…" : "Download"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
