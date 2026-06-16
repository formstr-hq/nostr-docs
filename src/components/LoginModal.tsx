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
  CircularProgress,
  IconButton,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import PhonelinkLockOutlinedIcon from "@mui/icons-material/PhonelinkLockOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import QrCode2OutlinedIcon from "@mui/icons-material/QrCode2Outlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useState, useEffect, useRef, type ReactNode } from "react";
import QRCode from "qrcode";
import { signerManager } from "../signer";
import type { AndroidSignerAppInfo } from "@formstr/signer";
import { isNativePlatform, isCapacitor } from "../signer/secureStorage";
import { DEFAULT_RELAYS } from "../nostr/relayPool";
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
  const [showNc, setShowNc] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showExisting, setShowExisting] = useState(false);

  const [uri, setUri] = useState("");
  const [ncRelays, setNcRelays] = useState(DEFAULT_RELAYS.join(", "));
  const [ncDataUrl, setNcDataUrl] = useState("");
  const [ncPending, setNcPending] = useState(false);
  const [ncError, setNcError] = useState("");

  const [createPass, setCreatePass] = useState("");
  const [createConfirm, setCreateConfirm] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [backupNcryptsec, setBackupNcryptsec] = useState("");
  const [backupNpub, setBackupNpub] = useState("");

  const [existingNcryptsec, setExistingNcryptsec] = useState("");
  const [existingPass, setExistingPass] = useState("");

  const [error, setError] = useState<string>("");
  const [installedSigners, setInstalledSigners] = useState<
    AndroidSignerAppInfo[]
  >([]);
  const ncAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isCapacitor) return;
    const loadSigners = async () => {
      try {
        setInstalledSigners(await signerManager.listNip55Apps());
      } catch {
        setInstalledSigners([]);
      }
    };
    loadSigners();
  }, []);

  // Abort any in-flight nostrconnect pairing and clear transient state, then
  // close. Used for every close path so a stale QR never lingers.
  const handleClose = () => {
    ncAbortRef.current?.abort();
    ncAbortRef.current = null;
    setNcDataUrl("");
    setNcPending(false);
    setNcError("");
    onClose();
  };

  const handleNip07 = async () => {
    setError("");
    try {
      await signerManager.loginWithNip07();
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "NIP-07 login failed");
    }
  };

  const handleNip55 = async (packageName: string) => {
    setError("");
    try {
      await signerManager.loginWithNip55(packageName);
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Signer sign-in failed");
    }
  };

  const handleNip46 = async () => {
    if (!uri) return;
    setError("");
    try {
      await signerManager.loginWithNip46(uri);
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bunker login failed");
    }
  };

  const handleCreate = async () => {
    if (!createPass || createPass !== createConfirm || createLoading) return;
    setError("");
    setCreateLoading(true);
    try {
      const { ncryptsec, npub } = await signerManager.createAccount(createPass);
      // Surface the recovery key in its own dialog, then close the login modal.
      // The backup dialog is controlled by `backupNcryptsec`, so it survives
      // the login modal closing.
      setBackupNpub(npub);
      setBackupNcryptsec(ncryptsec);
      setCreatePass("");
      setCreateConfirm("");
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not create account");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleExisting = async () => {
    if (!existingNcryptsec || !existingPass) return;
    setError("");
    try {
      await signerManager.loginWithNcryptsec(existingNcryptsec.trim(), existingPass);
      setExistingNcryptsec("");
      setExistingPass("");
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Wrong passphrase or key");
    }
  };

  const handleNostrConnect = async () => {
    setNcError("");
    setNcDataUrl("");
    const relayList = ncRelays
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (relayList.length === 0) {
      setNcError("Enter at least one relay");
      return;
    }
    setNcPending(true);
    const controller = new AbortController();
    ncAbortRef.current = controller;
    try {
      await signerManager.loginWithNostrConnect({
        relays: relayList,
        signal: controller.signal,
        onUri: async (ncUri) => {
          try {
            setNcDataUrl(await QRCode.toDataURL(ncUri, { width: 240, margin: 1 }));
          } catch {
            setNcDataUrl("");
          }
        },
      });
      handleClose();
    } catch (e: unknown) {
      if (!controller.signal.aborted) {
        setNcError(e instanceof Error ? e.message : "QR pairing failed");
      }
    } finally {
      setNcPending(false);
    }
  };

  const isDark = theme.palette.mode === "dark";
  const accentAlpha = isDark ? "22" : "18";
  const createMismatch =
    createConfirm.length > 0 && createPass !== createConfirm;

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
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
          {/* Create account (NIP-49) */}
          <Box>
            <OptionButton
              icon={<PersonAddAltOutlinedIcon />}
              title="Create Account"
              description="New key, secured by a passphrase"
              accentColor={theme.palette.primary.main}
              accentAlpha={accentAlpha}
              onClick={() => setShowCreate((p) => !p)}
              chevronRotated={showCreate}
            />
            <Collapse in={showCreate}>
              <Box
                sx={{
                  px: 2,
                  pb: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  bgcolor: `${theme.palette.primary.main}${accentAlpha}`,
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  label="Passphrase"
                  type="password"
                  value={createPass}
                  onChange={(e) => setCreatePass(e.target.value)}
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Confirm passphrase"
                  type="password"
                  value={createConfirm}
                  error={createMismatch}
                  helperText={createMismatch ? "Passphrases don't match" : undefined}
                  onChange={(e) => setCreateConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <Button
                  variant="contained"
                  onClick={handleCreate}
                  disabled={!createPass || createMismatch || createLoading}
                  startIcon={
                    createLoading ? <CircularProgress size={16} /> : undefined
                  }
                >
                  {createLoading ? "Creating…" : "Create account"}
                </Button>
              </Box>
            </Collapse>
          </Box>

          {/* Existing key (ncryptsec) */}
          <Box>
            <OptionButton
              icon={<KeyOutlinedIcon />}
              title="Existing Key"
              description="Sign in with an ncryptsec"
              accentColor={theme.palette.primary.main}
              accentAlpha={accentAlpha}
              onClick={() => setShowExisting((p) => !p)}
              chevronRotated={showExisting}
            />
            <Collapse in={showExisting}>
              <Box
                sx={{
                  px: 2,
                  pb: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  bgcolor: `${theme.palette.primary.main}${accentAlpha}`,
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  label="ncryptsec1..."
                  value={existingNcryptsec}
                  onChange={(e) => setExistingNcryptsec(e.target.value)}
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Passphrase"
                  type="password"
                  value={existingPass}
                  onChange={(e) => setExistingPass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleExisting()}
                />
                <Button
                  variant="contained"
                  onClick={handleExisting}
                  disabled={!existingNcryptsec || !existingPass}
                >
                  Sign in
                </Button>
              </Box>
            </Collapse>
          </Box>

          {/* NIP-07 — web only */}
          {!isNativePlatform && (
            <OptionButton
              icon={<VpnKeyOutlinedIcon />}
              title="Browser Extension"
              description="Alby, nos2x, Flamingo"
              accentColor={theme.palette.secondary.main}
              accentAlpha={accentAlpha}
              onClick={handleNip07}
            />
          )}

          {/* NIP-55 external signers — Capacitor (Android) only */}
          {isCapacitor &&
            installedSigners.map((signer) => (
              <OptionButton
                key={signer.packageName}
                icon={
                  signer.iconUrl ? (
                    <img
                      src={signer.iconUrl}
                      alt={signer.name}
                      style={{ width: 24, height: 24, borderRadius: 4 }}
                    />
                  ) : (
                    <PhonelinkLockOutlinedIcon />
                  )
                }
                title={signer.name}
                description="Sign with external Android signer"
                accentColor={theme.palette.secondary.main}
                accentAlpha={accentAlpha}
                onClick={() => handleNip55(signer.packageName)}
              />
            ))}

          {/* NIP-46 — bunker URI */}
          <Box>
            <OptionButton
              icon={<HubOutlinedIcon />}
              title="Nostr Bunker"
              description="Connect via NIP-46 URI"
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

          {/* NIP-46 — nostrconnect (QR) */}
          <Box>
            <OptionButton
              icon={<QrCode2OutlinedIcon />}
              title="Remote Signer (QR)"
              description="Scan with your signer app"
              accentColor={theme.palette.secondary.main}
              accentAlpha={accentAlpha}
              onClick={() => setShowNc((p) => !p)}
              chevronRotated={showNc}
            />
            <Collapse in={showNc}>
              <Box
                sx={{
                  px: 2,
                  pb: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  bgcolor: `${theme.palette.secondary.main}${accentAlpha}`,
                }}
              >
                {ncError && (
                  <Alert severity="error" sx={{ borderRadius: 2 }}>
                    {ncError}
                  </Alert>
                )}
                <TextField
                  fullWidth
                  size="small"
                  label="Relays (comma-separated)"
                  value={ncRelays}
                  onChange={(e) => setNcRelays(e.target.value)}
                  disabled={ncPending}
                />
                {ncDataUrl ? (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 1,
                      py: 1,
                    }}
                  >
                    <img
                      src={ncDataUrl}
                      alt="nostrconnect QR"
                      style={{ width: 200, height: 200, borderRadius: 8 }}
                    />
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CircularProgress size={14} />
                      <Typography variant="caption" color="text.secondary">
                        Waiting for your signer…
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  <Button
                    variant="contained"
                    onClick={handleNostrConnect}
                    disabled={ncPending}
                    startIcon={
                      ncPending ? <CircularProgress size={16} /> : undefined
                    }
                  >
                    {ncPending ? "Generating…" : "Generate QR"}
                  </Button>
                )}
              </Box>
            </Collapse>
          </Box>
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
            onClick={handleClose}
            sx={{ color: "text.secondary", fontSize: "0.8rem" }}
          >
            Cancel
          </Button>
        </Box>
      </Dialog>

      {/* Recovery-key backup — its own dialog so it survives the login modal
          auto-closing once the new account becomes active. */}
      <RecoveryKeyDialog
        ncryptsec={backupNcryptsec}
        npub={backupNpub}
        onDone={() => {
          setBackupNcryptsec("");
          setBackupNpub("");
        }}
      />
    </>
  );
}

/* ── Recovery key backup dialog ── */
function RecoveryKeyDialog({
  ncryptsec,
  npub,
  onDone,
}: {
  ncryptsec: string;
  npub: string;
  onDone: () => void;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ncryptsec);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  return (
    <Dialog
      open={Boolean(ncryptsec)}
      onClose={onDone}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, bgcolor: "background.paper" } }}
    >
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="h6" fontWeight={700}>
          Save your recovery key
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This passphrase-encrypted key (<code>ncryptsec</code>) is the only way
          to recover {npub ? `${npub.slice(0, 12)}…` : "your account"} on another
          device. Store it somewhere safe — we can't recover it for you.
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 1,
            p: 1.5,
            borderRadius: 2,
            bgcolor: theme.palette.action.hover,
            wordBreak: "break-all",
          }}
        >
          <Typography
            variant="caption"
            sx={{ fontFamily: "monospace", flex: 1 }}
          >
            {ncryptsec}
          </Typography>
          <IconButton size="small" onClick={copy} aria-label="Copy recovery key">
            <ContentCopyOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
        <Button variant="contained" onClick={onDone}>
          {copied ? "Copied — I've saved it" : "I've saved it"}
        </Button>
      </Box>
    </Dialog>
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
