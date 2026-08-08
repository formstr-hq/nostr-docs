import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  InputAdornment,
  IconButton,
  Snackbar,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PublicIcon from "@mui/icons-material/Public";
import { useEffect, useRef, useState } from "react";
import { useRelays } from "../contexts/RelayContext";
import { useBlossomServers } from "../contexts/BlossomContext";
import {
  buildArticleContent,
  publishArticleEvent,
  type BuildStep,
  type PublishTarget,
} from "../utils/publishArticle";

type Props = {
  open: boolean;
  onClose: () => void;
  markdown: string;
  initialTitle?: string;
};

export default function PublishArticleDialog({ open, onClose, markdown, initialTitle = "" }: Props) {
  const { relays } = useRelays();
  const { servers: blossomServers } = useBlossomServers();

  const [target, setTarget] = useState<PublishTarget>("longform");
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState("");
  const [kTagsText, setKTagsText] = useState("");

  const [building, setBuilding] = useState(false);
  const [steps, setSteps] = useState<BuildStep[]>([]);
  const [content, setContent] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const [publishing, setPublishing] = useState(false);
  const [publishedLink, setPublishedLink] = useState("");
  const [error, setError] = useState("");
  const [toastOpen, setToastOpen] = useState(false);

  // Build (sanitize + media re-upload) once when the dialog opens, streaming
  // each step so the user watches the work instead of a blocking spinner.
  const builtRef = useRef(false);
  useEffect(() => {
    if (!open || builtRef.current) return;
    builtRef.current = true;
    setBuilding(true);
    setSteps([]);
    setWarnings([]);
    setError("");
    setPublishedLink("");

    const upsert = (step: BuildStep) =>
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.id === step.id);
        if (idx === -1) return [...prev, step];
        const next = [...prev];
        next[idx] = step;
        return next;
      });

    buildArticleContent({ markdown, blossomServers, onStep: upsert })
      .then((res) => {
        setContent(res.content);
        setWarnings(res.warnings);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBuilding(false));
  }, [open, markdown, blossomServers]);

  const handleClose = () => {
    builtRef.current = false;
    setSteps([]);
    setContent("");
    setWarnings([]);
    setError("");
    setPublishedLink("");
    setTitle(initialTitle);
    setSummary("");
    setKTagsText("");
    onClose();
  };

  const parseKTags = (): [string, string][] =>
    kTagsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [kind, ...rest] = line.split(/\s+/);
        return [kind, rest.join(" ") || kind] as [string, string];
      })
      .filter(([kind]) => /^\d+$/.test(kind));

  const handlePublish = async () => {
    if (!title.trim()) {
      setError("A title is required.");
      return;
    }
    setPublishing(true);
    setError("");
    try {
      const { naddr } = await publishArticleEvent({
        target,
        title: title.trim(),
        summary: summary.trim() || undefined,
        content,
        kTags: target === "communityNip" ? parseKTags() : [],
        relays,
      });
      setPublishedLink(`https://njump.me/${naddr}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  const handleCopy = () => {
    if (!publishedLink) return;
    navigator.clipboard.writeText(publishedLink);
    setToastOpen(true);
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PublicIcon fontSize="small" /> Publish as article
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          <Alert severity="warning">
            Publishing makes this page — and every image in it — <strong>public and permanent</strong>.
            Private images are decrypted and re-uploaded as public files. Review the converted draft
            below before you publish.
          </Alert>

          {publishedLink ? (
            <Alert severity="success">
              Published! Anyone can now read it.
              <TextField
                sx={{ mt: 1 }}
                fullWidth
                size="small"
                value={publishedLink}
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={handleCopy} size="small">
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                onFocus={(e) => e.target.select()}
              />
            </Alert>
          ) : (
            <>
              <ToggleButtonGroup
                value={target}
                exclusive
                onChange={(_, v) => v && setTarget(v)}
                size="small"
                color="secondary"
              >
                <ToggleButton value="longform">Long-form article (NIP-23)</ToggleButton>
                <ToggleButton value="communityNip">Community NIP (kind 30817)</ToggleButton>
              </ToggleButtonGroup>

              <TextField
                label="Title"
                required
                fullWidth
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {target === "longform" ? (
                <TextField
                  label="Summary (optional)"
                  fullWidth
                  multiline
                  minRows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
              ) : (
                <TextField
                  label="Kinds this NIP defines (optional)"
                  fullWidth
                  multiline
                  minRows={2}
                  placeholder={"One per line: <kind> <name>\ne.g. 30100 Game Session"}
                  helperText="Each line: a kind number then a human-readable name."
                  value={kTagsText}
                  onChange={(e) => setKTagsText(e.target.value)}
                />
              )}

              {/* Live progress feed */}
              {(building || steps.length > 0) && (
                <Box>
                  <Typography variant="subtitle2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {building && <CircularProgress size={14} />}
                    {building ? "Preparing article…" : "Conversion complete"}
                  </Typography>
                  <List dense>
                    {steps.map((s) => (
                      <ListItem key={s.id} sx={{ py: 0 }}>
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          {s.status === "done" ? (
                            <CheckCircleIcon fontSize="small" color="success" />
                          ) : s.status === "error" ? (
                            <ErrorIcon fontSize="small" color="error" />
                          ) : (
                            <CircularProgress size={14} />
                          )}
                        </ListItemIcon>
                        <ListItemText primary={s.label} secondary={s.detail} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}

              {warnings.length > 0 && (
                <Alert severity="warning">
                  {warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </Alert>
              )}

              {/* Draft preview */}
              {!building && content && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Draft preview
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      maxHeight: 260,
                      overflow: "auto",
                      borderRadius: 1,
                      border: "1px solid",
                      borderColor: "divider",
                      bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"),
                      fontSize: "0.78rem",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {content}
                  </Box>
                </Box>
              )}
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} color="secondary">
            {publishedLink ? "Close" : "Cancel"}
          </Button>
          {!publishedLink && (
            <Button
              variant="contained"
              color="secondary"
              onClick={handlePublish}
              disabled={building || publishing || !content || !title.trim()}
            >
              {publishing ? <CircularProgress size={22} color="inherit" /> : "Publish"}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toastOpen}
        autoHideDuration={3000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" sx={{ width: "100%" }}>
          Link copied to clipboard!
        </Alert>
      </Snackbar>
    </>
  );
}
