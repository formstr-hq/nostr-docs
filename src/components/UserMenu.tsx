// src/components/UserMenu.tsx
import React, { useState } from "react";
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Divider,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  alpha,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PaletteIcon from "@mui/icons-material/Palette";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import MicIcon from "@mui/icons-material/Mic";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { nip19 } from "nostr-tools";
import { useThemeMode } from "../contexts/ThemeModeContext";
import { useUser } from "../contexts/UserContext";
import { NostrAvatar } from "./common/NostrAvatar";
import type { AuthMethod } from "../signer";
import BlossomServersModal from "./BlossomServersModal";
import DictationSettingsDialog from "./dictation/DictationSettingsDialog";
import { themes } from "../theme";
import type { ThemeId, ThemeDefinition } from "../theme";

type Props = {
  themeId?: ThemeId;
  onSelectTheme?: (id: ThemeId) => void;
  triggerMode?: "pill" | "avatar";
};

const METHOD_LABEL: Record<AuthMethod, string> = {
  extension: "Browser extension",
  nip46: "Remote signer",
  android: "Android signer",
  ncryptsec: "Passphrase key",
};

export default function UserMenu({
  themeId: propThemeId,
  onSelectTheme: propOnSelectTheme,
  triggerMode = "pill",
}: Props) {
  const { themeId: ctxThemeId, setThemeId: ctxSetThemeId } = useThemeMode();
  const themeId = propThemeId ?? ctxThemeId;
  const onSelectTheme = propOnSelectTheme ?? ctxSetThemeId;

  const {
    user,
    accounts,
    activeAccount,
    locked,
    switchAccount,
    addAccount,
    unlock,
    logout,
  } = useUser();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [blossomOpen, setBlossomOpen] = useState(false);
  const [dictationOpen, setDictationOpen] = useState(false);

  const handleOpen = (e: React.MouseEvent<HTMLElement>) =>
    setAnchorEl(e.currentTarget);
  const handleClose = () => {
    setAnchorEl(null);
  };

  const userNpub = user?.pubkey
    ? (() => {
        try {
          return nip19.npubEncode(user.pubkey);
        } catch {
          return user.pubkey;
        }
      })()
    : null;

  const userDisplay =
    user?.name ||
    (userNpub
      ? `${userNpub.slice(0, 8)}…${userNpub.slice(-4)}`
      : "Guest");

  const accountLabel = (pubkey: string, name?: string) =>
    name || `${pubkey.slice(0, 8)}…`;

  return (
    <>
      {triggerMode === "avatar" ? (
        <NostrAvatar
          user={user}
          size={32}
          onClick={handleOpen}
          sx={{ cursor: "pointer" }}
        />
      ) : (
        <Box
          onClick={handleOpen}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.25,
            width: "100%",
            py: 0.75,
            px: 0.75,
            borderRadius: 1.25,
            cursor: "pointer",
            "&:hover": {
              bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
            },
            transition: "background-color 0.15s ease",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flex: 1 }}>
            <NostrAvatar
              user={user}
              size={30}
            />
            <Typography
              variant="caption"
              sx={{
                fontFamily: "monospace",
                fontSize: "0.8rem",
                color: "text.primary",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={userNpub || undefined}
            >
              {userDisplay}
            </Typography>
          </Box>
          <IconButton size="small" sx={{ p: 0.5, color: "text.secondary", opacity: 0.7 }}>
            <MoreHorizIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
      )}

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={
          triggerMode === "avatar"
            ? { vertical: "bottom", horizontal: "right" }
            : { vertical: "top", horizontal: "left" }
        }
        transformOrigin={
          triggerMode === "avatar"
            ? { vertical: "top", horizontal: "right" }
            : { vertical: "bottom", horizontal: "left" }
        }
        marginThreshold={16}
        slotProps={{
          paper: {
            sx: {
              borderRadius: 1.5,
              border: "1px solid",
              borderColor: (t) => alpha(t.palette.text.primary, 0.06),
              backgroundImage: "none",
              backdropFilter: "blur(12px)",
              minWidth: 228,
              maxWidth: 260,
              maxHeight: "calc(100dvh - 32px)",
              overflowY: "auto",
              bgcolor: (t) => alpha(t.palette.background.paper, 0.95),
              mt: triggerMode === "avatar" ? 1 : 0,
              mb: triggerMode === "avatar" ? 0 : 1,
              "& .MuiList-root": {
                pt: 0,
                pb: 0.5,
              },
              "& .MuiMenuItem-root:first-of-type": {
                borderTopLeftRadius: "10px",
                borderTopRightRadius: "10px",
              },
            },
          },
        }}
      >
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
                  <NostrAvatar
                    user={acct}
                    size={26}
                    fallbackText={(acct.name?.[0] || acct.pubkey.slice(0, 2)).toUpperCase()}
                  />
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

        {/* Unlock (active account is a locked passphrase key) */}
        {locked && (
          <MenuItem
            onClick={() => {
              unlock();
              handleClose();
            }}
          >
            <ListItemIcon>
              <LockOpenOutlinedIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText
              primary="Unlock"
              secondary="Enter your passphrase"
              secondaryTypographyProps={{ variant: "caption" }}
            />
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

        {/* Theme trigger -> opens dedicated Theme Dialog */}
        <MenuItem
          onClick={() => {
            setThemeDialogOpen(true);
            handleClose();
          }}
        >
          <ListItemIcon>
            <PaletteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Theme"
            secondary={themes[themeId].label}
            secondaryTypographyProps={{ variant: "caption" }}
          />
          <Box
            sx={{
              width: 24,
              height: 15,
              borderRadius: "4px",
              overflow: "hidden",
              border: "1px solid rgba(128,128,128,0.3)",
              display: "flex",
              flexShrink: 0,
              ml: 1,
            }}
          >
            <Box sx={{ flex: 1, bgcolor: themes[themeId].swatch }} />
            <Box sx={{ flex: 1, bgcolor: themes[themeId].accentSwatch }} />
          </Box>
        </MenuItem>

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

        {/* Dictation */}
        <MenuItem
          onClick={() => {
            setDictationOpen(true);
            handleClose();
          }}
        >
          <ListItemIcon>
            <MicIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Dictation"
            secondary="On-device voice typing"
            secondaryTypographyProps={{ variant: "caption" }}
          />
        </MenuItem>
      </Menu>

      {/* Dedicated Themes Dialog */}
      <Dialog
        open={themeDialogOpen}
        onClose={() => setThemeDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            backgroundImage: "none",
            bgcolor: "background.paper",
            p: 1,
          },
        }}
      >
        <DialogTitle sx={{ pb: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PaletteIcon sx={{ color: "secondary.main", fontSize: 22 }} />
            <Typography variant="h6" sx={{ fontSize: "1.05rem", fontWeight: 700 }}>
              Choose Theme
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setThemeDialogOpen(false)}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 1, px: 2, pb: 2 }}>
          <Typography
            variant="caption"
            sx={{
              display: "block",
              mb: 1.5,
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "text.disabled",
              textTransform: "uppercase",
            }}
          >
            Available Themes ({Object.keys(themes).length})
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {(Object.entries(themes) as [ThemeId, ThemeDefinition][]).map(([id, def]) => {
              const isSelected = themeId === id;
              return (
                <Box
                  key={id}
                  onClick={() => {
                    onSelectTheme(id);
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    p: 1.25,
                    borderRadius: 1,
                    cursor: "pointer",
                    border: "1px solid",
                    borderColor: isSelected ? "secondary.main" : (t) => alpha(t.palette.text.primary, 0.08),
                    bgcolor: isSelected ? (t) => alpha(t.palette.secondary.main, 0.12) : (t) => alpha(t.palette.text.primary, 0.02),
                    "&:hover": {
                      bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
                      borderColor: (t) => alpha(t.palette.secondary.main, 0.4),
                    },
                    transition: "all 0.15s ease",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    {/* Two-tone swatch */}
                    <Box
                      sx={{
                        width: 34,
                        height: 22,
                        borderRadius: "4px",
                        overflow: "hidden",
                        border: "1.5px solid",
                        borderColor: (t) => alpha(t.palette.text.primary, 0.2),
                        display: "flex",
                        flexShrink: 0,
                        boxShadow: 1,
                      }}
                    >
                      <Box sx={{ flex: 1, bgcolor: def.swatch }} />
                      <Box sx={{ flex: 1, bgcolor: def.accentSwatch }} />
                    </Box>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: isSelected ? 700 : 500, fontSize: "0.85rem" }}>
                        {def.label}
                      </Typography>
                    </Box>
                  </Box>
                  {isSelected && (
                    <Box
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: 0.75,
                        bgcolor: "secondary.main",
                        color: "secondary.contrastText",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <CheckIcon sx={{ fontSize: 13 }} />
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
      </Dialog>

      <BlossomServersModal
        open={blossomOpen}
        onClose={() => setBlossomOpen(false)}
      />
      <DictationSettingsDialog
        open={dictationOpen}
        onClose={() => setDictationOpen(false)}
      />
    </>
  );
}
