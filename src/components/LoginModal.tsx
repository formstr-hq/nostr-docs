// src/components/LoginModal.tsx
import {
  Dialog,
  Stack,
  Button,
  TextField,
  Typography,
  Collapse,
  Box,
  Alert,
  ButtonBase,
  Divider,
} from "@mui/material";
import { ThemeProvider, useTheme } from "@mui/material/styles";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PhonelinkLockOutlinedIcon from "@mui/icons-material/PhonelinkLockOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useState, type ReactNode } from "react";
import { signerManager } from "../signer";
import { generateSecretKey } from "nostr-tools";
import { isNativePlatform, isCapacitor } from "../signer/secureStorage";
import { AMBER_PACKAGE } from "../signer/NIP55Signer";
import FormstrLogo from "../assets/formstr-pages-logo.png";

export default function LoginModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [showNip46, setShowNip46] = useState(false);
  const [showNsec, setShowNsec] = useState(false);
  const [uri, setUri] = useState("");
  const [nsec, setNsec] = useState("");
  const [error, setError] = useState<string>("");

  const handleNip07 = async () => {
    setError("");
    try {
      await signerManager.loginWithNip07();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "NIP-07 login failed");
    }
  };

  const handleGuest = async () => {
    setError("");
    try {
      const key = generateSecretKey();
      await signerManager.createGuestAccount(key);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Temporary login failed");
    }
  };

  const handleAmber = async () => {
    setError("");
    try {
      await signerManager.loginWithNip55(AMBER_PACKAGE);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Amber sign-in failed");
    }
  };

  const handleNsec = async () => {
    if (!nsec) return;
    setError("");
    try {
      await signerManager.loginWithNsec(nsec);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid nsec");
    }
  };

  const handleNip46 = async () => {
    if (!uri) return;
    setError("");
    try {
      await signerManager.loginWithNip46(uri);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bunker login failed");
    }
  };

  const isDark = theme.palette.mode === "dark";
  const accentAlpha = isDark ? "22" : "18";

  return (
    <ThemeProvider theme={theme}>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: "hidden",
            bgcolor: "background.paper",
          },
        }}
      >
        {/* ── Header ── */}
        <Box
          sx={{
            px: 3,
            pt: 4,
            pb: 3,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.5,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <img
            src={FormstrLogo}
            alt="Pages by Form*"
            style={{ width: 56, height: 56, borderRadius: 14 }}
          />
          <Box textAlign="center">
            <Typography variant="h6" fontWeight={700}>
              Sign in
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              Choose how you'd like to access your documents
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ width: "100%", borderRadius: 2 }}>
              {error}
            </Alert>
          )}
        </Box>

        {/* ── Options ── */}
        <Stack divider={<Divider />}>
          {/* NIP-07 — web only */}
          {!isNativePlatform && (
            <OptionButton
              icon={<VpnKeyOutlinedIcon />}
              title="Browser Extension"
              description="Alby, nos2x, Flamingo"
              accentColor={theme.palette.primary.main}
              accentAlpha={accentAlpha}
              onClick={handleNip07}
            />
          )}

          {/* nsec — native only (Tauri / Capacitor) */}
          {isNativePlatform && (
            <Box>
              <OptionButton
                icon={<LockOutlinedIcon />}
                title="Private Key (nsec)"
                description="Stored securely on this device"
                accentColor={theme.palette.primary.main}
                accentAlpha={accentAlpha}
                onClick={() => setShowNsec((p) => !p)}
                chevronRotated={showNsec}
              />
              <Collapse in={showNsec}>
                <Box
                  sx={{
                    px: 2,
                    pb: 2,
                    display: "flex",
                    gap: 1,
                    bgcolor: `${theme.palette.primary.main}${accentAlpha}`,
                  }}
                >
                  <TextField
                    fullWidth
                    size="small"
                    label="nsec1..."
                    type="password"
                    value={nsec}
                    onChange={(e) => setNsec(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleNsec()}
                  />
                  <Button
                    variant="contained"
                    onClick={handleNsec}
                    disabled={!nsec}
                    sx={{ flexShrink: 0 }}
                  >
                    Sign in
                  </Button>
                </Box>
              </Collapse>
            </Box>
          )}

          {/* Amber / NIP-55 — Capacitor (Android) only */}
          {isCapacitor && (
            <OptionButton
              icon={<PhonelinkLockOutlinedIcon />}
              title="Amber"
              description="Sign with external Android signer"
              accentColor={theme.palette.secondary.main}
              accentAlpha={accentAlpha}
              onClick={handleAmber}
            />
          )}

          {/* NIP-46 */}
          <Box>
            <OptionButton
              icon={<HubOutlinedIcon />}
              title="Nostr Bunker"
              description="Connect via NIP-46"
              accentColor={theme.palette.secondary.main}
              accentAlpha={accentAlpha}
              onClick={() => setShowNip46((p) => !p)}
              chevronRotated={showNip46}
            />
            <Collapse in={showNip46}>
              <Box
                sx={{
                  px: 2,
                  pb: 2,
                  display: "flex",
                  gap: 1,
                  bgcolor: `${theme.palette.secondary.main}${accentAlpha}`,
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  label="Bunker URI"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleNip46()}
                />
                <Button
                  variant="contained"
                  onClick={handleNip46}
                  disabled={!uri}
                  sx={{ flexShrink: 0 }}
                >
                  Connect
                </Button>
              </Box>
            </Collapse>
          </Box>

          {/* Guest */}
          <OptionButton
            icon={<PersonOutlinedIcon />}
            title="Temporary Account"
            description="Quick access, no keys needed"
            accentColor={theme.palette.text.secondary}
            accentAlpha={accentAlpha}
            onClick={handleGuest}
          />
        </Stack>

        {/* ── Footer ── */}
        <Box
          sx={{
            px: 3,
            py: 1.5,
            borderTop: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Button
            fullWidth
            variant="text"
            color="inherit"
            onClick={onClose}
            sx={{ color: "text.secondary", fontSize: "0.8rem" }}
          >
            Cancel
          </Button>
        </Box>
      </Dialog>
    </ThemeProvider>
  );
}

/* ── Option row component ── */
function OptionButton({
  icon,
  title,
  description,
  accentColor,
  accentAlpha,
  onClick,
  chevronRotated = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  accentColor: string;
  accentAlpha: string;
  onClick: () => void;
  chevronRotated?: boolean;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2.5,
        py: 1.75,
        textAlign: "left",
        transition: "background 0.15s",
        "&:hover": { bgcolor: `${accentColor}${accentAlpha}` },
      }}
    >
      {/* Icon badge */}
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 2,
          bgcolor: `${accentColor}${accentAlpha}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: accentColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>

      {/* Text */}
      <Box flex={1} minWidth={0}>
        <Typography variant="body1" fontWeight={600} lineHeight={1.3}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>

      {/* Chevron */}
      <ChevronRightIcon
        sx={{
          color: "text.secondary",
          opacity: 0.5,
          flexShrink: 0,
          transition: "transform 0.2s",
          transform: chevronRotated ? "rotate(90deg)" : "none",
        }}
      />
    </ButtonBase>
  );
}
