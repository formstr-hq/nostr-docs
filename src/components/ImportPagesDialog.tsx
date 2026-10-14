import { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Typography,
  alpha,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useNavigate } from "react-router-dom";
import { useDocumentContext } from "../contexts/DocumentContext";
import { useUser } from "../contexts/UserContext";
import { readImportFiles, type ImportEntry } from "../utils/importPages";

/**
 * Import one or more pages from Markdown files, or from a .zip of Markdown
 * files (e.g. a backup produced by the "Backup pages" feature). Each file
 * becomes a new owner-encrypted page, published to the user's relays exactly
 * like a normal save, with its content imported verbatim.
 */
export default function ImportPagesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useUser();
  const { addImportedDocument } = useDocumentContext();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<ImportEntry[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishToRelays, setPublishToRelays] = useState(true);

  const busy = parsing || importing;

  const addFiles = async (fileList: FileList | File[] | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    setParsing(true);
    setError(null);
    setResult(null);
    try {
      const { entries: newEntries, skipped: newSkipped } = await readImportFiles(files);
      setEntries((prev) => [...prev, ...newEntries]);
      if (newSkipped.length > 0) setSkipped((prev) => [...prev, ...newSkipped]);
    } catch (err) {
      console.error("Failed to read files for import:", err);
      setError("Could not read the selected files.");
    } finally {
      setParsing(false);
    }
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setResult(null);
  };

  const reset = () => {
    setEntries([]);
    setSkipped([]);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setError(null);
  };

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const handleImport = async () => {
    if (!user || importing || entries.length === 0) return;
    setImporting(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: entries.length });

    let ok = 0;
    const failedEntries: ImportEntry[] = [];

    for (const entry of entries) {
      try {
        await addImportedDocument(entry.markdown, { publish: publishToRelays });
        ok += 1;
      } catch (err) {
        console.error("Failed to import page:", entry.source, err);
        failedEntries.push(entry);
      } finally {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }

    // Keep only the pages that failed so the user can retry them.
    setEntries(failedEntries);
    setImporting(false);
    setResult({ ok, failed: failedEntries.length });
  };

  const hasEntries = entries.length > 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            backgroundImage: "none",
            bgcolor: "background.paper",
          },
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        <Typography variant="h6" sx={{ fontSize: "1.05rem", fontWeight: 700 }}>
          Import pages
        </Typography>
        <IconButton size="small" aria-label="Close" onClick={handleClose} disabled={busy}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 2.5, py: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Add Markdown (.md) files, or a .zip of Markdown files. Each file becomes
          a new page.
        </Typography>

        <FormControlLabel
          sx={{ display: "flex", alignItems: "flex-start", ml: 0, mb: 1.5 }}
          control={
            <Checkbox
              size="small"
              checked={publishToRelays}
              disabled={busy}
              onChange={(e) => setPublishToRelays(e.target.checked)}
            />
          }
          label={
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.84rem" }}>
                Publish to relays
              </Typography>
              <Typography
                variant="caption"
                sx={{ display: "block", color: "text.secondary", fontSize: "0.72rem" }}
              >
                {publishToRelays
                  ? "Imported pages sync to your relays (end-to-end encrypted)."
                  : "Imported pages stay on this device only — never published."}
              </Typography>
            </Box>
          }
        />

        {!user && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Log in to import pages.
          </Alert>
        )}

        {/* ── Drop zone / file picker ── */}
        <Box
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void addFiles(e.dataTransfer.files);
          }}
          sx={{
            border: "1.5px dashed",
            borderColor: (t) => alpha(t.palette.text.primary, 0.18),
            borderRadius: 1.5,
            bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
            px: 2,
            py: 2.5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
            textAlign: "center",
          }}
        >
          <UploadFileOutlinedIcon sx={{ fontSize: 28, color: "text.secondary" }} />
          <Typography variant="body2" color="text.secondary">
            Drag &amp; drop files here
          </Typography>
          <Button
            component="label"
            variant="outlined"
            size="small"
            disabled={busy}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Choose files
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              aria-label="Choose Markdown or zip files"
              accept=".md,.markdown,.mdown,.mkd,.txt,.zip,text/markdown,text/plain,application/zip"
              onChange={(e) => {
                void addFiles(e.target.files);
                // Allow re-selecting the same file later.
                if (inputRef.current) inputRef.current.value = "";
              }}
            />
          </Button>
        </Box>

        {parsing && <LinearProgress sx={{ mt: 1.5 }} />}

        {skipped.length > 0 && (
          <Alert severity="warning" sx={{ mt: 1.5 }} onClose={() => setSkipped([])}>
            Skipped {skipped.length} file{skipped.length === 1 ? "" : "s"} that
            weren&apos;t Markdown: {skipped.slice(0, 3).join(", ")}
            {skipped.length > 3 ? "…" : ""}
          </Alert>
        )}

        {/* ── Selected files ── */}
        {hasEntries && (
          <Box sx={{ mt: 1.5 }}>
            <Typography
              variant="caption"
              sx={{
                display: "block",
                mb: 0.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "text.disabled",
                fontSize: "0.68rem",
              }}
            >
              {entries.length} page{entries.length === 1 ? "" : "s"} ready to import
            </Typography>
            <Box
              sx={{
                maxHeight: 220,
                overflowY: "auto",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
              }}
            >
              {entries.map((entry) => (
                <Box
                  key={entry.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 1.5,
                    py: 0.5,
                    borderBottom: "1px solid",
                    borderColor: (t) => alpha(t.palette.text.primary, 0.06),
                    "&:last-of-type": { borderBottom: "none" },
                  }}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, minWidth: 0, fontSize: "0.84rem" }}
                  >
                    {entry.name}
                  </Typography>
                  <Chip
                    label={`${entry.markdown.length} chars`}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: "0.62rem",
                      bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
                    }}
                  />
                  <IconButton
                    size="small"
                    aria-label={`Remove ${entry.name}`}
                    disabled={importing}
                    onClick={() => removeEntry(entry.id)}
                    sx={{ p: 0.35, color: "text.secondary", "&:hover": { color: "error.main" } }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* ── Progress ── */}
        {importing && (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress
              variant="determinate"
              value={progress.total ? (progress.done / progress.total) * 100 : 0}
            />
            <Typography variant="caption" sx={{ mt: 0.5, display: "block", color: "text.secondary" }}>
              Importing {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </Typography>
          </Box>
        )}

        {result && (
          <Alert
            severity={result.failed > 0 ? "warning" : "success"}
            sx={{ mt: 1.5 }}
          >
            Imported {result.ok} page{result.ok === 1 ? "" : "s"}
            {publishToRelays ? "" : " on this device"}
            {result.failed > 0 ? `, ${result.failed} failed` : ""}.
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        {result && result.ok > 0 ? (
          <Button
            onClick={() => {
              reset();
              onClose();
              navigate("/");
            }}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            View pages
          </Button>
        ) : (
          <Button onClick={handleClose} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
        )}
        <Button
          variant="contained"
          color="secondary"
          onClick={handleImport}
          disabled={!user || busy || !hasEntries}
          sx={{ textTransform: "none", fontWeight: 700 }}
        >
          {importing
            ? "Importing…"
            : `Import ${entries.length} page${entries.length === 1 ? "" : "s"}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
