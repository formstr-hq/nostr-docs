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
} from "@mui/material";
import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublicPost?: () => void;
  onPrivateLink?: (canEdit: boolean) => Promise<string | void>;
};

export default function ShareModal({
  open,
  onClose,
  onPublicPost,
  onPrivateLink,
}: Props) {
  const [canEdit, setCanEdit] = useState(false);
  const [privateLink, setPrivateLink] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handlePrivateLink = async () => {
    if (!onPrivateLink) return;
    setLoading(true);
    try {
      const url = await onPrivateLink(canEdit);
      if (typeof url === "string") setPrivateLink(url);
    } catch (err) {
      console.error("Failed to generate private link:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPrivateLink("");
    setCanEdit(false);
    setLoading(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Share Page</DialogTitle>

      <DialogContent
        sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
      >
        {/* PUBLIC POST */}
        <Paper
          variant="outlined"
          sx={{ p: 2, cursor: "pointer" }}
          onClick={async () => {
            await onPublicPost?.();
            handleClose();
          }}
        >
          <Typography variant="h6" fontWeight={800}>
            Post publicly as long-form article
          </Typography>
          <Typography color="text.secondary">
            Publish as a public article so anyone can read it.
          </Typography>
        </Paper>

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

          {privateLink && (
            <TextField
              sx={{ mt: 2 }}
              fullWidth
              label="Private Link"
              value={privateLink}
              InputProps={{
                readOnly: true,
              }}
              onFocus={(e) => e.target.select()}
            />
          )}
        </Paper>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
