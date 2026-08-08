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
  Chip,
  Stack,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PublicIcon from "@mui/icons-material/Public";
import AddIcon from "@mui/icons-material/Add";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  initialTags?: string[];
};

type KindTag = { kind: string; name: string };
type PreviewMode = "rendered" | "markdown";

export default function PublishArticleDialog({
  open,
  onClose,
  markdown,
  initialTitle = "",
  initialTags = [],
}: Props) {
  const { relays } = useRelays();
  const { servers: blossomServers } = useBlossomServers();

  const [target, setTarget] = useState<PublishTarget>("longform");
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState("");

  // Hashtags (→ `t` tags), managed as chips.
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [hashtagInput, setHashtagInput] = useState("");

  // Kinds (→ `k` tags), community-NIP only, managed as chips.
  const [kinds, setKinds] = useState<KindTag[]>([]);
  const [kindNum, setKindNum] = useState("");
  const [kindName, setKindName] = useState("");

  const [previewMode, setPreviewMode] = useState<PreviewMode>("rendered");

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
    setHashtags(initialTags.map((t) => t.replace(/^#/, "").toLowerCase()));

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
  }, [open, markdown, blossomServers, initialTags]);

  const handleClose = () => {
    builtRef.current = false;
    setSteps([]);
    setContent("");
    setWarnings([]);
    setError("");
    setPublishedLink("");
    setTitle(initialTitle);
    setSummary("");
    setHashtags([]);
    setHashtagInput("");
    setKinds([]);
    setKindNum("");
    setKindName("");
    onClose();
  };

  const addHashtags = (raw: string) => {
    const parts = raw
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    setHashtags((prev) => Array.from(new Set([...prev, ...parts])));
    setHashtagInput("");
  };

  const addKind = () => {
    const kind = kindNum.trim();
    if (!/^\d+$/.test(kind)) return;
    const name = kindName.trim() || kind;
    setKinds((prev) =>
      prev.some((k) => k.kind === kind) ? prev : [...prev, { kind, name }],
    );
    setKindNum("");
    setKindName("");
  };

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
        hashtags,
        kTags: target === "communityNip" ? kinds.map((k) => [k.kind, k.name]) : [],
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
          <PublicIcon fontSize="small" /> Publish as article or NIP
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

              {target === "longform" && (
                <TextField
                  label="Summary (optional)"
                  fullWidth
                  multiline
                  minRows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
              )}

              {/* Hashtags */}
              <Box>
                <TextField
                  label="Hashtags (optional)"
                  fullWidth
                  size="small"
                  placeholder="Type a tag and press Enter or comma"
                  value={hashtagInput}
                  onChange={(e) => setHashtagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addHashtags(hashtagInput);
                    }
                  }}
                  onBlur={() => addHashtags(hashtagInput)}
                />
                {hashtags.length > 0 && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
                    {hashtags.map((t) => (
                      <Chip
                        key={t}
                        label={`#${t}`}
                        size="small"
                        onDelete={() => setHashtags((prev) => prev.filter((x) => x !== t))}
                      />
                    ))}
                  </Stack>
                )}
              </Box>

              {/* Kinds — community NIP only */}
              {target === "communityNip" && (
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Kinds this NIP defines (optional)
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                    <TextField
                      label="Kind #"
                      size="small"
                      sx={{ width: 110 }}
                      value={kindNum}
                      onChange={(e) => setKindNum(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKind())}
                    />
                    <TextField
                      label="Name"
                      size="small"
                      fullWidth
                      value={kindName}
                      onChange={(e) => setKindName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKind())}
                    />
                    <IconButton color="secondary" onClick={addKind} aria-label="Add kind" sx={{ mt: 0.25 }}>
                      <AddIcon />
                    </IconButton>
                  </Stack>
                  {kinds.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
                      {kinds.map((k) => (
                        <Chip
                          key={k.kind}
                          label={`${k.kind} · ${k.name}`}
                          size="small"
                          onDelete={() => setKinds((prev) => prev.filter((x) => x.kind !== k.kind))}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
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
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                    <Typography variant="subtitle2">Draft preview</Typography>
                    <ToggleButtonGroup
                      value={previewMode}
                      exclusive
                      size="small"
                      onChange={(_, v) => v && setPreviewMode(v)}
                    >
                      <ToggleButton value="rendered" sx={{ py: 0.25, px: 1, textTransform: "none" }}>
                        Rendered
                      </ToggleButton>
                      <ToggleButton value="markdown" sx={{ py: 0.25, px: 1, textTransform: "none" }}>
                        Markdown
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  <Box
                    sx={{
                      maxHeight: 320,
                      overflow: "auto",
                      borderRadius: 1,
                      border: "1px solid",
                      borderColor: "divider",
                      bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"),
                      p: previewMode === "markdown" ? 0 : 2,
                    }}
                  >
                    {previewMode === "rendered" ? (
                      <Box
                        sx={{
                          fontSize: "0.9rem",
                          lineHeight: 1.6,
                          "& h1, & h2, & h3": { mt: 1.5, mb: 0.75, lineHeight: 1.25 },
                          "& p": { my: 0.75 },
                          "& img": { maxWidth: "100%", borderRadius: 1 },
                          "& pre": {
                            p: 1,
                            borderRadius: 1,
                            overflow: "auto",
                            bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.06)"),
                          },
                          "& code": { fontSize: "0.85em" },
                          "& table": { borderCollapse: "collapse", width: "100%" },
                          "& th, & td": { border: "1px solid", borderColor: "divider", p: 0.75 },
                          "& a": { color: "secondary.main" },
                          "& blockquote": {
                            borderLeft: "3px solid",
                            borderColor: "divider",
                            pl: 1.5,
                            ml: 0,
                            color: "text.secondary",
                          },
                        }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                      </Box>
                    ) : (
                      <Box
                        component="pre"
                        sx={{
                          m: 0,
                          p: 1.5,
                          fontSize: "0.78rem",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {content}
                      </Box>
                    )}
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
