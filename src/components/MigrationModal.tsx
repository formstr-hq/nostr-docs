// src/components/MigrationModal.tsx
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
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { useState } from "react";

/**
 * Shown once when a pre-package guest/nsec key is detected. The user picks a
 * passphrase; their existing key is encrypted at rest (NIP-49) and imported as
 * a normal account, preserving access to everything they created.
 */
export default function MigrationModal({
  open,
  source,
  npub,
  onMigrate,
  onDismiss,
}: {
  open: boolean;
  source: "guest" | "nsec";
  npub?: string;
  onMigrate: (passphrase: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const mismatch = confirm.length > 0 && passphrase !== confirm;
  const canSubmit = passphrase.length > 0 && passphrase === confirm && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      await onMigrate(passphrase);
      setPassphrase("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setLoading(false);
    }
  };

  const sourceLabel =
    source === "guest" ? "temporary account" : "private-key account";

  return (
    <Dialog
      open={open}
      onClose={onDismiss}
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
              <ShieldOutlinedIcon />
            </Box>
            <Box minWidth={0}>
              <Typography variant="h6" fontWeight={700}>
                Secure your account
              </Typography>
              {npub && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {npub.slice(0, 16)}…
                </Typography>
              )}
            </Box>
          </Box>

          <Typography variant="body2" color="text.secondary">
            We're upgrading how keys are stored. Set a passphrase to encrypt your{" "}
            {sourceLabel} on this device. Your existing pages stay accessible —
            you'll enter this passphrase to unlock the app after a restart.
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
          />
          <TextField
            fullWidth
            size="small"
            label="Confirm passphrase"
            type="password"
            value={confirm}
            error={mismatch}
            helperText={mismatch ? "Passphrases don't match" : " "}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              color="inherit"
              onClick={onDismiss}
              sx={{ color: "text.secondary" }}
            >
              Not now
            </Button>
            <Button variant="contained" onClick={submit} disabled={!canSubmit}>
              {loading ? "Securing…" : "Secure account"}
            </Button>
          </Stack>
        </Box>
      </Dialog>
  );
}
