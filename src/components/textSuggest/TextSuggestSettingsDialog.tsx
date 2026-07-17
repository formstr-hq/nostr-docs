import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  List,
  ListItemButton,
  ListItemText,
  IconButton,
  Alert,
  Divider,
  Switch,
  FormControlLabel,
  Slider,
  CircularProgress,
  LinearProgress,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { loadPrefs, savePrefs } from "../../lib/textSuggest/prefs";
import { makeModelId } from "../../lib/textSuggest/modelCatalog";
import { textSuggestService } from "../../lib/textSuggest/wllamaService";
import type {
  TextSuggestModelEntry,
  TextSuggestModelId,
  TextSuggestPrefs,
} from "../../lib/textSuggest/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after prefs are saved, so the parent's useTextSuggest hook can reload. */
  onSaved?: () => void;
}

export default function TextSuggestSettingsDialog({ open, onClose, onSaved }: Props) {
  const [prefs, setPrefs] = useState<TextSuggestPrefs | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ bytes: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    loadPrefs().then((p) => {
      setError(null);
      setPrefs(p);
    });
  }, [open]);

  const persist = async (next: TextSuggestPrefs) => {
    setPrefs(next);
    await savePrefs(next);
    onSaved?.();
  };

  const patchPrefs = async (patch: Partial<TextSuggestPrefs>) => {
    if (!prefs) return;
    await persist({ ...prefs, ...patch });
  };

  const addModelFromFile = async (file: File) => {
    if (!prefs) return;
    setError(null);
    setLoading(true);
    setLoadingProgress({ bytes: 0, total: 100 });
    const objectUrl = URL.createObjectURL(file);
    const entry: TextSuggestModelEntry = {
      id: makeModelId(objectUrl),
      label: file.name,
      url: objectUrl,
    };

    try {
      await textSuggestService.ensureLoadedFromFile(file, entry, (progress) => {
        setLoadingProgress(progress);
      });
      await persist({
        ...prefs,
        models: [...prefs.models, entry],
        activeModelId: entry.id,
        enabled: true,
      });
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      setError(err instanceof Error ? err.message : "Failed to add model");
    } finally {
      setLoading(false);
      setLoadingProgress(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await addModelFromFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const selectModel = async (id: TextSuggestModelId) => {
    if (!prefs) return;
    await persist({ ...prefs, activeModelId: id });
  };

  const removeModel = async (id: TextSuggestModelId) => {
    if (!prefs) return;
    setBusyId(id);
    try {
      await textSuggestService.unload();
      const remaining = prefs.models.filter((m) => m.id !== id);
      await persist({
        ...prefs,
        models: remaining,
        activeModelId:
          prefs.activeModelId === id
            ? remaining[0]?.id ?? null
            : prefs.activeModelId,
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (!prefs) return;
    await persist({ ...prefs, enabled });
  };

  if (!prefs) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogContent sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Text suggestions</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          As you type, a local AI model suggests the next few words as a plain
          continuation of your document. Press{" "}
          <strong>Tab</strong> or tap the ghost text to accept,{" "}
          <strong>Esc</strong> to dismiss.
        </Typography>

        <FormControlLabel
          sx={{ mb: 2 }}
          control={
            <Switch
              checked={prefs.enabled}
              onChange={(e) => toggleEnabled(e.target.checked)}
            />
          }
          label="Enable text suggestions"
        />

        <Divider sx={{ mb: 2 }} />

        <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          Your models
        </Typography>

        {prefs.models.length === 0 ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            No model configured yet.
          </Alert>
        ) : (
          <List dense disablePadding sx={{ mb: 2 }}>
            {prefs.models.map((m) => {
              const isActive = prefs.activeModelId === m.id;
              return (
                <ListItemButton
                  key={m.id}
                  selected={isActive}
                  onClick={() => selectModel(m.id)}
                  sx={{ borderRadius: 1 }}
                >
                  {isActive ? (
                    <CheckCircleIcon fontSize="small" color="primary" sx={{ mr: 1.5 }} />
                  ) : (
                    <RadioButtonUncheckedIcon fontSize="small" sx={{ mr: 1.5, opacity: 0.4 }} />
                  )}
                  <ListItemText
                    primary={m.label}
                    secondary={m.url}
                    secondaryTypographyProps={{
                      sx: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                    }}
                  />
                  <IconButton
                    edge="end"
                    size="small"
                    disabled={busyId === m.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeModel(m.id);
                    }}
                    title="Remove model"
                  >
                    {busyId === m.id ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                  </IconButton>
                </ListItemButton>
              );
            })}
          </List>
        )}

        <Divider sx={{ mb: 2 }} />

        <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          Add a model
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Load a .gguf file.
        </Typography>
        <Box>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gguf"
            onChange={handleFileSelect}
            style={{ display: "none" }}
            disabled={loading}
          />
          <Button
            variant="contained"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            Load GGUF file
          </Button>
        </Box>

        {loading && loadingProgress && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Loading model… {Math.round((loadingProgress.bytes / loadingProgress.total) * 100)}%
            </Typography>
            <LinearProgress
              variant={loadingProgress.total > 0 ? "determinate" : "indeterminate"}
              value={loadingProgress.total > 0 ? (loadingProgress.bytes / loadingProgress.total) * 100 : undefined}
            />
          </Box>
        )}

        {prefs.models.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Behavior
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Suggest after pausing for {prefs.debounceMs} ms
            </Typography>
            <Slider
              size="small"
              min={200}
              max={1500}
              step={100}
              value={prefs.debounceMs}
              onChange={(_, v) =>
                setPrefs((p) => (p ? { ...p, debounceMs: v as number } : p))
              }
              onChangeCommitted={(_, v) =>
                void patchPrefs({ debounceMs: v as number })
              }
              sx={{ mb: 2 }}
            />
            <Typography variant="caption" color="text.secondary">
              Suggestion length: up to {prefs.maxTokens} tokens
            </Typography>
            <Slider
              size="small"
              min={8}
              max={128}
              step={8}
              value={prefs.maxTokens}
              onChange={(_, v) =>
                setPrefs((p) => (p ? { ...p, maxTokens: v as number } : p))
              }
              onChangeCommitted={(_, v) =>
                void patchPrefs({ maxTokens: v as number })
              }
            />
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
