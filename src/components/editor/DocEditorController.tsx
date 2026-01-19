import { useEffect, useRef, useState } from "react";
import { Box, Paper, Snackbar, Alert, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { finalizeEvent, getPublicKey, nip19, type Event } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";

import { useDocumentContext } from "../../contexts/DocumentContext";
import { signerManager } from "../../signer";
import { useRelays } from "../../contexts/RelayContext";
import { publishEvent } from "../../nostr/publish";
import { makeTag } from "../../utils/makeTag";

import { EditorToolbar } from "./EditorToolbar";
import { DocEditorSurface } from "./DocEditorSurface";
import { deleteEvent } from "../../nostr/deleteRequest";
import ConfirmModal from "../common/ConfirmModal";
import ShareModal from "../ShareModal";
import { handleGeneratePrivateLink, handleSharePublic } from "./utils";
import { encryptContent } from "../../utils/encryption";
import { KIND_FILE } from "../../nostr/kinds";

export function DocumentEditorController({
  viewKey,
  editKey,
}: {
  viewKey?: string;
  editKey?: string;
}) {
  const {
    documents,
    selectedDocumentId,
    setSelectedDocumentId,
    removeDocument,
    addDocument,
  } = useDocumentContext();

  const navigate = useNavigate();
  const { relays } = useRelays();

  const isDraft = selectedDocumentId === null;
  const doc = selectedDocumentId ? documents.get(selectedDocumentId) : null;
  console.log("received doc", doc, selectedDocumentId, documents);

  const [md, setMd] = useState(doc?.decryptedContent || "");
  const [mode, setMode] = useState<"edit" | "preview">(
    isDraft ? "edit" : "preview",
  );
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [toast, setToast] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const [shareOpen, setShareOpen] = useState(false);

  const lastSavedMdRef = useRef<string>("");
  useEffect(() => {
    if (!doc) return;

    setMd(doc.decryptedContent ?? "");
    lastSavedMdRef.current = doc.decryptedContent ?? "";
  }, [doc?.event.id]);

  /* -----------------------------
     LOW-LEVEL SNAPSHOT (UNCHANGED)
  ------------------------------ */

  const saveSnapshotWithDTag = async (dTag: string, content: string) => {
    const signer = await signerManager.getSigner();

    if (!signer && !editKey) {
      throw new Error("No signer");
    }

    const encryptedContent = await encryptContent(content, viewKey);
    if (!encryptedContent) throw new Error("Encryption failed");

    const event = {
      kind: 33457,
      tags: [["d", dTag]],
      content: encryptedContent,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: await signer.getPublicKey!(),
    };

    let signed: Event;
    if (editKey) {
      signed = finalizeEvent(event, hexToBytes(editKey));
    } else {
      signed = await signer.signEvent(event);
    }
    addDocument(signed, {
      viewKey: viewKey,
      editKey: editKey,
    });

    await publishEvent(signed, relays);
  };

  /* -----------------------------
     EXPLICIT SAVE METHODS
  ------------------------------ */

  const saveNewDocument = async (content: string): Promise<string> => {
    const dTag = makeTag(6);
    await saveSnapshotWithDTag(dTag, content);
    setSelectedDocumentId(dTag);
    const pubkey = editKey
      ? getPublicKey(hexToBytes(editKey))
      : await (await signerManager.getSigner()).getPublicKey();
    const naddr = nip19.naddrEncode({
      pubkey: pubkey,
      kind: KIND_FILE,
      identifier: dTag,
    });
    navigate(`/doc/${naddr}`, { replace: true });
    return dTag;
  };

  const saveExistingDocument = async (dTag: string, content: string) => {
    await saveSnapshotWithDTag(dTag, content);
  };

  /* -----------------------------
     PUBLIC SAVE ENTRYPOINT
  ------------------------------ */

  const handleSave = async (silent = false) => {
    console.log("Begin Saving");
    if (saving) return;

    const mdToSave = md;
    if (mdToSave === lastSavedMdRef.current) return;

    setSaving(true);
    try {
      if (isDraft) {
        await saveNewDocument(mdToSave);
      } else {
        await saveExistingDocument(selectedDocumentId!, mdToSave);
      }

      lastSavedMdRef.current = mdToSave;

      if (!silent) {
        setToast({ open: true, message: "Saved", severity: "success" });
      }
    } catch (err) {
      console.error("Save failed:", err);
      setToast({
        open: true,
        message: "Failed to save!",
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
    console.log("Saving done");
  };

  /* -----------------------------
     AUTOSAVE (UNCHANGED SEMANTICS)
  ------------------------------ */

  //   useEffect(() => {
  //     if (!selectedDocumentId) return;

  //     const id = setInterval(() => {
  //       handleSave();
  //     }, 20_000);

  //     return () => clearInterval(id);
  //   }, [selectedDocumentId]);

  /* -----------------------------
     RENDER
  ------------------------------ */

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
  console.log("MD value is", md);

  return (
    <Box
      sx={{ height: "100%", display: "flex", flexDirection: "column", gap: 2 }}
    >
      <EditorToolbar
        saving={saving}
        mode={mode}
        onSave={() => handleSave(false)}
        onToggleMode={() => setMode((m) => (m === "edit" ? "preview" : "edit"))}
        handleDelete={handleDelete}
        onShare={() => {
          setShareOpen(true);
        }}
      />

      <Paper
        sx={{
          flex: 1,
          p: 3,
          borderRadius: 3,
          overflowY: "auto",
        }}
      >
        <DocEditorSurface
          value={md}
          onChange={setMd}
          mode={mode}
          onToggleMode={() =>
            setMode((m) => (m === "edit" ? "preview" : "edit"))
          }
          isMobile
        />
      </Paper>

      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast({ ...toast, open: false })}
      >
        <Alert severity={toast.severity}>{toast.message}</Alert>
      </Snackbar>
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
      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onPublicPost={() => handleSharePublic()}
        onPrivateLink={(canEdit) =>
          handleGeneratePrivateLink(
            canEdit,
            selectedDocumentId,
            doc?.decryptedContent!,
            relays,
            viewKey,
            editKey,
          )
        }
      />
    </Box>
  );
}
