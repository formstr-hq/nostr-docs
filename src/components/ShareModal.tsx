import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Paper,
  Typography,
  Switch,
  Box,
  TextField,
  CircularProgress,
  Snackbar,
  Alert,
  InputAdornment,
  IconButton,
  Select,
  MenuItem,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SendIcon from "@mui/icons-material/Send";
import { useACL } from "../hooks/useACL";
import CloseIcon from "@mui/icons-material/Close";
import { useState } from "react";
import { shareDocumentToNpub } from "../nostr/shareDocument";
import { nip19 } from "nostr-tools";
import ConfirmModal from "./common/ConfirmModal";
import { signerManager } from "../signer";
import { encodeNKeys } from "../utils/nkeys";
import { useSharedPages } from "../contexts/SharedDocsContext";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublicPost?: () => void;
  onPrivateLink?: (canEdit: boolean) => Promise<
    | {
        address: string;
        viewKey: string;
        editKey?: string;
      }
    | void
  >;
  docTitle?: string;
  documentAddress?: string;
  onCloneAndRevoke?: (revokedNpub: string, remainingAcl: Array<{npub: string, role: "view"|"edit"}>) => Promise<void>;
};

export default function ShareModal({ 
  open, 
  onClose, 
  onPrivateLink, 
  docTitle = "Untitled",
  documentAddress,
  onCloneAndRevoke
}: Props) {
  const [canEdit, setCanEdit] = useState(false);
  const { registerOutgoingInviteId } = useSharedPages();
  const { acl, grantAccess } = useACL(documentAddress);
  const [privateLink, setPrivateLink] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [inviteRole, setInviteRole] = useState<"view" | "edit">("view");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteNpub, setInviteNpub] = useState("");
  const [toast, setToast] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const [error, setError] = useState<string>("");
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [pendingRevokeNpub, setPendingRevokeNpub] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState<string | null>(null);

  const revokeWarningText =
    "REVOKING ACCESS: Because Nostr handles encryption natively, revoking access physically creates a clone of the document under a new cryptographic key, deletes the old document, and resends the new link to the remaining members. Are you sure you want to proceed?";

  const handlePrivateLink = async () => {
    if (!onPrivateLink) return;
    setLoading(true);
    setError("");
    try {
      const result = await onPrivateLink(canEdit);
      if (result && result.address) {
        // Build the URL here for the copy-paste box
        const naddr = nip19.naddrEncode({
          identifier: result.address.split(":")[2],
          pubkey: result.address.split(":")[1],
          kind: parseInt(result.address.split(":")[0]),
        });
        const nkeysObj: Record<string, string> = { viewKey: result.viewKey };
        if (result.editKey) nkeysObj.editKey = result.editKey;
        const url = `${window.location.origin}/doc/${naddr}#${encodeNKeys(nkeysObj)}`;
        setPrivateLink(url);
      } else {
        setError("Failed to generate link. Please try again.");
      }
    } catch (err) {
      console.error("Failed to generate private link:", err);
      setError(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!privateLink) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable on this device.");
      }
      await navigator.clipboard.writeText(privateLink);
      setToast({
        open: true,
        message: "Link copied to clipboard!",
        severity: "success",
      });
    } catch (err) {
      console.error("Failed to copy link:", err);
      setToast({
        open: true,
        message: "Could not copy link. Please copy it manually.",
        severity: "error",
      });
    }
  };

  const handleInvite = async () => {
    if (!inviteNpub.trim() || !onPrivateLink) return;
    setInviteLoading(true);
    setError("");
    
    try {
      // Decode npub to hex
      let targetPubkey = inviteNpub.trim();
      if (targetPubkey.startsWith("npub")) {
        const decoded = nip19.decode(targetPubkey);
        if (decoded.type !== "npub") throw new Error("Invalid npub");
        targetPubkey = decoded.data as string;
      } else if (targetPubkey.length !== 64) {
        throw new Error("Invalid npub or public key");
      }

      // Block self-sharing
      const signer = await signerManager.getSigner();
      const myPubkey = await signer.getPublicKey();
      if (targetPubkey === myPubkey) {
        throw new Error("You cannot send an invite to yourself.");
      }

      // Always securely generate the specific permission key before sending.
      // We don't reuse `privateLink` casually here because the user might have
      // clicked 'Viewer' up there, but 'Editor' down here!
      // Generate the keys and metadata payload
      const result = await onPrivateLink(inviteRole === "edit");
      if (!result || typeof result !== "object") throw new Error("Failed to generate link");

      // Send the high-level invite (NIP-17 rumor kind 211234)
      const inviteId = await shareDocumentToNpub(targetPubkey, {
        type: "share",
        address: result.address,
        viewKey: result.viewKey,
        ...(result.editKey && { editKey: result.editKey }),
        title: docTitle,
      });
      registerOutgoingInviteId(inviteId);
      
      // Log the grant explicitly into our zero-server ACL engine
      grantAccess(targetPubkey, inviteRole);
      
      setToast({
        open: true,
        message: "Invite sent directly to account!",
        severity: "success",
      });
      setInviteNpub("");
    } catch (err) {
      console.error("Invite failed:", err);
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleClose = () => {
    setPrivateLink("");
    setInviteNpub("");
    setCanEdit(false);
    setLoading(false);
    setInviteLoading(false);
    setRevokeConfirmOpen(false);
    setPendingRevokeNpub(null);
    setError("");
    onClose();
  };

  const handleConfirmRevoke = async () => {
    if (!onCloneAndRevoke || !pendingRevokeNpub) return;
    setRevokeConfirmOpen(false);
    setLoading(true);
    try {
      const remaining = acl.filter((r) => r.npub !== pendingRevokeNpub);
      await onCloneAndRevoke(pendingRevokeNpub, remaining);
    } catch (err) {
      console.error(err);
      const reason = err instanceof Error ? err.message : String(err);
      setToast({
        open: true,
        message: `Failed to revoke: ${reason}`,
        severity: "error",
      });
    } finally {
      setPendingRevokeNpub(null);
      setLoading(false);
    }
  };

  const handleResendInvite = async (npub: string, role: "view" | "edit") => {
    if (!onPrivateLink) return;
    setResendLoading(npub);
    try {
      const targetPubkey = nip19.decode(npub).data as string;
      const result = await onPrivateLink(role === "edit");
      if (!result || typeof result !== "object") throw new Error("Failed to generate link");

      const inviteId = await shareDocumentToNpub(targetPubkey, {
        type: "share",
        address: result.address,
        viewKey: result.viewKey,
        ...(result.editKey && { editKey: result.editKey }),
        title: docTitle,
      });
      registerOutgoingInviteId(inviteId);

      setToast({
        open: true,
        message: `Invite resent to ${npub.slice(0, 12)}...`,
        severity: "success",
      });
    } catch (err) {
      console.error("Resend failed:", err);
      setToast({
        open: true,
        message: `Failed to resend: ${err instanceof Error ? err.message : "Unknown error"}`,
        severity: "error",
      });
    } finally {
      setResendLoading(null);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Share Page</DialogTitle>

        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
        >
          {/* PEOPLE WITH ACCESS */}
          {(acl.length > 0) && (
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "background.paper" }}>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>
                People with access
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {acl.map((record) => {
                  let prettyTarget = record.npub;
                  try {
                    prettyTarget = nip19.npubEncode(record.npub);
                  } catch {
                    prettyTarget = record.npub;
                  }
                  
                  return (
                    <Box key={record.npub} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <Box sx={{ display: "flex", flexDirection: "column" }}>
                        <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                          {prettyTarget.slice(0, 12)}...{prettyTarget.slice(-6)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {record.role === "edit" ? "Editor" : "Viewer"}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        {onPrivateLink && (
                          <IconButton 
                            size="small" 
                            color="secondary"
                            onClick={() => void handleResendInvite(record.npub, record.role)}
                            disabled={loading || resendLoading === record.npub}
                            title="Resend invite"
                          >
                            <SendIcon fontSize="small"/>
                          </IconButton>
                        )}
                        {onCloneAndRevoke && (
                          <IconButton 
                            size="small" 
                            color="error" 
                            onClick={() => {
                              setPendingRevokeNpub(record.npub);
                              setRevokeConfirmOpen(true);
                            }}
                            disabled={loading}
                            title="Revoke access"
                          >
                            <CloseIcon fontSize="small"/>
                          </IconButton>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Paper>
          )}

          {/* PRIVATE LINK */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" fontWeight={800}>
              Get private link
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              Only people with the link will have access.
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <Typography color="text.secondary">Can view</Typography>
              <Switch
                checked={canEdit}
                onChange={() => setCanEdit((v) => !v)}
                color="secondary"
              />
              <Typography color="text.secondary">Can edit</Typography>
            </Box>
            {canEdit && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Creates a separate shared copy. Anyone with the link can edit it — your original document is unaffected.
              </Typography>
            )}

            <Button
              variant="contained"
              color="secondary"
              sx={{ mt: 2, fontWeight: 700, position: "relative" }}
              onClick={handlePrivateLink}
              disabled={loading}
            >
              {loading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                "Generate Link"
              )}
            </Button>

            {error && (
              <Typography color="error" sx={{ mt: 2 }}>
                {error}
              </Typography>
            )}

            {privateLink && (
              <TextField
                sx={{ mt: 2 }}
                fullWidth
                label="Private Link"
                value={privateLink}
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={handleCopy}>
                        <ContentCopyIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                onFocus={(e) => e.target.select()}
              />
            )}
          </Paper>

          {/* INVITE BY NPUB */}
          <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
            <Typography variant="h6" fontWeight={800}>
              Share to Account
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Share directly to a Nostr account. They'll be notified in-app.
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField 
                fullWidth 
                size="small" 
                placeholder="npub1..." 
                value={inviteNpub} 
                onChange={(e) => setInviteNpub(e.target.value)}
              />
              <Select
                size="small"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "view" | "edit")}
                sx={{ minWidth: "110px" }}
              >
                <MenuItem value="view">Viewer</MenuItem>
                <MenuItem value="edit">Editor</MenuItem>
              </Select>
              <Button 
                variant="contained" 
                color="primary"
                onClick={handleInvite}
                disabled={inviteLoading || !inviteNpub.trim()}
                sx={{ minWidth: "120px" }}
              >
                {inviteLoading ? <CircularProgress size={20} color="inherit" /> : "Send Invite"}
              </Button>
            </Box>
          </Paper>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} color="secondary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={toast.severity}
          sx={{ width: "100%", maxWidth: 420, alignItems: "center" }}
        >
          {toast.message}
        </Alert>
      </Snackbar>

      <ConfirmModal
        open={revokeConfirmOpen}
        title="Revoke Access"
        description={revokeWarningText}
        confirmText="Revoke"
        cancelText="Cancel"
        onCancel={() => {
          setRevokeConfirmOpen(false);
          setPendingRevokeNpub(null);
        }}
        onConfirm={handleConfirmRevoke}
      />
    </>
  );
}
