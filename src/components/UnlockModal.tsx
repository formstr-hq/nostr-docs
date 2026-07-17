// src/components/UnlockModal.tsx
import {
  Dialog,
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  Stack,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useState } from "react";

export default function UnlockModal({
  open,
  npub,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  npub?: string;
  onSubmit: (passphrase: string) => Promise<void>;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!passphrase || loading) return;
    setError("");
    setLoading(true);
    try {
      await onSubmit(passphrase);
      setPassphrase("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wrong passphrase");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, bgcolor: "background.paper" } }}
    >
        <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                bgcolor: `${theme.palette.primary.main}22`,
                color: "primary.main",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LockOutlinedIcon />
            </Box>
            <Box minWidth={0}>
              <Typography variant="h6" fontWeight={700}>
                Unlock account
              </Typography>
              {npub && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {npub.slice(0, 16)}…
                </Typography>
              )}
            </Box>
          </Box>

          <Typography variant="body2" color="text.secondary">
            Enter your passphrase to decrypt your key for this session.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button color="inherit" onClick={onCancel} sx={{ color: "text.secondary" }}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={submit}
              disabled={!passphrase || loading}
            >
              {loading ? "Unlocking…" : "Unlock"}
            </Button>
          </Stack>
        </Box>
      </Dialog>
  );
}
