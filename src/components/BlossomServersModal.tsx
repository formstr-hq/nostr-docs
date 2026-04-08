import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  IconButton,
  Typography,
  TextField,
  List,
  ListItem,
  ListItemText,
  Divider,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { useBlossomServers } from "../contexts/BlossomContext";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function BlossomServersModal({ open, onClose }: Props) {
  const { servers, addServer, removeServer } = useBlossomServers();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const handleAdd = () => {
    const url = input.trim().replace(/\/$/, "");
    if (!url) return;

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        setError("URL must start with https://");
        return;
      }
    } catch {
      setError("Enter a valid URL (e.g. https://blossom.primal.net)");
      return;
    }

    addServer(url);
    setInput("");
    setError("");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Blossom Servers</DialogTitle>

      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Encrypted files are uploaded to these servers. Files are uploaded to
          all servers for redundancy; the first successful URL is used.
        </Typography>

        <List disablePadding>
          {servers.map((server, i) => (
            <Box key={server}>
              {i > 0 && <Divider />}
              <ListItem
                disableGutters
                secondaryAction={
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={() => removeServer(server)}
                    disabled={servers.length === 1}
                    title={
                      servers.length === 1
                        ? "At least one server is required"
                        : "Remove server"
                    }
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={server}
                  primaryTypographyProps={{ variant: "body2", sx: { wordBreak: "break-all" } }}
                />
              </ListItem>
            </Box>
          ))}
        </List>

        <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="https://blossom.example.com"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            error={!!error}
            helperText={error}
          />
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            sx={{ flexShrink: 0 }}
          >
            Add
          </Button>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
