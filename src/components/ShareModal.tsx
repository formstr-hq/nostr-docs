import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Paper,
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
import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublicPost?: () => void;
  onPrivateLink?: (canEdit: boolean) => Promise<string | void>;
};

export default function ShareModal({ open, onClose, onPrivateLink }: Props) {
  const [canEdit, setCanEdit] = useState(false);
  const [privateLink, setPrivateLink] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [error, setError] = useState<string>("");

  const handlePrivateLink = async () => {
    if (!onPrivateLink) return;
    setLoading(true);
    setError("");
    try {
      const url = await onPrivateLink(canEdit);
      if (typeof url === "string") {
        setPrivateLink(url);
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
    setPrivateLink("");
    setCanEdit(false);
    setLoading(false);
    setError("");
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Share Page</DialogTitle>

        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
        >
          {/* PRIVATE LINK */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" fontWeight={800}>
              Get private link
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              Only people with the link will have access.
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <Typography color="text.secondary">Can view</Typography>
              <Switch
                checked={canEdit}
                onChange={() => setCanEdit((v) => !v)}
                color="secondary"
              />
              <Typography color="text.secondary">Can edit</Typography>
            </Box>

            <Button
              variant="contained"
              color="secondary"
              sx={{ mt: 2, fontWeight: 700, position: "relative" }}
              onClick={handlePrivateLink}
              disabled={loading}
            >
              {loading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                "Generate Link"
              )}
            </Button>

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
          </Paper>
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
