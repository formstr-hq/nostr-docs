// src/components/LoginModal.tsx
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Button,
  TextField,
  Typography,
  Collapse,
  Box,
} from "@mui/material";
import { useState } from "react";
import { signerManager } from "../signer";
import { generateSecretKey } from "nostr-tools";

export default function LoginModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [showNip46, setShowNip46] = useState(false);
  const [uri, setUri] = useState("");

  const handleNip07 = async () => {
    await signerManager.loginWithNip07();
    onClose();
  };

  const handleGuest = async () => {
    const key = generateSecretKey();
    await signerManager.createGuestAccount(key);
    onClose();
  };

  const handleNip46 = async () => {
    if (!uri) return;
    await signerManager.loginWithNip46(uri);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ textAlign: "center", fontWeight: 700 }}>
        Choose Login Method
      </DialogTitle>

      <DialogContent sx={{ textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          Select how you’d like to sign in.
        </Typography>

        <Stack spacing={1.5} mt={3}>
          <Button fullWidth variant="contained" onClick={handleNip07}>
            NIP-07 Extension
          </Button>

          <Button
            fullWidth
            variant="outlined"
            color="secondary"
            onClick={() => setShowNip46(!showNip46)}
          >
            Bunker / NIP-46
          </Button>

          <Collapse in={showNip46}>
            <Box display="flex" gap={1}>
              <TextField
                fullWidth
                size="small"
                label="Bunker URI"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
              />
              <Button variant="contained" onClick={handleNip46}>
                Go
              </Button>
            </Box>
          </Collapse>

          <Button
            fullWidth
            variant="outlined"
            color="secondary"
            onClick={handleGuest}
          >
            Temporary Login
          </Button>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button fullWidth color="secondary" variant="text" onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
