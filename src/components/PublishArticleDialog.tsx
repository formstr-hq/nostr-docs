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
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AddIcon from "@mui/icons-material/Add";
import ImageIcon from "@mui/icons-material/Image";
import { useEffect, useRef, useState } from "react";
import type { Event } from "nostr-tools";
import ArticleRenderer from "./ArticleRenderer";
import { useRelays } from "../contexts/RelayContext";
import { useBlossomServers } from "../contexts/BlossomContext";
import { isNativePlatform } from "../signer/secureStorage";
import {
  buildArticleContent,
  publishArticleEvent,
  firstImageUrl,
  uploadPublicImage,
  type BuildStep,
  type PublishTarget,
} from "../utils/publishArticle";

type Props = {
  open: boolean;
  onClose: () => void;
  markdown: string;
  target: PublishTarget;
  initialTitle?: string;
  initialTags?: string[];
  /**
   * When set, the dialog edits an already-published article/NIP instead of
   * creating a new one: fields are pre-filled from the event and the update is
   * republished under the SAME `d` tag so it replaces the original post.
   */
  editEvent?: Event;
};

/** First value of a single-valued tag on an event. */
function tagValue(event: Event, name: string): string {
  return event.tags.find((t) => t[0] === name)?.[1] ?? "";
}

type KindTag = { kind: string; name: string };
type PreviewMode = "rendered" | "markdown";

export default function PublishArticleDialog({
  open,
  onClose,
  markdown,
  target,
  initialTitle = "",
  initialTags = [],
  editEvent,
}: Props) {
  const { relays } = useRelays();
  const { servers: blossomServers } = useBlossomServers();

  const isEditing = !!editEvent;
  // The addressable identifier to republish under when editing (keeps identity).
  const editDTag = editEvent ? tagValue(editEvent, "d") : undefined;
  const isNip = target === "communityNip";
  // When editing, seed each field from the existing event; the dialog is mounted
  // fresh per article (see DocumentList's `key`), so lazy initializers suffice
  // and we avoid copying props into state inside an effect.
  const [title, setTitle] = useState(() =>
    editEvent ? tagValue(editEvent, "title") : initialTitle,
  );
  const [summary, setSummary] = useState(() =>
    editEvent ? tagValue(editEvent, "summary") : "",
  );
  const [bannerUrl, setBannerUrl] = useState(() =>
    editEvent ? tagValue(editEvent, "image") : "",
  );
  const [bannerUploading, setBannerUploading] = useState(false);

  // Hashtags (→ `t` tags), managed as chips.
  const [hashtags, setHashtags] = useState<string[]>(() =>
    editEvent ? editEvent.tags.filter((t) => t[0] === "t").map((t) => t[1]) : [],
  );
  const [hashtagInput, setHashtagInput] = useState("");

  // Kinds (→ `k` tags), community-NIP only, managed as chips.
  const [kinds, setKinds] = useState<KindTag[]>(() =>
    editEvent
      ? editEvent.tags.filter((t) => t[0] === "k").map((t) => ({ kind: t[1], name: t[2] || t[1] }))
      : [],
  );
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
    // Edits keep the event's own `t` tags; new posts carry over any hashtags the
    // caller passed in.
    setHashtags(
      editEvent
        ? editEvent.tags.filter((t) => t[0] === "t").map((t) => t[1])
        : initialTags.map((t) => t.replace(/^#/, "").toLowerCase()),
    );

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
        // Suggest the first (now-public) image as the banner; user can change it.
        const suggested = firstImageUrl(res.content);
        if (suggested) setBannerUrl((prev) => prev || suggested);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBuilding(false));
  }, [open, markdown, blossomServers, initialTags, editEvent]);

  const handleClose = () => {
    builtRef.current = false;
    setSteps([]);
    setContent("");
    setWarnings([]);
    setError("");
    setPublishedLink("");
    setTitle(initialTitle);
    setSummary("");
    setBannerUrl("");
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

  const handleBannerUpload = async (file: File | undefined) => {
    if (!file) return;
    setBannerUploading(true);
    setError("");
    try {
      const url = await uploadPublicImage(file, blossomServers);
      setBannerUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Banner upload failed.");
    } finally {
      setBannerUploading(false);
    }
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
        image: !isNip && bannerUrl.trim() ? bannerUrl.trim() : undefined,
        content,
        hashtags,
        kTags: isNip ? kinds.map((k) => [k.kind, k.name]) : [],
        dTag: editDTag,
        relays,
      });
      // Link opens our own in-app reader so published pages render here.
      const base = isNativePlatform ? "https://pages.formstr.app" : window.location.origin;
      setPublishedLink(`${base}/article/${naddr}`);
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
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 1.5, border: '1px solid', borderColor: 'divider', backgroundImage: 'none', bgcolor: 'background.paper' } }}>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PublicIcon fontSize="small" />
          {isEditing
            ? isNip
              ? "Edit community NIP"
              : "Edit article"
            : isNip
              ? "Publish as community NIP"
              : "Publish as article"}
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          <Alert severity="warning">
            {isEditing ? (
              <>
                Saving republishes this {isNip ? "NIP" : "article"} under the same link,
                <strong> replacing the version readers currently see</strong>. Older copies may
                still linger on some relays.
              </>
            ) : (
              <>
                Publishing makes this page — and every image in it — <strong>public and permanent</strong>.
                Private images are decrypted and re-uploaded as public files. Review the converted draft
                below before you publish.
              </>
            )}
          </Alert>

          {publishedLink ? (
            <Alert severity="success">
              {isEditing ? "Updated" : "Published"}! Anyone can now read your {isNip ? "NIP" : "article"}.
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
              <Button
                variant="contained"
                color="secondary"
                size="small"
                startIcon={<OpenInNewIcon />}
                href={publishedLink}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ mt: 1.5, fontWeight: 700 }}
              >
                Open {isNip ? "NIP" : "article"}
              </Button>
            </Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {isNip
                  ? "Publishes as a community NIP (kind 30817) — a markdown spec others can discover and reference."
                  : "Publishes as a NIP-23 long-form article (kind 30023), rendered by clients like Habla and Highlighter."}
              </Typography>

              <TextField
                label="Title"
                required
                fullWidth
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {!isNip && (
                <TextField
                  label="Summary (optional)"
                  helperText="Shown as the preview snippet in article clients."
                  fullWidth
                  multiline
                  minRows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
              )}

              {/* Banner image — NIP-23 `image` tag (long-form only) */}
              {!isNip && (
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Banner image (optional)
                  </Typography>
                  {bannerUrl && (
                    <Box
                      component="img"
                      src={bannerUrl}
                      alt="Banner preview"
                      sx={{
                        width: "100%",
                        maxHeight: 160,
                        objectFit: "cover",
                        borderRadius: 1,
                        mb: 1,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                    />
                  )}
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="https://…/banner.jpg"
                    value={bannerUrl}
                    onChange={(e) => setBannerUrl(e.target.value)}
                  />
                  <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                    <Button
                      component="label"
                      size="small"
                      variant="outlined"
                      color="secondary"
                      startIcon={<ImageIcon />}
                      disabled={bannerUploading}
                    >
                      {bannerUploading ? "Uploading…" : "Upload image"}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          void handleBannerUpload(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </Button>
                    {bannerUrl && (
                      <Button size="small" color="inherit" onClick={() => setBannerUrl("")}>
                        Remove
                      </Button>
                    )}
                  </Box>
                </Box>
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
              {isNip && (
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
                    <Typography variant="subtitle2">
                      {isEditing ? "Content" : "Draft preview"}
                      {isEditing && previewMode === "rendered" && (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          Switch to Markdown to edit the body
                        </Typography>
                      )}
                    </Typography>
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
                      <ArticleRenderer
                        title={title}
                        content={content}
                        banner={!isNip && bannerUrl.trim() ? bannerUrl.trim() : undefined}
                        topics={hashtags}
                        isNip={isNip}
                        compact
                      />
                    ) : isEditing ? (
                      // Editing an existing post: the body is plain public markdown,
                      // so let the user amend it directly before republishing.
                      <TextField
                        fullWidth
                        multiline
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        variant="standard"
                        InputProps={{
                          disableUnderline: true,
                          sx: {
                            p: 1.5,
                            fontSize: "0.78rem",
                            fontFamily: "monospace",
                            alignItems: "flex-start",
                          },
                        }}
                      />
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
              {publishing ? (
                <CircularProgress size={22} color="inherit" />
              ) : isEditing ? (
                "Save changes"
              ) : (
                "Publish"
              )}
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
