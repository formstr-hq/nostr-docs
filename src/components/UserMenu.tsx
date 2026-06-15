// src/components/UserMenu.tsx
import React, { useState } from "react";
import {
  Avatar,
  Box,
  Collapse,
  IconButton,
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
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { useUser } from "../contexts/UserContext";
import type { AuthMethod } from "../signer";
import BlossomServersModal from "./BlossomServersModal";
import { themes } from "../theme";
import type { ThemeId, ThemeDefinition } from "../theme";

type Props = {
  themeId: ThemeId;
  onSelectTheme: (id: ThemeId) => void;
};

const METHOD_LABEL: Record<AuthMethod, string> = {
  extension: "Browser extension",
  nip46: "Remote signer",
  android: "Android signer",
  guest: "Temporary account",
  nsec: "Private key",
};

export default function UserMenu({ themeId, onSelectTheme }: Props) {
  const { user, accounts, activeAccount, switchAccount, addAccount, logout } =
    useUser();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
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

  const accountLabel = (pubkey: string, name?: string) =>
    name || `${pubkey.slice(0, 8)}…`;

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
        {/* Accounts */}
        {accounts.length > 0 ? (
          accounts.map((acct) => {
            const isActive = acct.pubkey === activeAccount?.pubkey;
            return (
              <MenuItem
                key={acct.pubkey}
                selected={isActive}
                onClick={() => {
                  if (!isActive) switchAccount(acct.pubkey);
                  handleClose();
                }}
                sx={{ pr: 1 }}
              >
                <ListItemIcon>
                  <Avatar
                    src={acct.avatar || undefined}
                    sx={{ width: 26, height: 26, fontSize: 12 }}
                  >
                    {(acct.name?.[0] || acct.pubkey.slice(0, 2)).toUpperCase()}
                  </Avatar>
                </ListItemIcon>
                <ListItemText
                  primary={accountLabel(acct.pubkey, acct.name)}
                  secondary={METHOD_LABEL[acct.method]}
                  secondaryTypographyProps={{ variant: "caption" }}
                />
                {isActive && (
                  <CheckIcon
                    fontSize="small"
                    sx={{ ml: 1, mr: 0.5, opacity: 0.7 }}
                  />
                )}
                <IconButton
                  size="small"
                  aria-label="Log out account"
                  onClick={(e) => {
                    e.stopPropagation();
                    logout(acct.pubkey);
                  }}
                >
                  <LogoutIcon fontSize="small" />
                </IconButton>
              </MenuItem>
            );
          })
        ) : (
          <MenuItem disabled sx={{ opacity: "1 !important" }}>
            <Typography variant="body2" color="text.secondary">
              Not logged in
            </Typography>
          </MenuItem>
        )}

        {/* Add / Login */}
        <MenuItem
          onClick={() => {
            addAccount();
            handleClose();
          }}
        >
          <ListItemIcon>
            {accounts.length > 0 ? (
              <PersonAddAltOutlinedIcon fontSize="small" />
            ) : (
              <LoginIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText primary={accounts.length > 0 ? "Add account" : "Login"} />
        </MenuItem>

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
              ),
            )}
          </Box>
        </Collapse>

        {/* Blossom servers */}
        <MenuItem
          onClick={() => {
            setBlossomOpen(true);
            handleClose();
          }}
        >
          <ListItemIcon>
            <CloudUploadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Blossom Servers"
            secondary="File upload servers"
            secondaryTypographyProps={{ variant: "caption" }}
          />
        </MenuItem>
      </Menu>

      <BlossomServersModal
        open={blossomOpen}
        onClose={() => setBlossomOpen(false)}
      />
    </>
  );
}
