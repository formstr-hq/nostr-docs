// src/components/UserMenu.tsx
import React, { useState } from "react";
import { Avatar, Button, Menu, MenuItem, Typography } from "@mui/material";
import { useUser } from "../contexts/UserContext";
import LoginModal from "./LoginModal";

export default function UserMenu() {
  const { user, loginModal, logout } = useUser();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const handleAvatarClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => setAnchorEl(null);

  // Show login modal
  const handleLoginClick = () => setLoginOpen(true);

  if (!user) {
    return (
      <>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleLoginClick}
        >
          Login
        </Button>
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      </>
    );
  }

  // After login → avatar menu
  const displayName = user.name || user.pubkey?.slice(0, 6) + "...";
  const avatarLetter =
    user.name?.[0].toUpperCase() || user.pubkey?.slice(0, 2).toUpperCase();

  return (
    <>
      <Avatar
        sx={{ cursor: "pointer" }}
        onClick={handleAvatarClick}
        alt={displayName}
        src={user.avatar || undefined}
      >
        {avatarLetter}
      </Avatar>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        <MenuItem disabled>
          <Typography variant="body2">{displayName}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            logout();
            handleClose();
          }}
        >
          Logout
        </MenuItem>
      </Menu>
    </>
  );
}
