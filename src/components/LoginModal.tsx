// src/components/LoginModal.tsx
import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogActions,
  Button,
  useTheme,
} from "@mui/material";
import { signerManager } from "../signer";
import { generateSecretKey } from "nostr-tools";

export default function LoginModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const handleNip07 = async () => {
    await signerManager.loginWithNip07();
    onClose();
  };

  const handleGuest = async () => {
    const key = generateSecretKey(); // generate guest key
    await signerManager.createGuestAccount(key);
    onClose();
  };

  const handleNip46 = async () => {
    const uri = prompt("Enter Bunker URI")!;
    if (uri) await signerManager.loginWithNip46(uri);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Choose Login Method</DialogTitle>
      <DialogActions sx={{ flexDirection: "column", gap: 1, p: 3 }}>
        <Button
          variant="contained"
          sx={{
            color: theme.palette.text.primary,
          }}
          fullWidth
          onClick={handleNip07}
        >
          NIP-07 Extension
        </Button>
        <Button variant="contained" fullWidth onClick={handleNip46}>
          Bunker / NIP-46
        </Button>
        <Button variant="contained" fullWidth onClick={handleGuest}>
          Guest
        </Button>
        <Button variant="outlined" fullWidth onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
