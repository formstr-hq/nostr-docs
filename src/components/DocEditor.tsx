import { useEffect, useState } from "react";
import {
  Box,
  Paper,
  Button,
  Typography,
  useTheme,
  IconButton,
  Snackbar,
  Alert,
} from "@mui/material";
import ReactMarkdown from "react-markdown";
import { publishEvent } from "../nostr/publish";
import { useDocumentContext } from "../contexts/DocumentContext";
import { signerManager } from "../signer";
import { useRelays } from "../contexts/RelayContext";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useMediaQuery } from "@mui/material";
import ShareModal from "./ShareModal";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Menu, MenuItem, ListItemIcon, ListItemText } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import { deleteEvent } from "../nostr/deleteRequest";
import ConfirmModal from "./common/ConfirmModal";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  nip44,
  type Event,
} from "nostr-tools";
import { encodeNKeys } from "../utils/nkeys";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { getConversationKey } from "nostr-tools/nip44";
import { useSharedPages } from "../contexts/SharedDocsContext";
import { fetchEventsByKind, KIND_FILE } from "../nostr/fetchFile";
import { useRef } from "react";

export default function DocEditor({
  viewKey,
  editKey,
}: {
  viewKey?: string;
  editKey?: string;
}) {
  const { documents, selectedDocumentId, removeDocument, addDocument } =
    useDocumentContext();
  const doc = documents.get(selectedDocumentId || "");
  const initial = doc?.decryptedContent || "";
  const isNewDoc = !selectedDocumentId;
  const [md, setMd] = useState(initial);
  const [mode, setMode] = useState<"edit" | "preview">(
    isNewDoc ? "edit" : "preview"
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: "",
  });
  const [saving, setSaving] = useState(false);
  const menuOpen = Boolean(menuAnchor);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { addSharedDoc, refresh } = useSharedPages();

  const theme = useTheme(); // <-- MUI theme hook
  const { relays } = useRelays();
  const isMobile = useMediaQuery("(max-width:900px)");
  const mdRef = useRef(md);
  const lastSavedMdRef = useRef(md);

  useEffect(() => {
    mdRef.current = md;
  }, [md]);

  useEffect(() => {
    if (!autosaveEnabled) return;

    const interval = setInterval(() => {
      if (mode === "edit" && mdRef.current.trim()) {
        saveSnapshot(mdRef.current);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [mode, autosaveEnabled]);
  useEffect(() => {
    if (!autosaveEnabled) return;

    const interval = setInterval(() => {
      if (mode === "edit" && md.trim()) {
        saveSnapshot();
      }
    }, 20000); // autosave every 20 seconds

    return () => clearInterval(interval); // cleanup on unmount or toggle
  }, [mode, autosaveEnabled]);

  useEffect(() => {
    (async () => {
      let pubkey;
      if (editKey) pubkey = getPublicKey(hexToBytes(editKey));
      else pubkey = await (await signerManager.getSigner())!.getPublicKey();

      fetchEventsByKind(relays, KIND_FILE, pubkey, (event: Event) => {
        if (viewKey) {
          addDocument(event, { viewKey });
        } else {
          addDocument(event);
        }
      });
    })();
  }, [selectedDocumentId, relays, viewKey]);

  async function handleGeneratePrivateLink(canEdit: boolean) {
    if (!selectedDocumentId) return;
    const signer = await signerManager.getSigner();

    const doc = documents.get(selectedDocumentId);
    if (!doc) return;

    // 1️⃣ Generate keys
    const viewKeyUsed = viewKey ? hexToBytes(viewKey) : generateSecretKey();
    const editKeyUsed = canEdit
      ? editKey
        ? hexToBytes(editKey)
        : generateSecretKey()
      : null;

    const conversationKey = getConversationKey(
      viewKeyUsed,
      getPublicKey(viewKeyUsed)
    );
    const encryptedContent = nip44.encrypt(
      doc.decryptedContent,
      conversationKey
    );

    // 3️⃣ Create shared event
    const sharedEvent = {
      kind: 33457,
      tags: [["d", selectedDocumentId]],
      content: encryptedContent,
      created_at: Math.floor(Date.now() / 1000),
    };

    // 4️⃣ Sign with editKey if exists, else viewKey
    let signedEvent: Event | null = null;
    if (editKeyUsed) signedEvent = finalizeEvent(sharedEvent, editKeyUsed);
    else {
      signedEvent = await signer.signEvent(sharedEvent);
    }

    // 5️⃣ Publish
    await publishEvent(signedEvent, relays);
    // Store Keys
    const buildTag = [
      `${KIND_FILE}:${
        editKeyUsed ? getPublicKey(editKeyUsed) : await signer.getPublicKey()
      }:${selectedDocumentId}`,
    ];
    if (viewKeyUsed) buildTag.push(bytesToHex(viewKeyUsed));
    if (editKeyUsed) buildTag.push(bytesToHex(editKeyUsed));
    if (buildTag.length > 1) {
      await addSharedDoc(buildTag);
      refresh();
    }

    if (editKeyUsed)
      await deleteEvent({
        eventKind: 33457,
        eventId: selectedDocumentId!,
        relays,
        reason: "User requested deletion",
      });

    // 6️⃣ Encode keys in one nkeys string
    const nkeysStr = encodeNKeys({
      viewKey: bytesToHex(viewKeyUsed),
      ...(editKeyUsed && { editKey: bytesToHex(editKeyUsed) }),
    });

    // 7️⃣ Build URL
    const naddr = nip19.naddrEncode({
      kind: 33457,
      pubkey: signedEvent.pubkey,
      identifier: selectedDocumentId,
    });

    const shareUrl = `${window.location.origin}/doc/${naddr}#${nkeysStr}`;

    return shareUrl;
  }

  const handleSharePublic = () => {
    console.log("TODO: Share publicly");
    setShareOpen(false);
  };

  const encryptContent = async (content: string, viewKey?: string) => {
    if (viewKey) {
      const conversationKey = nip44.getConversationKey(
        hexToBytes(viewKey),
        getPublicKey(hexToBytes(viewKey))
      );
      const encryptedcontent = nip44.encrypt(content, conversationKey);
      return Promise.resolve(encryptedcontent);
    }
    const signer = await signerManager.getSigner();
    if (!signer) return;
    return signer.nip44Encrypt!(await signer.getPublicKey(), content);
  };

  const handleDelete = async (skipPrompt = false) => {
    if (skipPrompt) {
      await deleteEvent({
        eventKind: 33457,
        eventId: selectedDocumentId!,
        relays,
        reason: "User requested deletion",
      });
      removeDocument(selectedDocumentId!);
      return;
    }

    setConfirmOpen(true);
  };

  const saveSnapshot = async (content?: string) => {
    if (saving) return; // prevent overlapping saves
    setSaving(true);
    const mdToSave = content ?? md;
    if (mdToSave === lastSavedMdRef.current) return;
    const signer = await signerManager.getSigner();
    if (!signer && !editKey) return;
    let dTag = selectedDocumentId;
    if (!dTag) {
      dTag = makeTag(6);
    }

    try {
      const encryptedContent = await encryptContent(mdToSave, viewKey);
      if (!encryptedContent) return;

      const event = {
        kind: 33457,
        tags: [["d", dTag]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: await signer.getPublicKey!(),
      };
      let signed: Event | null = null;
      if (editKey) signed = finalizeEvent(event, hexToBytes(editKey));
      else signed = await signer.signEvent(event);
      await publishEvent(signed!, relays);
      lastSavedMdRef.current = mdToSave;
      setToast({ open: true, message: "Saved" });
    } catch (err) {
      console.error("Failed to save snapshot:", err);
      setToast({ open: true, message: "Failed to save!" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {/* Toolbar */}
      <Paper
        elevation={2}
        sx={{
          p: 1.5,
          px: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          bgcolor: "background.paper",
          borderRadius: 2,
          border: "1px solid rgba(0,0,0,0.08)",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <Box sx={{ display: "flex", gap: 2 }}>
          <Box sx={{ display: "flex", gap: 2 }}>
            {mode === "preview" ? (
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => setMode("edit")}
                startIcon={<EditIcon />}
                sx={{ fontWeight: 700 }}
              >
                Edit
              </Button>
            ) : (
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => setMode("preview")}
                startIcon={<VisibilityIcon />}
                sx={{ fontWeight: 700 }}
              >
                Preview
              </Button>
            )}
          </Box>

          <Button
            variant="contained"
            color="secondary"
            onClick={() => saveSnapshot()}
            sx={{ fontWeight: 700 }}
          >
            {saving ? "Saving..." : "Save"}
          </Button>

          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <MoreVertIcon />
          </IconButton>

          <Menu
            anchorEl={menuAnchor}
            open={menuOpen}
            onClose={() => setMenuAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                setShareOpen(true);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <ShareIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Share" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                handleDelete();
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <DeleteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Delete" />
            </MenuItem>
            <MenuItem
              onClick={() => {
                setAutosaveEnabled(!autosaveEnabled);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <EditIcon fontSize="small" />{" "}
                {/* You could use a better icon if desired */}
              </ListItemIcon>
              <ListItemText
                primary={
                  autosaveEnabled ? "Disable Autosave" : "Enable Autosave"
                }
              />
            </MenuItem>
          </Menu>
        </Box>
      </Paper>

      {/* Editor Surface */}
      <Paper
        elevation={1}
        sx={{
          flex: 1, // fill remaining vertical space
          display: "flex",
          flexDirection: "column", // textarea grows correctly
          minHeight: 0, // crucial for Chrome flexbox
          p: 3,
          borderRadius: 3,
          bgcolor: "background.paper",
          border: "1px solid rgba(0,0,0,0.08)",
          overflowY: "auto",
        }}
      >
        {mode === "edit" && (
          <Box
            component="textarea"
            value={md}
            placeholder="Start typing your page here (Markdown supported)"
            onChange={(e) => setMd(e.target.value)}
            style={{
              flex: 1, // use flex instead of height: 100%
              width: "100%",
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              color: theme.palette.text.primary,
              fontSize: "17px",
              lineHeight: 1.7,
              fontFamily:
                '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}
          />
        )}

        {mode === "preview" && (
          <Box
            title="Double-click to edit"
            onDoubleClick={() => setMode("edit")}
            sx={{
              cursor: "text",
              "& h1,h2,h3,h4": {
                color: theme.palette.text.primary,
                fontWeight: 800,
              },
              "& p": { color: theme.palette.text.secondary },
            }}
          >
            {md?.trim() ? (
              <ReactMarkdown>{md}</ReactMarkdown>
            ) : (
              <Typography color="text.secondary">
                Nothing to preview yet,{" "}
                {isMobile
                  ? "double tap this text to edit"
                  : "double click this text to edit"}
              </Typography>
            )}
          </Box>
        )}
      </Paper>
      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onPublicPost={() => handleSharePublic()}
        onPrivateLink={(canEdit) => handleGeneratePrivateLink(canEdit)}
      />
      <ConfirmModal
        open={confirmOpen}
        title="Delete Document?"
        description="This sends a deletion request to your relays. This process is irreversible. Do you wish to proceed?"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={async () => {
          setConfirmOpen(false);
          await deleteEvent({
            eventKind: 33457,
            eventId: selectedDocumentId!,
            relays,
            reason: "User requested deletion",
          });
          removeDocument(selectedDocumentId!);
        }}
        onCancel={() => {
          setConfirmOpen(false);
        }}
      />
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast({ ...toast, open: false })}
      >
        <Alert severity="success" sx={{ width: "100%" }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
function makeTag(length: number): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);

  return Array.from(arr, (x) => chars[x % chars.length]).join("");
}
