import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Switch,
  Box,
  TextField,
  CircularProgress,
  Snackbar,
  Alert,
  InputAdornment,
  IconButton,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArticleIcon from "@mui/icons-material/Article";
import DescriptionIcon from "@mui/icons-material/Description";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublicPost?: () => void;
  onPublish?: (target: "longform" | "communityNip") => void;
  onPrivateLink?: (canEdit: boolean, rotate?: boolean, open?: boolean) => Promise<string | void>;
  existingViewLink?: string;
  existingEditLink?: string;
  /** v2 group share: current editors (owner-managed). */
  members?: { pubkey: string; role: string }[];
  /** Add an editor by npub or hex pubkey. Presence enables the editors UI. */
  onAddEditor?: (npubOrHex: string) => Promise<void>;
  onRemoveEditor?: (pubkey: string) => Promise<void>;
  /** True when the selected doc is a v2 group document (tweaks copy). */
  v2?: boolean;
  /** Current v2 write mode, if any. */
  mode?: "restricted" | "open";
};

function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 10)}…${pubkey.slice(-6)}` : pubkey;
}

export default function ShareModal({ open, onClose, onPrivateLink, onPublish, existingViewLink = "", existingEditLink = "", members = [], onAddEditor, onRemoveEditor, v2 = false, mode }: Props) {
  const [canEdit, setCanEdit] = useState(false);
  const [openEdit, setOpenEdit] = useState(mode === "open");
  const [generatedLink, setGeneratedLink] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [error, setError] = useState<string>("");
  const [editorInput, setEditorInput] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");

  // Reflect the document's current mode each time the dialog opens.
  useEffect(() => {
    if (open) setOpenEdit(mode === "open");
  }, [open, mode]);

  const handleAddEditor = async () => {
    if (!onAddEditor) return;
    const value = editorInput.trim();
    if (!value) return;
    setEditorBusy(true);
    setEditorError("");
    try {
      await onAddEditor(value);
      setEditorInput("");
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to add editor");
    } finally {
      setEditorBusy(false);
    }
  };

  const handleRemoveEditor = async (pubkey: string) => {
    if (!onRemoveEditor) return;
    setEditorBusy(true);
    setEditorError("");
    try {
      await onRemoveEditor(pubkey);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to remove editor");
    } finally {
      setEditorBusy(false);
    }
  };

  const currentExistingLink = canEdit ? existingEditLink : existingViewLink;
  // Show a freshly generated link if we have one, otherwise fall back to any
  // existing link for the current mode. Derived during render (no effect) so
  // toggling the switch or reopening the dialog stays in sync automatically.
  const privateLink = open ? generatedLink || currentExistingLink || "" : "";

  const handlePrivateLink = async () => {
    if (!onPrivateLink) return;
    setLoading(true);
    setError("");
    try {
      const isRotate = !canEdit && !!existingViewLink;
      const url = await onPrivateLink(canEdit, isRotate, openEdit);
      if (typeof url === "string") {
        setGeneratedLink(url);
      } else {
        setError("Failed to generate link. Please try again.");
      }
    } catch (err) {
      console.error("Failed to generate private link:", err);
      setError(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!privateLink) return;
    navigator.clipboard.writeText(privateLink);
    setToastOpen(true);
  };

  const handleClose = () => {
    setGeneratedLink("");
    setCanEdit(false);
    setLoading(false);
    setError("");
    setEditorInput("");
    setEditorError("");
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 1.5, border: '1px solid', borderColor: 'divider', backgroundImage: 'none', bgcolor: 'background.paper' } }}>
        <DialogTitle>Share Page</DialogTitle>

        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
        >
          {/* PRIVATE LINK */}
          <Box sx={{ bgcolor: (theme) => `${theme.palette.primary.main}08`, borderRadius: 0.75, border: '1px solid rgba(255,255,255,0.06)', p: 2 }}>
            <Typography sx={{ textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '1px', color: 'text.secondary', fontWeight: 700, mb: 1 }}>SHARING</Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              Only people with the link will have access.
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <Typography color="text.secondary">Can view</Typography>
              <Switch
                checked={canEdit}
                onChange={() => {
                  setCanEdit((v) => !v);
                  setGeneratedLink("");
                  setError("");
                }}
                color="secondary"
                slotProps={{ input: { "aria-label": "Can edit" } }}
              />
              <Typography color="text.secondary">Can edit</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {canEdit
                ? existingEditLink
                  ? "This page already has a shared editable copy — any edits collaborators have made are preserved."
                  : v2
                    ? "Anyone with the link can view. Only the people you add as editors below can edit."
                    : "Creates a separate shared copy. Anyone with the link can edit it — your original document is unaffected."
                : "Anyone with the link can read this page. Generating again rotates access — previously shared view links stop working."}
            </Typography>

            {canEdit && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                <Typography color="text.secondary" sx={{ fontSize: "0.8rem" }}>Invited editors only</Typography>
                <Switch
                  checked={openEdit}
                  onChange={() => {
                    setOpenEdit((v) => !v);
                    setGeneratedLink("");
                    setError("");
                  }}
                  color="secondary"
                  size="small"
                  slotProps={{ input: { "aria-label": "Anyone with the link can edit" } }}
                />
                <Typography color="text.secondary" sx={{ fontSize: "0.8rem" }}>Anyone with the link</Typography>
              </Box>
            )}

            {!(canEdit && !!existingEditLink) && (
              <Button
                variant="contained"
                color="secondary"
                sx={{ mt: 2, fontWeight: 700, position: "relative" }}
                onClick={handlePrivateLink}
                disabled={loading}
              >
                {loading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : !canEdit && existingViewLink ? (
                  "Rotate View Access"
                ) : (
                  "Generate Link"
                )}
              </Button>
            )}

            {error && (
              <Typography color="error" sx={{ mt: 2 }}>
                {error}
              </Typography>
            )}

            {privateLink && (
              <TextField
                sx={{ mt: 2 }}
                fullWidth
                label="Private Link"
                value={privateLink}
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={handleCopy}>
                        <ContentCopyIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                onFocus={(e) => e.target.select()}
              />
            )}
          </Box>

          {/* EDITORS (v2 group share) */}
          {onAddEditor && (
            <Box sx={{ bgcolor: (theme) => `${theme.palette.primary.main}08`, borderRadius: 0.75, border: '1px solid rgba(255,255,255,0.06)', p: 2 }}>
              <Typography sx={{ textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '1px', color: 'text.secondary', fontWeight: 700, mb: 1 }}>EDITORS</Typography>
              <Typography color="text.secondary" sx={{ mb: 1 }}>
                {openEdit
                  ? "This page is open — anyone with the link can edit. Adding an editor switches it to invited-editors-only."
                  : "Only the people listed here can edit this page. Add someone by their npub (or hex pubkey). Anyone with the link can view."}
              </Typography>

              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <TextField
                  size="small"
                  fullWidth
                  label="npub1… or hex pubkey"
                  value={editorInput}
                  onChange={(e) => setEditorInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddEditor();
                    }
                  }}
                  disabled={editorBusy}
                />
                <Button
                  variant="contained"
                  color="secondary"
                  sx={{ fontWeight: 700, whiteSpace: "nowrap" }}
                  onClick={() => void handleAddEditor()}
                  disabled={editorBusy || !editorInput.trim()}
                >
                  Add
                </Button>
              </Box>

              {editorError && (
                <Typography color="error" variant="caption" sx={{ mt: 1, display: "block" }}>
                  {editorError}
                </Typography>
              )}

              {members.length > 0 && (
                <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {members.map((m) => (
                    <Box key={m.pubkey} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                      <Typography variant="caption" sx={{ fontFamily: "monospace" }} noWrap>
                        {shortPubkey(m.pubkey)}
                      </Typography>
                      {onRemoveEditor && (
                        <Button size="small" color="error" onClick={() => void handleRemoveEditor(m.pubkey)} disabled={editorBusy}>
                          Remove
                        </Button>
                      )}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* PUBLISH PUBLICLY */}
          {onPublish && (
            <Box sx={{ bgcolor: (theme) => `${theme.palette.primary.main}08`, borderRadius: 0.75, border: '1px solid rgba(255,255,255,0.06)', p: 2 }}>
              <Typography sx={{ textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '1px', color: 'text.secondary', fontWeight: 700, mb: 1 }}>PUBLISH</Typography>
              <Typography color="text.secondary" sx={{ mb: 1 }}>
                Post this page to Nostr for anyone to read — images become public.
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<ArticleIcon />}
                  sx={{ fontWeight: 700 }}
                  onClick={() => onPublish("longform")}
                >
                  Publish as Article
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<DescriptionIcon />}
                  sx={{ fontWeight: 700 }}
                  onClick={() => onPublish("communityNip")}
                >
                  Publish as NIP
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} color="secondary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for Copy Confirmation */}
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
