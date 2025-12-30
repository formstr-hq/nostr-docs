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
} from "@mui/material";
import React from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublicPost?: () => void;
  onPrivateLink?: (canEdit: boolean) => void;
};

export default function ShareModal({
  open,
  onClose,
  onPublicPost,
  onPrivateLink,
}: Props) {
  const [canEdit, setCanEdit] = React.useState(false);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Share Page</DialogTitle>

      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          pt: 2,
        }}
      >
        {/* PUBLIC POST */}
        <Paper
          variant="outlined"
          sx={{ p: 2, cursor: "pointer" }}
          onClick={() => {
            console.log("TODO: Post publicly");
            onPublicPost?.();
            onClose();
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

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mt: 1,
            }}
          >
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
            sx={{ mt: 2, fontWeight: 700 }}
            onClick={() => {
              console.log(
                "TODO: Generate private link. Permission:",
                canEdit ? "edit" : "view"
              );
              onPrivateLink?.(canEdit);
              onClose();
            }}
          >
            Generate Link
          </Button>
        </Paper>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
