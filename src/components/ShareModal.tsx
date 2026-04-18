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
import { useACL } from "../hooks/useACL";
import CloseIcon from "@mui/icons-material/Close";
import { useState } from "react";
import { shareDocumentToNpub } from "../nostr/shareDocument";
import { nip19 } from "nostr-tools";

type Props = {
  open: boolean;
  onClose: () => void;
  onPublicPost?: () => void;
  onPrivateLink?: (canEdit: boolean) => Promise<string | void>;
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
  const { acl, grantAccess } = useACL(documentAddress);
  const [privateLink, setPrivateLink] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [inviteRole, setInviteRole] = useState<"view" | "edit">("view");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteNpub, setInviteNpub] = useState("");
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [error, setError] = useState<string>("");

  const handlePrivateLink = async () => {
    if (!onPrivateLink) return;
    setLoading(true);
    setError("");
    try {
      const url = await onPrivateLink(canEdit);
      if (typeof url === "string") {
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

  const handleCopy = () => {
    if (!privateLink) return;
    navigator.clipboard.writeText(privateLink);
    setToastMessage("Link copied to clipboard!");
    setToastOpen(true);
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

      // Always securely generate the specific permission key before sending.
      // We don't reuse `privateLink` casually here because the user might have
      // clicked 'Viewer' up there, but 'Editor' down here!
      const newUrl = await onPrivateLink(inviteRole === "edit");
      if (typeof newUrl !== "string") throw new Error("Failed to generate link");
      const url = newUrl;

      // Send the DM
      await shareDocumentToNpub(targetPubkey, url, docTitle);
      
      // Log the grant explicitly into our zero-server ACL engine
      grantAccess(targetPubkey, inviteRole);
      
      setToastMessage("Invite sent successfully via Nostr DM!");
      setToastOpen(true);
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
    setError("");
    onClose();
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
                  } catch {}
                  
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
                      {onCloneAndRevoke && (
                        <IconButton 
                          size="small" 
                          color="error" 
                          onClick={async () => {
                            if (window.confirm("REVOKING ACCESS:\n\nBecause Nostr handles encryption natively, revoking access physically creates a clone of the document under a new cryptographic key, deletes the old document, and resends the new link to the remaining members.\n\nAre you sure you want to proceed?")) {
                              setLoading(true);
                              try {
                                const remaining = acl.filter(r => r.npub !== record.npub);
                                await onCloneAndRevoke(record.npub, remaining);
                              } catch (err) {
                                console.error(err);
                                alert("Failed to revoke: " + err);
                              } finally {
                                setLoading(false);
                              }
                            }
                          }}
                          disabled={loading}
                        >
                          <CloseIcon fontSize="small"/>
                        </IconButton>
                      )}
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
              Nostr Connect
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Send an invite directly to a friend's Nostr inbox (NIP-17 DM).
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
        open={toastOpen}
        autoHideDuration={3000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" sx={{ width: "100%" }}>
          {toastMessage}
        </Alert>
      </Snackbar>
    </>
  );
}
