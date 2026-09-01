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
import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublicPost?: () => void;
  onPublish?: (target: "longform" | "communityNip") => void;
  onPrivateLink?: (canEdit: boolean, rotate?: boolean) => Promise<string | void>;
  existingViewLink?: string;
  existingEditLink?: string;
};

export default function ShareModal({ open, onClose, onPrivateLink, onPublish, existingViewLink = "", existingEditLink = "" }: Props) {
  const [canEdit, setCanEdit] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [error, setError] = useState<string>("");

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
      const url = await onPrivateLink(canEdit, isRotate);
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
              />
              <Typography color="text.secondary">Can edit</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {canEdit
                ? existingEditLink
                  ? "This page already has a shared editable copy — any edits collaborators have made are preserved."
                  : "Creates a separate shared copy. Anyone with the link can edit it — your original document is unaffected."
                : "Anyone with the link can read this page. Generating again rotates access — previously shared view links stop working."}
            </Typography>

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
