import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Select,
  MenuItem,
  TextField,
  Tabs,
  Tab,
  List,
  ListItemButton,
  ListItemText,
  IconButton,
  Alert,
  CircularProgress,
  Divider,
  Chip,
  InputLabel,
  FormControl,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import {
  BUILTIN_MODELS,
  SUPPORTED_LANGUAGES,
  formatBytes,
  searchHuggingFace,
  customToModelInfo,
  type HFModelResult,
  clearCachedModel,
  clearAllCachedModels,
} from "../../lib/dictation";
import { loadPrefs, savePrefs } from "../../lib/dictation/prefs";
import type {
  CustomModelEntry,
  DictationPrefs,
} from "../../lib/dictation/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

function makeCustomId(url: string): `custom:${string}` {
  const slug = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .slice(0, 80);
  return `custom:${slug}-${Date.now().toString(36)}`;
}

export default function DictationSettingsDialog({ open, onClose }: Props) {
  const [prefs, setPrefs] = useState<DictationPrefs | null>(null);
  const [tab, setTab] = useState<"models" | "discover" | "custom">("models");
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<HFModelResult[]>([]);
  const [customUrl, setCustomUrl] = useState("");
  const [customLabel, setCustomLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    loadPrefs().then(setPrefs);
  }, [open]);

  const update = async (patch: Partial<DictationPrefs>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await savePrefs(next);
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const res = await searchHuggingFace(searchTerm);
      setSearchResults(res);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const addCustomFromResult = async (r: HFModelResult) => {
    if (!prefs) return;
    const id = makeCustomId(r.url);
    const entry: CustomModelEntry = {
      id,
      label: `${r.repoId} (${r.filename})`,
      url: r.url,
      sizeBytes: r.sizeBytes,
      englishOnly: r.language === "en",
    };
    await update({
      customModels: [...prefs.customModels, entry],
      modelId: id,
      setupComplete: false,
    });
    setTab("models");
  };

  const addCustomFromUrl = async () => {
    if (!prefs || !customUrl.trim()) return;
    const id = makeCustomId(customUrl);
    const entry: CustomModelEntry = {
      id,
      label: customLabel.trim() || customUrl,
      url: customUrl.trim(),
      sizeBytes: 0,
      englishOnly: false,
    };
    await update({
      customModels: [...prefs.customModels, entry],
      modelId: id,
      setupComplete: false,
    });
    setCustomUrl("");
    setCustomLabel("");
    setTab("models");
  };

  const removeCustom = async (id: string) => {
    if (!prefs) return;
    const remaining = prefs.customModels.filter((m) => m.id !== id);
    const next: DictationPrefs = { ...prefs, customModels: remaining };
    if (prefs.modelId === id) next.modelId = "tiny.en";
    setPrefs(next);
    await savePrefs(next);
  };

  const clearCurrent = async () => {
    if (!prefs) return;
    let url: string | null = null;
    let storageKey: string | null = null;
    if (prefs.modelId.startsWith("custom:")) {
      const entry = prefs.customModels.find((m) => m.id === prefs.modelId);
      if (entry) {
        const info = customToModelInfo(entry);
        url = info.url;
        storageKey = info.storageKey;
      }
    } else {
      const info = BUILTIN_MODELS[prefs.modelId as keyof typeof BUILTIN_MODELS];
      if (info) {
        url = info.url;
        storageKey = info.storageKey;
      }
    }
    if (!url || !storageKey) return;
    await clearCachedModel(url, storageKey);
    await update({ setupComplete: false });
  };

  const clearAll = async () => {
    await clearAllCachedModels();
    await update({ setupComplete: false });
  };

  const allModels = useMemo(() => {
    if (!prefs) return [];
    return [
      ...Object.values(BUILTIN_MODELS).map((m) => ({
        id: m.id,
        label: m.label,
        sub: `${formatBytes(m.sizeBytes)} • ${m.englishOnly ? "English" : "Multilingual"}`,
        custom: false,
      })),
      ...prefs.customModels.map((m) => ({
        id: m.id,
        label: m.label,
        sub: m.sizeBytes ? formatBytes(m.sizeBytes) : "Custom",
        custom: true,
      })),
    ];
  }, [prefs]);

  if (!prefs) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogContent sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Dictation settings</DialogTitle>
      <DialogContent dividers>
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id="dictation-lang-label">Language</InputLabel>
          <Select
            labelId="dictation-lang-label"
            label="Language"
            value={prefs.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <MenuItem key={l.code} value={l.code}>
                {l.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ mb: 2, minHeight: 36 }}
          variant="fullWidth"
        >
          <Tab value="models" label="Models" sx={{ minHeight: 36 }} />
          <Tab value="discover" label="Discover" sx={{ minHeight: 36 }} />
          <Tab value="custom" label="Custom URL" sx={{ minHeight: 36 }} />
        </Tabs>

        {tab === "models" && (
          <Box>
            <List dense disablePadding>
              {allModels.map((m) => (
                <ListItemButton
                  key={m.id}
                  selected={prefs.modelId === m.id}
                  onClick={() =>
                    update({ modelId: m.id, setupComplete: false })
                  }
                >
                  <ListItemText primary={m.label} secondary={m.sub} />
                  {m.custom && (
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustom(m.id);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </ListItemButton>
              ))}
            </List>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="small" onClick={clearCurrent}>
                Clear current model cache
              </Button>
              <Button size="small" color="error" onClick={clearAll}>
                Clear all
              </Button>
            </Box>
          </Box>
        )}

        {tab === "discover" && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Search HuggingFace for community whisper.cpp models. These are
              uploaded by third parties — use at your own discretion.
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="e.g. hindi, japanese, medical…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button
                onClick={handleSearch}
                variant="contained"
                disabled={searching}
                startIcon={searching ? <CircularProgress size={14} /> : <SearchIcon />}
              >
                Search
              </Button>
            </Box>
            {searchError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {searchError}
              </Alert>
            )}
            {!searching && !searchResults.length && !searchError && (
              <Typography variant="caption" color="text.secondary">
                No results yet — try a language or topic.
              </Typography>
            )}
            <List dense disablePadding>
              {searchResults.map((r) => (
                <ListItemButton
                  key={`${r.repoId}/${r.filename}`}
                  onClick={() => addCustomFromResult(r)}
                >
                  <ListItemText
                    primary={`${r.repoId} — ${r.filename}`}
                    secondary={
                      <>
                        {r.sizeBytes ? formatBytes(r.sizeBytes) : "size unknown"} •{" "}
                        {r.downloads.toLocaleString()} downloads
                        {r.language ? ` • ${r.language}` : ""}
                      </>
                    }
                  />
                  <Chip size="small" label="Add" />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )}

        {tab === "custom" && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Add a direct URL to a whisper.cpp-compatible GGML model.
            </Typography>
            <TextField
              fullWidth
              size="small"
              label="Model URL"
              placeholder="https://…/ggml-base-fr-q5_1.bin"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              sx={{ mb: 1 }}
            />
            <TextField
              fullWidth
              size="small"
              label="Label (optional)"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Button
              variant="contained"
              onClick={addCustomFromUrl}
              disabled={!customUrl.trim()}
            >
              Add model
            </Button>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
