// src/components/UserMenu.tsx
import React, { useState } from "react";
import {
  Avatar,
  Box,
  Collapse,
  Menu,
  MenuItem,
  Typography,
  Divider,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PaletteIcon from "@mui/icons-material/Palette";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { useUser } from "../contexts/UserContext";
import LoginModal from "./LoginModal";
import BlossomServersModal from "./BlossomServersModal";
import { themes } from "../theme";
import type { ThemeId, ThemeDefinition } from "../theme";

type Props = {
  themeId: ThemeId;
  onSelectTheme: (id: ThemeId) => void;
};

export default function UserMenu({ themeId, onSelectTheme }: Props) {
  const { user, logout } = useUser();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [blossomOpen, setBlossomOpen] = useState(false);

  const handleOpen = (e: React.MouseEvent<HTMLElement>) =>
    setAnchorEl(e.currentTarget);
  const handleClose = () => {
    setAnchorEl(null);
    setThemeOpen(false);
  };

  const displayName = user
    ? user.name || user.pubkey?.slice(0, 6) + "..."
    : null;
  const avatarLetter = user
    ? user.name?.[0]?.toUpperCase() || user.pubkey?.slice(0, 2)?.toUpperCase()
    : undefined;

  return (
    <>
      <Avatar
        sx={{ cursor: "pointer", width: 36, height: 36 }}
        onClick={handleOpen}
        alt={displayName ?? undefined}
        src={user?.picture || undefined}
      >
        {avatarLetter}
      </Avatar>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {/* Identity row */}
        {user ? (
          <MenuItem disabled sx={{ opacity: "1 !important" }}>
            <Typography variant="body2" fontWeight={600}>
              {displayName}
            </Typography>
          </MenuItem>
        ) : (
          <MenuItem disabled sx={{ opacity: "1 !important" }}>
            <Typography variant="body2" color="text.secondary">
              Not logged in
            </Typography>
          </MenuItem>
        )}

        <Divider />

        {/* Theme accordion trigger */}
        <MenuItem onClick={() => setThemeOpen((p) => !p)}>
          <ListItemIcon>
            <PaletteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Theme"
            secondary={themes[themeId].label}
            secondaryTypographyProps={{ variant: "caption" }}
          />
          {themeOpen ? (
            <ExpandLessIcon fontSize="small" sx={{ ml: 1, opacity: 0.6 }} />
          ) : (
            <ExpandMoreIcon fontSize="small" sx={{ ml: 1, opacity: 0.6 }} />
          )}
        </MenuItem>

        {/* Collapsible theme list */}
        <Collapse in={themeOpen}>
          <Box sx={{ pl: 1 }}>
            {(Object.entries(themes) as [ThemeId, ThemeDefinition][]).map(
              ([id, def]) => (
                <MenuItem
                  key={id}
                  selected={themeId === id}
                  onClick={() => {
                    onSelectTheme(id);
                    handleClose();
                  }}
                >
                  <ListItemIcon>
                    {/* Two-tone swatch: background | accent */}
                    <Box
                      sx={{
                        width: 24,
                        height: 16,
                        borderRadius: "4px",
                        overflow: "hidden",
                        border: "1.5px solid rgba(128,128,128,0.3)",
                        display: "flex",
                        flexShrink: 0,
                      }}
                    >
                      <Box sx={{ flex: 1, bgcolor: def.swatch }} />
                      <Box sx={{ flex: 1, bgcolor: def.accentSwatch }} />
                    </Box>
                  </ListItemIcon>
                  <ListItemText primary={def.label} />
                  {themeId === id && (
                    <CheckIcon fontSize="small" sx={{ ml: 1, opacity: 0.7 }} />
                  )}
                </MenuItem>
              )
            )}
          </Box>
        </Collapse>

        {/* Blossom servers */}
        <MenuItem onClick={() => { setBlossomOpen(true); handleClose(); }}>
          <ListItemIcon>
            <CloudUploadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Blossom Servers" secondary="File upload servers" secondaryTypographyProps={{ variant: "caption" }} />
        </MenuItem>

        <Divider />

        {/* Login / Logout */}
        {user ? (
          <MenuItem
            onClick={() => {
              logout();
              handleClose();
            }}
          >
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Logout" />
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              setLoginOpen(true);
              handleClose();
            }}
          >
            <ListItemIcon>
              <LoginIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Login" />
          </MenuItem>
        )}
      </Menu>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <BlossomServersModal open={blossomOpen} onClose={() => setBlossomOpen(false)} />
    </>
  );
}
