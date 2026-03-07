// src/components/UserMenu.tsx
import React, { useState } from "react";
import {
  Avatar,
  Menu,
  MenuItem,
  Typography,
  Divider,
  ListItemIcon,
  ListItemText,
  Switch,
  Box,
} from "@mui/material";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import { useUser } from "../contexts/UserContext";
import LoginModal from "./LoginModal";

type Props = {
  darkMode: boolean;
  onToggleDarkMode: () => void;
};

export default function UserMenu({ darkMode, onToggleDarkMode }: Props) {
  const { user, logout } = useUser();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const handleOpen = (e: React.MouseEvent<HTMLElement>) =>
    setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const displayName = user
    ? user.name || user.pubkey?.slice(0, 6) + "..."
    : null;
  const avatarLetter = user
    ? user.name?.[0].toUpperCase() || user.pubkey?.slice(0, 2).toUpperCase()
    : undefined;

  return (
    <>
      <Avatar
        sx={{ cursor: "pointer", width: 36, height: 36 }}
        onClick={handleOpen}
        alt={displayName ?? undefined}
        src={user?.avatar || undefined}
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

        {/* Dark mode toggle */}
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            onToggleDarkMode();
          }}
        >
          <ListItemIcon>
            {darkMode ? (
              <LightModeIcon fontSize="small" />
            ) : (
              <DarkModeIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText primary={darkMode ? "Light mode" : "Dark mode"} />
          <Switch
            checked={darkMode}
            size="small"
            color="secondary"
            sx={{ ml: 1 }}
          />
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
    </>
  );
}
