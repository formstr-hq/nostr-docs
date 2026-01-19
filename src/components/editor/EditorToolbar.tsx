import {
  Paper,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useState } from "react";
import { useUser } from "../../contexts/UserContext";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";

type Props = {
  mode: "edit" | "preview";
  saving: boolean;
  onToggleMode: () => void;
  onSave: () => void;
  handleDelete: () => void;
  onShare: () => void;
};

export function EditorToolbar({
  mode,
  saving,
  onToggleMode,
  onSave,
  handleDelete,
  onShare,
}: Props) {
  const { user, loginModal } = useUser();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);

  const menuOpen = Boolean(menuAnchor);
  return (
    <Paper
      elevation={2}
      sx={{
        p: 1.5,
        px: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        bgcolor: "background.paper",
        borderRadius: 2,
        border: "1px solid rgba(0,0,0,0.08)",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <Box sx={{ display: "flex", gap: 2 }}>
        <Box sx={{ display: "flex", gap: 2 }}>
          {mode === "preview" ? (
            <Button
              variant="outlined"
              color="secondary"
              onClick={onToggleMode}
              startIcon={<EditIcon />}
              sx={{ fontWeight: 700 }}
            >
              Edit
            </Button>
          ) : (
            <Button
              variant="outlined"
              color="secondary"
              onClick={onToggleMode}
              startIcon={<VisibilityIcon />}
              sx={{ fontWeight: 700 }}
            >
              Preview
            </Button>
          )}
        </Box>
        {user ? (
          <Button
            variant="contained"
            color="secondary"
            onClick={() => onSave()}
            sx={{ fontWeight: 700 }}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        ) : (
          <Button
            variant="contained"
            color="secondary"
            onClick={() => loginModal()}
            sx={{ fontWeight: 700 }}
          >
            Login
          </Button>
        )}

        <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)}>
          <MoreVertIcon />
        </IconButton>

        <Menu
          anchorEl={menuAnchor}
          open={menuOpen}
          onClose={() => setMenuAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              onShare();
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <ShareIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Share" />
          </MenuItem>

          <MenuItem
            onClick={() => {
              handleDelete();
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Delete" />
          </MenuItem>
          <MenuItem
            onClick={() => {
              setAutosaveEnabled(!autosaveEnabled);
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <EditIcon fontSize="small" />{" "}
              {/* You could use a better icon if desired */}
            </ListItemIcon>
            <ListItemText
              primary={autosaveEnabled ? "Disable Autosave" : "Enable Autosave"}
            />
          </MenuItem>
        </Menu>
      </Box>
    </Paper>
  );
}
