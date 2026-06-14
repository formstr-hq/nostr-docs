import { useEffect, useMemo, useRef, useState } from "react";
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
  LinearProgress,
  Divider,
  Chip,
  InputLabel,
  FormControl,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  BUILTIN_MODELS,
  SUPPORTED_LANGUAGES,
  formatBytes,
  searchHuggingFace,
  customToModelInfo,
  type HFModelResult,
  clearCachedModel,
  clearAllCachedModels,
  hasCachedModel,
  getModelBytes,
  storeModelBytes,
} from "../../lib/dictation";
import { loadPrefs, savePrefs } from "../../lib/dictation/prefs";
import type {
  BuiltinModelId,
  CustomModelEntry,
  DictationModelId,
  DictationPrefs,
  ModelInfo,
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
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<HFModelResult[]>([]);
  const [customUrl, setCustomUrl] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    bytes: number;
    total: number;
  }>({ bytes: 0, total: 0 });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    loadPrefs().then(setPrefs);
  }, [open]);

  useEffect(() => {
    if (!open || !prefs) return;
    let cancelled = false;
    const checks: Promise<[string, boolean]>[] = [];
    for (const m of Object.values(BUILTIN_MODELS)) {
      checks.push(
        hasCachedModel(m.url, m.storageKey).then((v) => [m.id, v]),
      );
    }
    for (const m of prefs.customModels) {
      const info = customToModelInfo(m);
      checks.push(
        hasCachedModel(info.url, info.storageKey).then((v) => [m.id, v]),
      );
    }
    Promise.all(checks).then((entries) => {
      if (cancelled) return;
      setDownloadedIds(new Set(entries.filter(([, v]) => v).map(([id]) => id)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, prefs]);

  const persist = async (next: DictationPrefs) => {
    setPrefs(next);
    await savePrefs(next);
  };

  const update = async (patch: Partial<DictationPrefs>) => {
    if (!prefs) return;
    await persist({ ...prefs, ...patch });
  };

  const handleSearch = () => {
    setSearching(true);
    setSearched(true);
    setSearchError(null);
    setSearchResults([]);
    searchHuggingFace(searchTerm)
      .then(setSearchResults)
      .catch((err) =>
        setSearchError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setSearching(false));
  };

  const downloadModel = async (
    info: ModelInfo,
    basePrefs: DictationPrefs,
  ) => {
    if (downloadingUrl || importing) return;
    setDownloadError(null);
    setDownloadingUrl(info.url);
    setDownloadProgress({ bytes: 0, total: info.sizeBytes });
    try {
      await getModelBytes(info.url, info.storageKey, (p) => {
        setDownloadProgress({ bytes: p.bytes, total: p.total || info.sizeBytes });
      });
      setDownloadedIds((prev) => new Set(prev).add(info.id));
      await persist({
        ...basePrefs,
        modelId: info.id,
        setupComplete: true,
      });
      setTab("models");
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingUrl(null);
    }
  };

  const downloadBuiltin = (id: keyof typeof BUILTIN_MODELS) => {
    if (!prefs) return;
    return downloadModel(BUILTIN_MODELS[id], prefs);
  };

  const installFromResult = async (r: HFModelResult) => {
    if (!prefs) return;
    const id = makeCustomId(r.url);
    const entry: CustomModelEntry = {
      id,
      label: `${r.repoId} (${r.filename})`,
      url: r.url,
      sizeBytes: r.sizeBytes,
      englishOnly: r.language === "en",
    };
    const nextPrefs: DictationPrefs = {
      ...prefs,
      customModels: [...prefs.customModels, entry],
    };
    // Persist before kicking off the fetch so a closed dialog or a failed
    // download still leaves the entry in the Custom tab (with a Retry button).
    await persist(nextPrefs);
    await downloadModel(customToModelInfo(entry), nextPrefs);
  };

  const installFromUrl = async () => {
    if (!prefs || !customUrl.trim()) return;
    const id = makeCustomId(customUrl);
    const entry: CustomModelEntry = {
      id,
      label: customLabel.trim() || customUrl,
      url: customUrl.trim(),
      sizeBytes: 0,
      englishOnly: false,
    };
    const nextPrefs: DictationPrefs = {
      ...prefs,
      customModels: [...prefs.customModels, entry],
    };
    setCustomUrl("");
    setCustomLabel("");
    await persist(nextPrefs);
    await downloadModel(customToModelInfo(entry), nextPrefs);
  };

  const importFromFile = async (file: File) => {
    if (!prefs || downloadingUrl || importing) return;
    setDownloadError(null);
    setImporting(true);
    try {
      const id = makeCustomId(file.name);
      const entry: CustomModelEntry = {
        id,
        label: customLabel.trim() || file.name,
        url: "",
        sizeBytes: file.size,
        englishOnly: false,
      };
      const info = customToModelInfo(entry);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await storeModelBytes(info.storageKey, bytes);
      const nextPrefs: DictationPrefs = {
        ...prefs,
        customModels: [...prefs.customModels, entry],
        modelId: id,
        setupComplete: true,
      };
      await persist(nextPrefs);
      setDownloadedIds((prev) => new Set(prev).add(id));
      setCustomUrl("");
      setCustomLabel("");
      setTab("models");
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const removeCustom = async (id: string) => {
    if (!prefs) return;
    const remaining = prefs.customModels.filter((m) => m.id !== id);
    const next: DictationPrefs = { ...prefs, customModels: remaining };
    if (prefs.modelId === id) next.modelId = "tiny.en";
    // Also drop any cached bytes for the removed entry.
    const entry = prefs.customModels.find((m) => m.id === id);
    if (entry) {
      const info = customToModelInfo(entry);
      await clearCachedModel(info.url, info.storageKey);
    }
    setDownloadedIds((prev) => {
      const out = new Set(prev);
      out.delete(id);
      return out;
    });
    await persist(next);
  };

  const clearCacheFor = async (modelId: string) => {
    if (!prefs) return;
    let url: string | null = null;
    let storageKey: string | null = null;
    if (modelId.startsWith("custom:")) {
      const entry = prefs.customModels.find((m) => m.id === modelId);
      if (entry) {
        const info = customToModelInfo(entry);
        url = info.url;
        storageKey = info.storageKey;
      }
    } else {
      const info = BUILTIN_MODELS[modelId as keyof typeof BUILTIN_MODELS];
      if (info) {
        url = info.url;
        storageKey = info.storageKey;
      }
    }
    if (!url || !storageKey) return;
    await clearCachedModel(url, storageKey);
    setDownloadedIds((prev) => {
      const out = new Set(prev);
      out.delete(modelId);
      return out;
    });
    if (prefs.modelId === modelId) {
      await update({ setupComplete: false });
    }
  };

  const clearAll = async () => {
    await clearAllCachedModels();
    setDownloadedIds(new Set());
    await update({ setupComplete: false });
  };

  const downloadedModels = useMemo(() => {
    if (!prefs) return [];
    const out: {
      id: DictationModelId;
      label: string;
      sub: string;
      custom: boolean;
    }[] = [];
    for (const m of Object.values(BUILTIN_MODELS)) {
      if (!downloadedIds.has(m.id)) continue;
      out.push({
        id: m.id,
        label: m.label,
        sub: `${formatBytes(m.sizeBytes)} • ${m.englishOnly ? "English" : "Multilingual"}`,
        custom: false,
      });
    }
    for (const m of prefs.customModels) {
      if (!downloadedIds.has(m.id)) continue;
      out.push({
        id: m.id,
        label: m.label,
        sub: m.sizeBytes ? formatBytes(m.sizeBytes) : "Custom",
        custom: true,
      });
    }
    return out;
  }, [prefs, downloadedIds]);

  const pct =
    downloadProgress.total > 0
      ? Math.min(
          100,
          Math.round((downloadProgress.bytes / downloadProgress.total) * 100),
        )
      : null;

  const renderDownloadAction = (
    id: string,
    url: string,
    onDownload: () => void | Promise<void>,
    opts?: { retry?: boolean },
  ) => {
    if (downloadedIds.has(id)) {
      return (
        <Chip size="small" label="Downloaded" color="success" sx={{ ml: 1 }} />
      );
    }
    // Match by URL — the search-result row's row-id (`hf:…`) differs from the
    // id assigned at install time (`custom:…`), but the URL is stable.
    if (downloadingUrl === url) {
      return (
        <Box sx={{ ml: 1, minWidth: 110, textAlign: "right" }}>
          <Typography variant="caption" color="text.secondary">
            {pct === null ? "Downloading…" : `${pct}%`}
          </Typography>
          <LinearProgress
            variant={pct === null ? "indeterminate" : "determinate"}
            value={pct ?? undefined}
            sx={{ mt: 0.5 }}
          />
        </Box>
      );
    }
    return (
      <Button
        size="small"
        variant="outlined"
        disabled={downloadingUrl !== null || importing}
        startIcon={<DownloadIcon fontSize="small" />}
        onClick={(e) => {
          e.stopPropagation();
          void onDownload();
        }}
        sx={{ ml: 1 }}
      >
        {opts?.retry ? "Retry" : "Download"}
      </Button>
    );
  };

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

        {downloadError && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            onClose={() => setDownloadError(null)}
          >
            {downloadError}
          </Alert>
        )}

        {tab === "models" && (
          <Box>
            {downloadedModels.length === 0 ? (
              <Box sx={{ py: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  No models downloaded yet.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setTab("discover")}
                >
                  Browse Discover
                </Button>
              </Box>
            ) : (
              <>
                <List dense disablePadding>
                  {downloadedModels.map((m) => (
                    <ListItemButton
                      key={m.id}
                      selected={prefs.modelId === m.id}
                      onClick={() =>
                        update({ modelId: m.id, setupComplete: true })
                      }
                    >
                      <ListItemText primary={m.label} secondary={m.sub} />
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          // For customs, fully remove the entry; otherwise
                          // just drop the cached bytes — the entry stays in
                          // Discover so the user can re-download.
                          if (m.custom) void removeCustom(m.id);
                          else void clearCacheFor(m.id);
                        }}
                        title={
                          m.custom
                            ? "Remove custom model"
                            : "Remove from device"
                        }
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemButton>
                  ))}
                </List>
                <Divider sx={{ my: 2 }} />
                <Button size="small" color="error" onClick={clearAll}>
                  Clear all downloads
                </Button>
              </>
            )}
          </Box>
        )}

        {tab === "discover" && (
          <Box>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              Recommended (ggerganov/whisper.cpp)
            </Typography>
            <List dense disablePadding>
              {Object.values(BUILTIN_MODELS).map((m) => (
                <ListItemButton
                  key={m.id}
                  disableRipple
                  sx={{ cursor: "default" }}
                  // ListItemButton needs a noop onClick to not look "broken" — the
                  // real action lives in the download icon on the right.
                  onClick={() => {}}
                >
                  <ListItemText
                    primary={m.label}
                    secondary={`${formatBytes(m.sizeBytes)} • ${
                      m.englishOnly ? "English" : "Multilingual"
                    }`}
                  />
                  {renderDownloadAction(m.id, m.url, () =>
                    downloadBuiltin(m.id as BuiltinModelId),
                  )}
                </ListItemButton>
              ))}
            </List>

            <Divider sx={{ my: 2 }} />

            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              Search HuggingFace
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Community whisper.cpp models. Leave empty and hit Search to browse
              the most-downloaded.
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="e.g. hindi, medical, korean… (empty = browse)"
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
                {searched
                  ? `No whisper.cpp models found${searchTerm.trim() ? ` for "${searchTerm.trim()}"` : ""}.`
                  : "Hit Search to browse community models."}
              </Typography>
            )}
            <List dense disablePadding>
              {searchResults.map((r) => {
                const probeId = `hf:${r.repoId}/${r.filename}`;
                return (
                  <ListItemButton
                    key={probeId}
                    disableRipple
                    sx={{ cursor: "default" }}
                    onClick={() => {}}
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
                    {renderDownloadAction(probeId, r.url, () =>
                      installFromResult(r),
                    )}
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        )}

        {tab === "custom" && (
          <Box>
            {prefs.customModels.length > 0 && (
              <>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: "block", mb: 0.5 }}
                >
                  Your custom models
                </Typography>
                <List dense disablePadding sx={{ mb: 2 }}>
                  {prefs.customModels.map((entry) => {
                    const info = customToModelInfo(entry);
                    return (
                      <ListItemButton
                        key={entry.id}
                        disableRipple
                        sx={{ cursor: "default" }}
                        onClick={() => {}}
                      >
                        <ListItemText
                          primary={entry.label}
                          secondary={
                            entry.sizeBytes
                              ? formatBytes(entry.sizeBytes)
                              : "Size unknown"
                          }
                        />
                        {renderDownloadAction(
                          entry.id,
                          info.url,
                          () => downloadModel(info, prefs),
                          { retry: true },
                        )}
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeCustom(entry.id);
                          }}
                          title="Remove custom model"
                          sx={{ ml: 1 }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </ListItemButton>
                    );
                  })}
                </List>
                <Divider sx={{ mb: 2 }} />
              </>
            )}
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              Import from file
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Already downloaded the .bin on your computer? Pick it here — no
              network transfer. Useful for sharing one download across browsers.
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept=".bin,application/octet-stream"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFromFile(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outlined"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing || downloadingUrl !== null}
              startIcon={
                importing ? <CircularProgress size={14} /> : <UploadFileIcon />
              }
              sx={{ mb: 2 }}
            >
              {importing ? "Importing…" : "Pick model file"}
            </Button>

            <Divider sx={{ mb: 2 }} />

            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              Download from URL
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Paste a direct URL to a whisper.cpp-compatible GGML model. The
              file is downloaded immediately and added to Models.
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
              onClick={installFromUrl}
              disabled={!customUrl.trim() || downloadingUrl !== null || importing}
              startIcon={
                downloadingUrl === null ? <DownloadIcon /> : (
                  <CircularProgress size={14} />
                )
              }
            >
              {downloadingUrl === null ? "Download" : `Downloading ${pct ?? 0}%`}
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
