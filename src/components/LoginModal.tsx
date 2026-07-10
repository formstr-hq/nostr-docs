// src/components/LoginModal.tsx
import {
  Dialog,
  Button,
  TextField,
  Typography,
  Box,
  Alert,
  ButtonBase,
  Divider,
  CircularProgress,
  IconButton,
  useMediaQuery,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import PhonelinkLockOutlinedIcon from "@mui/icons-material/PhonelinkLockOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import QrCode2OutlinedIcon from "@mui/icons-material/QrCode2Outlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { useState, useEffect, useRef, type ReactNode } from "react";
import QRCode from "qrcode";
import { signerManager } from "../signer";
import type { AndroidSignerAppInfo } from "@formstr/signer";
import { isNativePlatform, isCapacitor } from "../signer/secureStorage";
import FormstrLogo from "../assets/formstr-pages-logo.png";

// Default relays for NIP-46 nostrconnect (QR) pairing. Several, because the
// pairing fails outright if *every* listed relay is unreachable — and
// relay.nsec.app alone is blocked/flaky on some networks.
const NIP46_DEFAULT_RELAYS =
  "wss://relay.nsec.app, wss://nos.lol, wss://relay.damus.io";

// nostr-tools rejects with this when no pairing relay could be subscribed
// (unreachable, timed out, or the relay refused the REQ).
const NC_SUB_CLOSED = "subscription closed before connection was established";

// How long the bunker (NIP-46 URI) connect may take before we give up: the
// underlying request has no timeout of its own, so an offline bunker would
// otherwise leave the modal waiting forever.
const BUNKER_CONNECT_TIMEOUT_MS = 60_000;

// Which detail screen the two-step chooser is showing. `null` == the menu.
// NIP-07 / NIP-55 are one-tap actions fired straight from the menu, so they
// have no detail screen.
type DetailKey = "create" | "existing" | "bunker" | "qr";

const DETAIL_TITLES: Record<DetailKey, string> = {
  create: "Create Account",
  existing: "Existing Key",
  bunker: "Nostr Bunker",
  qr: "Remote Signer",
};

export default function LoginModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  // Two-step navigation: null = method menu, otherwise the focused detail form.
  const [detail, setDetail] = useState<DetailKey | null>(null);
  // The detail pane keeps rendering the last-opened form while sliding back to
  // the menu, so the outgoing pane doesn't blank out mid-transition.
  const [renderedDetail, setRenderedDetail] = useState<DetailKey>("create");

  const [uri, setUri] = useState("");
  const [bunkerPending, setBunkerPending] = useState(false);
  const [ncRelays, setNcRelays] = useState(NIP46_DEFAULT_RELAYS);
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

  // Abort any in-flight nostrconnect pairing and clear transient QR state.
  const abortPairing = () => {
    ncAbortRef.current?.abort();
    ncAbortRef.current = null;
    setNcDataUrl("");
    setNcPending(false);
    setNcError("");
  };

  // Close the modal: abort pairing, clear sensitive inputs, reset to the menu.
  const handleClose = () => {
    abortPairing();
    setError("");
    setDetail(null);
    setCreatePass("");
    setCreateConfirm("");
    setExistingNcryptsec("");
    setExistingPass("");
    setUri("");
    onClose();
  };

  // Open a focused detail form.
  const goDetail = (key: DetailKey) => {
    setError("");
    setRenderedDetail(key);
    setDetail(key);
  };

  // Slide back to the method menu (and abort a pairing if we were on the QR).
  const goMenu = () => {
    abortPairing();
    setError("");
    setDetail(null);
  };

  const handleNip07 = async () => {
    setError("");
    // The package reads `globalThis.nostr`; surface a clear, actionable message
    // when no extension has injected it (common on localhost, or if disabled
    // for this site) instead of the cryptic "globalThis.nostr is undefined".
    if (typeof window !== "undefined" && !("nostr" in window)) {
      setError(
        "No Nostr browser extension detected. Install one (e.g. Alby or nos2x) and enable it for this site, then try again."
      );
      return;
    }
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
    if (!uri || bunkerPending) return;
    setError("");
    setBunkerPending(true);
    try {
      // The connect request never times out on its own — an offline bunker or
      // an unanswered approval prompt would hang here indefinitely.
      await Promise.race([
        signerManager.loginWithNip46(uri),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "The bunker didn't respond. Check the URI and that your signer app is online, then try again."
                )
              ),
            BUNKER_CONNECT_TIMEOUT_MS
          )
        ),
      ]);
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bunker login failed");
    } finally {
      setBunkerPending(false);
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
      await signerManager.loginWithNcryptsec(
        existingNcryptsec.trim(),
        existingPass
      );
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
            setNcDataUrl(
              await QRCode.toDataURL(ncUri, { width: 240, margin: 1 })
            );
          } catch {
            setNcDataUrl("");
          }
        },
      });
      handleClose();
    } catch (e: unknown) {
      if (!controller.signal.aborted) {
        const msg = e instanceof Error ? e.message : "QR pairing failed";
        setNcError(
          msg.includes(NC_SUB_CLOSED)
            ? "Couldn't reach any pairing relay. Check the relay list and your network, then try again."
            : msg
        );
        setNcDataUrl("");
      }
    } finally {
      setNcPending(false);
    }
  };

  const createMismatch =
    createConfirm.length > 0 && createPass !== createConfirm;

  // ── The focused detail form for the right-hand pane ──
  const renderDetail = (key: DetailKey): ReactNode => {
    switch (key) {
      case "create":
        return (
          <>
            <TextField
              fullWidth
              size="small"
              label="Passphrase"
              type="password"
              value={createPass}
              onChange={(e) => setCreatePass(e.target.value)}
              sx={{ mb: 1.25 }}
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
              sx={{ mb: 1.5 }}
            />
            <Button
              fullWidth
              variant="contained"
              onClick={handleCreate}
              disabled={!createPass || createMismatch || createLoading}
              startIcon={
                createLoading ? <CircularProgress size={16} /> : undefined
              }
            >
              {createLoading ? "Creating…" : "Create account"}
            </Button>
            <SecurityNote>
              We'll generate a recovery key (<code>ncryptsec</code>) you must
              save — it's the only way to restore this account elsewhere.
            </SecurityNote>
          </>
        );

      case "existing":
        return (
          <>
            <TextField
              fullWidth
              size="small"
              label="ncryptsec1…"
              value={existingNcryptsec}
              onChange={(e) => setExistingNcryptsec(e.target.value)}
              sx={{ mb: 1.25 }}
            />
            <TextField
              fullWidth
              size="small"
              label="Passphrase"
              type="password"
              value={existingPass}
              onChange={(e) => setExistingPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExisting()}
              sx={{ mb: 1.5 }}
            />
            <Button
              fullWidth
              variant="contained"
              onClick={handleExisting}
              disabled={!existingNcryptsec || !existingPass}
            >
              Sign in
            </Button>
          </>
        );

      case "bunker":
        return (
          <>
            <TextField
              fullWidth
              size="small"
              label="Bunker URI (bunker://…)"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNip46()}
              disabled={bunkerPending}
              sx={{ mb: 1.5 }}
            />
            <Button
              fullWidth
              variant="contained"
              onClick={handleNip46}
              disabled={!uri || bunkerPending}
              startIcon={
                bunkerPending ? <CircularProgress size={16} /> : undefined
              }
            >
              {bunkerPending ? "Waiting for approval…" : "Connect"}
            </Button>
          </>
        );

      case "qr":
        return (
          <>
            {ncError && (
              <Alert severity="error" sx={{ borderRadius: 2, mb: 1.25 }}>
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
              sx={{ mb: 1.5 }}
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
                fullWidth
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
          </>
        );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="xs"
        fullWidth
        fullScreen={fullScreen}
        PaperProps={{
          sx: {
            borderRadius: fullScreen ? 0 : 3,
            overflow: "hidden",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
            ...(fullScreen ? {} : { maxHeight: "min(660px, 92vh)" }),
          },
        }}
      >
        {/* ── Header (persistent) ── */}
        <Box
          sx={{
            px: 3,
            pt: 3.5,
            pb: 2.5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.25,
            borderBottom: `1px solid ${theme.palette.divider}`,
            flexShrink: 0,
          }}
        >
          <img
            src={FormstrLogo}
            alt="Pages by Form*"
            style={{ width: 52, height: 52, borderRadius: 14 }}
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

        {/* ── Sliding body: menu ⇄ detail ── */}
        <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <Box
            sx={{
              display: "flex",
              width: "200%",
              alignItems: "flex-start",
              transition: "transform .34s cubic-bezier(.4,0,.2,1)",
              transform: detail ? "translateX(-50%)" : "none",
            }}
          >
            {/* Pane 1 — method menu */}
            <Box sx={{ width: "50%", flexShrink: 0, p: 2.5 }}>
              <HeroCard onClick={() => goDetail("create")} />

              <Divider sx={{ my: 2 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    fontWeight: 700,
                    fontSize: "0.65rem",
                  }}
                >
                  Already have an identity?
                </Typography>
              </Divider>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                {/* NIP-07 — web only, one-tap */}
                {!isNativePlatform && (
                  <MethodRow
                    icon={<VpnKeyOutlinedIcon />}
                    title="Browser Extension"
                    description="Alby, nos2x, Flamingo"
                    accent={theme.palette.secondary.main}
                    onClick={handleNip07}
                  />
                )}

                {/* NIP-55 external signers — Capacitor (Android) only, one-tap */}
                {isCapacitor &&
                  installedSigners.map((signer) => (
                    <MethodRow
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
                      description="External Android signer"
                      accent={theme.palette.secondary.main}
                      onClick={() => handleNip55(signer.packageName)}
                    />
                  ))}

                <MethodRow
                  icon={<KeyOutlinedIcon />}
                  title="Existing Key"
                  description="Sign in with an ncryptsec"
                  accent={theme.palette.primary.main}
                  onClick={() => goDetail("existing")}
                />
                <MethodRow
                  icon={<HubOutlinedIcon />}
                  title="Nostr Bunker"
                  description="Connect via NIP-46 URI"
                  accent={theme.palette.secondary.main}
                  onClick={() => goDetail("bunker")}
                />
                <MethodRow
                  icon={<QrCode2OutlinedIcon />}
                  title="Remote Signer (QR)"
                  description="Scan with your signer app"
                  accent={theme.palette.secondary.main}
                  onClick={() => goDetail("qr")}
                />
              </Box>
            </Box>

            {/* Pane 2 — focused detail */}
            <Box sx={{ width: "50%", flexShrink: 0, p: 2.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 2 }}>
                <IconButton
                  size="small"
                  onClick={goMenu}
                  aria-label="Back to options"
                  sx={{ ml: -0.5 }}
                >
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
                <Typography variant="subtitle1" fontWeight={700}>
                  {DETAIL_TITLES[renderedDetail]}
                </Typography>
              </Box>

              {renderDetail(renderedDetail)}
            </Box>
          </Box>
        </Box>

        {/* ── Footer ── */}
        <Box
          sx={{
            px: 3,
            py: 1.25,
            borderTop: `1px solid ${theme.palette.divider}`,
            flexShrink: 0,
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

/* ── Security/info callout ── */
function SecurityNote({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 1,
        alignItems: "flex-start",
        p: 1.25,
        mt: 1.25,
        borderRadius: 2,
        bgcolor: "action.hover",
      }}
    >
      <ShieldOutlinedIcon
        sx={{ fontSize: 18, color: "secondary.main", mt: "1px", flexShrink: 0 }}
      />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ lineHeight: 1.5 }}
      >
        {children}
      </Typography>
    </Box>
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

/* ── Hero "Create account" CTA (menu, primary path) ── */
function HeroCard({ onClick }: { onClick: () => void }) {
  const theme = useTheme();
  const p = theme.palette.primary.main;
  const s = theme.palette.secondary.main;
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 1.75,
        p: 2,
        textAlign: "left",
        borderRadius: 2.5,
        border: `1.5px solid ${alpha(p, 0.3)}`,
        background: `linear-gradient(135deg, ${alpha(p, 0.13)}, ${alpha(
          s,
          0.07
        )})`,
        transition: "transform .14s, box-shadow .14s",
        "&:hover": {
          transform: "translateY(-1px)",
          boxShadow: `0 8px 20px ${alpha(p, 0.18)}`,
        },
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: alpha(p, 0.16),
          color: p,
        }}
      >
        <PersonAddAltOutlinedIcon />
      </Box>
      <Box flex={1} minWidth={0}>
        <Typography variant="body1" fontWeight={700} lineHeight={1.3}>
          Create a new account
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Fresh key, protected by a passphrase
        </Typography>
      </Box>
      <ChevronRightIcon sx={{ color: "text.secondary", flexShrink: 0 }} />
    </ButtonBase>
  );
}

/* ── Menu row — opens a detail screen ── */
function MethodRow({
  icon,
  title,
  description,
  accent,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  accent: string;
  onClick: () => void;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 1.75,
        px: 1.5,
        py: 1.5,
        textAlign: "left",
        borderRadius: 2,
        transition: "background 0.15s",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: 2,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: alpha(accent, isDark ? 0.18 : 0.14),
          color: accent,
        }}
      >
        {icon}
      </Box>
      <Box flex={1} minWidth={0}>
        <Typography variant="body1" fontWeight={600} lineHeight={1.3}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>
      <ChevronRightIcon
        sx={{ color: "text.secondary", opacity: 0.5, flexShrink: 0 }}
      />
    </ButtonBase>
  );
}
