import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Switch,
  Box,
  TextField,
  CircularProgress,
  Snackbar,
  Alert,
  InputAdornment,
  IconButton,
  Avatar,
  Tooltip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import CopyLinkIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import LinkIcon from "@mui/icons-material/Link";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAlt";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PublicIcon from "@mui/icons-material/Public";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import ArticleIcon from "@mui/icons-material/Article";
import DescriptionIcon from "@mui/icons-material/Description";
import { useEffect, useState, type ReactNode } from "react";
import { nip19 } from "nostr-tools";

type Props = {
  open: boolean;
  onClose: () => void;
  docTitle?: string;
  onPublicPost?: () => void;
  onPublish?: (target: "longform" | "communityNip") => void;
  onPrivateLink?: (canEdit: boolean, rotate?: boolean, open?: boolean) => Promise<string | void>;
  existingViewLink?: string;
  existingEditLink?: string;
  /** v2 group share: current editors (owner-managed). */
  members?: { pubkey: string; role: string }[];
  /** Add an editor by npub or hex pubkey. Presence enables the editors UI. */
  onAddEditor?: (npubOrHex: string) => Promise<void>;
  onRemoveEditor?: (pubkey: string) => Promise<void>;
  /** True when the selected doc is a v2 group document (tweaks copy). */
  v2?: boolean;
  /** Current v2 write mode, if any. */
  mode?: "restricted" | "open";
};

/** Short, human-readable form of a hex pubkey (as an npub when encodable). */
function shortPubkey(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return pubkey.length > 16 ? `${pubkey.slice(0, 10)}…${pubkey.slice(-6)}` : pubkey;
  }
}

/** A subtle tinted panel that groups one area of the dialog. */
function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 2,
        bgcolor: (t) =>
          t.palette.mode === "dark"
            ? alpha(t.palette.common.white, 0.02)
            : alpha(t.palette.common.black, 0.015),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 1.25,
            bgcolor: (t) => alpha(t.palette.secondary.main, 0.14),
            color: "secondary.main",
            flexShrink: 0,
            "& svg": { fontSize: 15 },
          }}
        >
          {icon}
        </Box>
        <Typography
          sx={{
            fontSize: "0.68rem",
            fontWeight: 800,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "text.secondary",
          }}
        >
          {title}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

/** A labelled on/off row with the switch at the trailing edge. */
function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
  ariaLabel,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 0.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          {subtitle}
        </Typography>
      </Box>
      <Switch
        checked={checked}
        onChange={onChange}
        color="secondary"
        slotProps={{ input: { "aria-label": ariaLabel } }}
      />
    </Box>
  );
}

export default function ShareModal({
  open,
  onClose,
  docTitle,
  onPrivateLink,
  onPublish,
  existingViewLink = "",
  existingEditLink = "",
  members = [],
  onAddEditor,
  onRemoveEditor,
  v2 = false,
  mode,
}: Props) {
  const [canEdit, setCanEdit] = useState(false);
  const [openEdit, setOpenEdit] = useState(mode === "open");
  const [generatedLink, setGeneratedLink] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [editorInput, setEditorInput] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");

  // Reset every piece of transient state when the dialog transitions to open.
  useEffect(() => {
    if (!open) return;
    setCanEdit(false);
    setGeneratedLink("");
    setWorking(false);
    setError("");
    setCopied(false);
    setEditorInput("");
    setEditorError("");
  }, [open]);

  // Reflect the document's current write mode while the dialog is open. (The
  // roster loads asynchronously, so `mode` can become known after opening.)
  useEffect(() => {
    if (open) setOpenEdit(mode === "open");
  }, [open, mode]);

  const existingLink = canEdit ? existingEditLink : existingViewLink;
  // Prefer a link created in this session; fall back to one the document
  // already has for the selected access level.
  const privateLink = generatedLink || existingLink || "";
  const isFreshLink = !!generatedLink;

  const handleAddEditor = async () => {
    if (!onAddEditor) return;
    const value = editorInput.trim();
    if (!value) return;
    setEditorBusy(true);
    setEditorError("");
    try {
      await onAddEditor(value);
      setEditorInput("");
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to add editor");
    } finally {
      setEditorBusy(false);
    }
  };

  const handleRemoveEditor = async (pubkey: string) => {
    if (!onRemoveEditor) return;
    setEditorBusy(true);
    setEditorError("");
    try {
      await onRemoveEditor(pubkey);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to remove editor");
    } finally {
      setEditorBusy(false);
    }
  };

  const handlePrivateLink = async () => {
    if (!onPrivateLink) return;
    setWorking(true);
    setError("");
    try {
      const rotate = !canEdit && !!privateLink;
      const url = await onPrivateLink(canEdit, rotate, openEdit);
      if (typeof url === "string" && url) {
        setGeneratedLink(url);
        setCopied(false);
      } else {
        setError("Couldn't create a link. Please try again.");
      }
    } catch (err) {
      console.error("Failed to generate private link:", err);
      setError(err instanceof Error ? err.message : "Couldn't create a link");
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async () => {
    if (!privateLink) return;
    try {
      await navigator.clipboard.writeText(privateLink);
    } catch {
      // Clipboard API can be unavailable (permissions / insecure context).
      const el = document.createElement("textarea");
      el.value = privateLink;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(el);
      }
    }
    setCopied(true);
    setToastOpen(true);
  };

  const handleClose = () => {
    setGeneratedLink("");
    setCanEdit(false);
    setWorking(false);
    setError("");
    setCopied(false);
    setEditorInput("");
    setEditorError("");
    onClose();
  };

  // The primary action for the link area: nothing to show yet, or a view link
  // that can be rotated. Edit links are minted once and then reused, so there
  // is no regenerate action for them.
  const showRotate = !!privateLink && !canEdit;
  const accessSubtitle = canEdit
    ? existingEditLink
      ? "This page already has a shared editable copy — any edits collaborators have made are preserved."
      : v2
        ? "Anyone with the link can view. Only the people you add as editors below can edit."
        : "Creates a separate shared copy. Anyone with the link can edit it — your original document is unaffected."
    : existingViewLink
      ? "Anyone with the link can read this page. Rotating the link revokes the current one."
      : "Anyone with the link can read this page. Rotating later revokes the current link.";

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              backgroundImage: "none",
              bgcolor: "background.paper",
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 1.5,
            pr: 2,
            pb: 1,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: 1.75,
              bgcolor: (t) => alpha(t.palette.secondary.main, 0.16),
              color: "secondary.main",
              flexShrink: 0,
              mt: 0.25,
            }}
          >
            <PublicIcon sx={{ fontSize: 19 }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", lineHeight: 1.2 }}>
              Share Page
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.25 }}
              noWrap
            >
              {docTitle ? `“${docTitle}” · ` : ""}Control who can view and edit this page.
            </Typography>
          </Box>
          <IconButton
            aria-label="Dismiss share dialog"
            onClick={handleClose}
            size="small"
            sx={{ mt: -0.5, mr: -0.75 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: "8px !important" }}
        >
          {/* ── Access ─────────────────────────────────────────── */}
          <Section icon={<LockOutlinedIcon />} title="Access">
            <ToggleRow
              ariaLabel="Can edit"
              title="Can edit"
              subtitle={accessSubtitle}
              checked={canEdit}
              onChange={() => {
                setCanEdit((v) => !v);
                setGeneratedLink("");
                setError("");
                setCopied(false);
              }}
            />

            {canEdit && v2 && (
              <Box
                sx={{
                  mt: 1,
                  pt: 1,
                  borderTop: "1px solid",
                  borderColor: "divider",
                }}
              >
                <ToggleRow
                  ariaLabel="Anyone with the link can edit"
                  title="Anyone with the link can edit"
                  subtitle={
                    openEdit
                      ? "This page is open — any link holder can make changes."
                      : "Only people you invite as editors can make changes."
                  }
                  checked={openEdit}
                  onChange={() => {
                    setOpenEdit((v) => !v);
                    setGeneratedLink("");
                    setError("");
                    setCopied(false);
                  }}
                />
              </Box>
            )}
          </Section>

          {/* ── Link ───────────────────────────────────────────── */}
          <Section icon={<LinkIcon />} title={canEdit ? "Edit link" : "View link"}>
            {privateLink ? (
              <>
                <TextField
                  fullWidth
                  size="small"
                  label={canEdit ? "Edit link" : "View link"}
                  value={privateLink}
                  slotProps={{
                    input: {
                      readOnly: true,
                      sx: { fontFamily: "monospace", fontSize: "0.78rem" },
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title={copied ? "Copied" : "Copy link"}>
                            <IconButton
                              size="small"
                              onClick={handleCopy}
                              color={copied ? "success" : "default"}
                              aria-label="Copy link"
                            >
                              {copied ? (
                                <CheckIcon fontSize="small" />
                              ) : (
                                <CopyLinkIcon fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    },
                  }}
                  onFocus={(e) => e.target.select()}
                />

                {isFreshLink && (
                  <Alert severity="success" icon={false} sx={{ mt: 1.5, py: 0.25 }}>
                    <Typography variant="caption">
                      Link ready. Copy it and send it to the people you want to share
                      with.
                    </Typography>
                  </Alert>
                )}

                <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
                  <Button
                    variant="contained"
                    color="secondary"
                    size="small"
                    startIcon={copied ? <CheckIcon /> : <CopyLinkIcon />}
                    onClick={() => void handleCopy()}
                    sx={{ fontWeight: 700 }}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  {showRotate && (
                    <Button
                      variant="outlined"
                      color="secondary"
                      size="small"
                      startIcon={<AutorenewIcon />}
                      onClick={() => void handlePrivateLink()}
                      disabled={working}
                      sx={{ fontWeight: 700 }}
                    >
                      {working ? "Rotating…" : "Rotate View Access"}
                    </Button>
                  )}
                </Box>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {canEdit
                    ? "Create a link that lets people edit a shared copy of this page."
                    : "Create a read-only link to this page."}
                </Typography>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={() => void handlePrivateLink()}
                  disabled={working}
                  startIcon={
                    working ? <CircularProgress size={16} color="inherit" /> : <LinkIcon />
                  }
                  sx={{ fontWeight: 700 }}
                >
                  {working ? "Creating…" : "Generate Link"}
                </Button>
              </>
            )}

            {error && (
              <Alert severity="error" sx={{ mt: 1.5, py: 0.25 }}>
                <Typography variant="caption">{error}</Typography>
              </Alert>
            )}
          </Section>

          {/* ── Editors (v2 group share) ───────────────────────── */}
          {onAddEditor && (
            <Section icon={<GroupOutlinedIcon />} title="Editors">
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                {openEdit
                  ? "This page is open — anyone with the link can edit. Adding an editor switches it to invited-editors-only."
                  : "Only the people listed here can edit this page. Anyone with the link can view."}
              </Typography>

              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <TextField
                  size="small"
                  fullWidth
                  label="npub1… or hex pubkey"
                  value={editorInput}
                  onChange={(e) => setEditorInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddEditor();
                    }
                  }}
                  disabled={editorBusy}
                />
                <Button
                  variant="contained"
                  color="secondary"
                  sx={{ fontWeight: 700, whiteSpace: "nowrap", minWidth: 92 }}
                  onClick={() => void handleAddEditor()}
                  disabled={editorBusy || !editorInput.trim()}
                  startIcon={<PersonAddAltIcon />}
                >
                  Add
                </Button>
              </Box>

              {editorError && (
                <Typography color="error" variant="caption" sx={{ mt: 1, display: "block" }}>
                  {editorError}
                </Typography>
              )}

              {members.length > 0 && (
                <Box sx={{ mt: 1, display: "flex", flexDirection: "column" }}>
                  {members.map((m) => (
                    <Box
                      key={m.pubkey}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        py: 0.9,
                        borderTop: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      <Avatar
                        sx={{
                          width: 26,
                          height: 26,
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          bgcolor: (t) => alpha(t.palette.secondary.main, 0.18),
                          color: "secondary.main",
                        }}
                      >
                        {m.pubkey.slice(0, 2).toUpperCase()}
                      </Avatar>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: "monospace", flex: 1, minWidth: 0 }}
                        noWrap
                      >
                        {shortPubkey(m.pubkey)}
                      </Typography>
                      {onRemoveEditor && (
                        <Tooltip title="Remove editor">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => void handleRemoveEditor(m.pubkey)}
                            disabled={editorBusy}
                            aria-label={`Remove editor ${m.pubkey.slice(0, 8)}`}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  ))}
                </Box>
              )}
            </Section>
          )}

          {/* ── Publish publicly ───────────────────────────────── */}
          {onPublish && (
            <Section icon={<ArticleIcon />} title="Publish">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Post this page to Nostr for anyone to read — images become public.
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button
                  variant="outlined"
                  color="secondary"
                  size="small"
                  startIcon={<ArticleIcon />}
                  sx={{ fontWeight: 700 }}
                  onClick={() => onPublish("longform")}
                >
                  Publish as Article
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  size="small"
                  startIcon={<DescriptionIcon />}
                  sx={{ fontWeight: 700 }}
                  onClick={() => onPublish("communityNip")}
                >
                  Publish as NIP
                </Button>
              </Box>
            </Section>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
          <Button onClick={handleClose} color="secondary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toastOpen}
        autoHideDuration={3000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" sx={{ width: "100%" }}>
          Link copied to clipboard!
        </Alert>
      </Snackbar>
    </>
  );
}
