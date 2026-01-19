import { useEffect, useRef, useState } from "react";
import { Box, Paper, Snackbar, Alert } from "@mui/material";
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
import { getLatestVersion } from "../../utils/helpers";

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
  const history = selectedDocumentId ? documents.get(selectedDocumentId) : null;

  const versions =
    history?.versions.map((v) => ({
      id: v.event.id,
      created_at: v.event.created_at,
    })) ?? [];
  const activeVersion = history ? getLatestVersion(history) : null;

  const [md, setMd] = useState(activeVersion?.decryptedContent || "");
  const [mode, setMode] = useState<"edit" | "preview">(
    isDraft ? "edit" : "preview",
  );
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [historyConfirmOpen, setHistoryConfirmOpen] = useState(false);

  const [toast, setToast] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const [shareOpen, setShareOpen] = useState(false);

  const lastSavedMdRef = useRef<string>("");

  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  const preserveSelection = () => {
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (!el) return;
    selectionRef.current = {
      start: el.selectionStart,
      end: el.selectionEnd,
    };
  };

  const restoreSelection = () => {
    requestAnimationFrame(() => {
      const el = document.activeElement as HTMLTextAreaElement | null;
      if (!el || !selectionRef.current) return;
      el.setSelectionRange(
        selectionRef.current.start,
        selectionRef.current.end,
      );
    });
  };
  useEffect(() => {
    if (!activeVersion) return;
    preserveSelection();
    setMd(activeVersion.decryptedContent ?? "");
    restoreSelection();
    lastSavedMdRef.current = activeVersion.decryptedContent ?? "";
  }, [activeVersion?.event.id]);

  const handleSelectVersion = (eventId: string) => {
    setPendingVersionId(eventId);
    setHistoryConfirmOpen(true);
  };

  const applyHistoricalVersion = () => {
    if (!history || !pendingVersionId) return;

    const version = history.versions.find(
      (v) => v.event.id === pendingVersionId,
    );

    if (!version) return;

    setMd(version.decryptedContent);
    lastSavedMdRef.current = version.decryptedContent;

    setMode("preview");
    setHistoryConfirmOpen(false);
    setPendingVersionId(null);
  };

  /* -----------------------------
     LOW-LEVEL SNAPSHOT (UNCHANGED)
  ------------------------------ */

  const saveSnapshotWithAddress = async (address: string, content: string) => {
    const signer = await signerManager.getSigner();

    if (!signer && !editKey) {
      throw new Error("No signer");
    }
    const dTag = address.split(":")?.[2];
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
    let pubkey: string;
    if (editKey) pubkey = getPublicKey(hexToBytes(editKey));
    else {
      const signer = await signerManager.getSigner();
      pubkey = await signer.getPublicKey();
    }
    const address = `${KIND_FILE}:${pubkey}:${dTag}`;
    setSelectedDocumentId(address);
    await saveSnapshotWithAddress(address, content);
    setSelectedDocumentId(address);
    const naddr = nip19.naddrEncode({
      pubkey: pubkey,
      kind: KIND_FILE,
      identifier: dTag,
    });
    navigate(`/doc/${naddr}`, { replace: true });
    return dTag;
  };

  const saveExistingDocument = async (address: string, content: string) => {
    await saveSnapshotWithAddress(address, content);
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
        versions={versions}
        onSelectVersion={handleSelectVersion}
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
          onChange={(value: string) => {
            preserveSelection();
            setMd(value);
            restoreSelection();
          }}
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
      <ConfirmModal
        open={historyConfirmOpen}
        title="Open Historical Version?"
        description="If you edit this version and save, it will overwrite the current document."
        confirmText="Open Version"
        cancelText="Cancel"
        onConfirm={applyHistoricalVersion}
        onCancel={() => {
          setHistoryConfirmOpen(false);
          setPendingVersionId(null);
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
            activeVersion?.decryptedContent!,
            relays,
            viewKey,
            editKey,
          )
        }
      />
    </Box>
  );
}
