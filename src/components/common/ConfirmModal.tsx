import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from "@mui/material";

type Props = {
  open: boolean;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  open,
  title = "Are you sure?",
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 1.5, border: '1px solid', borderColor: 'divider', backgroundImage: 'none', bgcolor: 'background.paper' } }}>
      <DialogTitle>{title}</DialogTitle>
      {description && (
        <DialogContent>
          <Typography>{description}</Typography>
        </DialogContent>
      )}
      <DialogActions>
        <Button color="warning" onClick={onCancel}>
          {cancelText}
        </Button>
        <Button variant="contained" color="error" onClick={onConfirm} sx={{ border: (t) => `1px solid ${t.palette.error.main}33` }}>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
