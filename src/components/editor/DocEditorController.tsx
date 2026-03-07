import { useEffect, useRef, useState } from "react";
import {
  Box,
  Paper,
  Snackbar,
  Alert,
  useMediaQuery,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { finalizeEvent, getPublicKey, nip19, type Event } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";

import { useDocumentContext } from "../../contexts/DocumentContext";
import { useSharedPages } from "../../contexts/SharedDocsContext";
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
import { encodeNKeys } from "../../utils/nkeys";

type EditorMode = "edit" | "preview" | "split";

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
  const { addSharedDoc } = useSharedPages();

  const navigate = useNavigate();
  const { relays } = useRelays();

  const isDraft = selectedDocumentId === null;
  const isMobile = useMediaQuery("(max-width:900px)");
  const history = selectedDocumentId ? documents.get(selectedDocumentId) : null;

  const versions =
    history?.versions.map((v) => ({
      id: v.event.id,
      created_at: v.event.created_at,
    })) ?? [];
  const activeVersion = history ? getLatestVersion(history) : null;

  const initialContent = activeVersion?.decryptedContent ?? "";

  const [md, setMd] = useState(initialContent);
  const [mode, setMode] = useState<EditorMode>(isDraft ? "edit" : "preview");
  const [saving, setSaving] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [historyConfirmOpen, setHistoryConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const [shareOpen, setShareOpen] = useState(false);

  const lastSavedMdRef = useRef<string>(initialContent);
  // Always-current markdown — avoids stale closures in effects/save
  const mdRef = useRef<string>(initialContent);
  // Track whether first-mount effect has run (skip re-setting content on init)
  const isFirstMount = useRef(true);

  /* ── TipTap editor instance ────────────────────────────── */
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: "Start writing your page here…",
      }),
      CharacterCount,
    ],
    editorProps: {
      attributes: { class: "tiptap" },
    },
    content: initialContent,
    editable: mode !== "preview",
    onUpdate: ({ editor }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newMd = (editor.storage as any).markdown.getMarkdown() as string;
      mdRef.current = newMd;
      setMd(newMd);
      setWordCount(editor.storage.characterCount.words());
      setCharCount(editor.storage.characterCount.characters());
    },
  });

  /* ── Sync word/char count on editor ready ──────────────── */
  useEffect(() => {
    if (editor) {
      setWordCount(editor.storage.characterCount.words());
      setCharCount(editor.storage.characterCount.characters());
    }
  }, [editor]);

  /* ── Update editor editable state when mode changes ───── */
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(mode !== "preview");
    // When switching back to WYSIWYG, sync with the latest markdown
    // (user may have edited raw markdown in split mode)
    if (mode === "edit") {
      editor.commands.setContent(mdRef.current, { emitUpdate: false });
    }
  }, [mode, editor]);

  /* ── Escape key to exit focus mode ─────────────────────── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) setFocusMode(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode]);

  /* ── Resync when active version changes (relay updates) ── */
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (!activeVersion) return;
    // Never clobber unsaved changes the user is currently editing
    if (mdRef.current !== lastSavedMdRef.current) return;
    const content = activeVersion.decryptedContent ?? "";
    mdRef.current = content;
    setMd(content);
    lastSavedMdRef.current = content;
    if (editor) {
      editor.commands.setContent(content, { emitUpdate: false });
      setWordCount(editor.storage.characterCount.words());
      setCharCount(editor.storage.characterCount.characters());
    }
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

    const content = version.decryptedContent ?? "";
    mdRef.current = content;
    setMd(content);
    lastSavedMdRef.current = content;
    if (editor) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
    setMode("preview");
    setHistoryConfirmOpen(false);
    setPendingVersionId(null);
  };

  /* ── Save helpers ──────────────────────────────────────── */

  const saveSnapshotWithAddress = async (address: string, content: string) => {
    const dTag = address.split(":")?.[2];
    const encryptedContent = await encryptContent(content, viewKey);
    if (!encryptedContent) throw new Error("Encryption failed");

    let signed: Event;

    if (editKey) {
      const editKeyBytes = hexToBytes(editKey);
      const event = {
        kind: KIND_FILE,
        tags: [["d", dTag]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
      };
      signed = finalizeEvent(event, editKeyBytes);
    } else {
      const signer = await signerManager.getSigner();
      if (!signer) throw new Error("No signer available");
      const event = {
        kind: KIND_FILE,
        tags: [["d", dTag]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: await signer.getPublicKey(),
      };
      signed = await signer.signEvent(event);
    }

    addDocument(signed, { viewKey, editKey });
    await publishEvent(signed, relays);
  };

  const saveNewDocument = async (content: string): Promise<string> => {
    const dTag = makeTag(6);
    let pubkey: string;
    if (editKey) pubkey = getPublicKey(hexToBytes(editKey));
    else {
      const signer = await signerManager.getSigner();
      pubkey = await signer.getPublicKey();
    }
    const address = `${KIND_FILE}:${pubkey}:${dTag}`;
    await saveSnapshotWithAddress(address, content);
    setSelectedDocumentId(address);
    const naddr = nip19.naddrEncode({
      pubkey,
      kind: KIND_FILE,
      identifier: dTag,
    });

    let url = `/doc/${naddr}`;
    if (viewKey || editKey) {
      const nkeysStr = encodeNKeys({
        ...(viewKey && { viewKey }),
        ...(editKey && { editKey }),
      });
      url += `#${nkeysStr}`;
    }
    navigate(url, { replace: true });
    return dTag;
  };

  const saveExistingDocument = async (address: string, content: string) => {
    await saveSnapshotWithAddress(address, content);
  };

  const handleSave = async (silent = false) => {
    if (saving) return;

    // In WYSIWYG mode, read from editor (avoids stale React state).
    // In split/preview mode, mdRef is updated by the textarea onChange.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mdToSave =
      mode === "edit" && editor
        ? ((editor.storage as any).markdown.getMarkdown() as string)
        : mdRef.current;

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
  };

  const handleDelete = async (skipPrompt = false) => {
    if (isDraft) return;

    if (skipPrompt) {
      await deleteEvent({
        address: selectedDocumentId!,
        relays,
        reason: "User requested deletion",
      });
      removeDocument(selectedDocumentId!);
      navigate("/");
      return;
    }

    setConfirmOpen(true);
  };

  /* ── Render ────────────────────────────────────────────── */
  const hasUnsavedChanges = md !== lastSavedMdRef.current;

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        gap: 1,
        ...(focusMode && {
          position: "fixed",
          inset: 0,
          zIndex: 1300,
          bgcolor: "background.default",
          p: 3,
        }),
      }}
    >
      <EditorToolbar
        saving={saving}
        mode={mode}
        onSetMode={setMode}
        onSave={() => handleSave(false)}
        handleDelete={handleDelete}
        onShare={() => setShareOpen(true)}
        versions={versions}
        onSelectVersion={handleSelectVersion}
        editor={editor}
        focusMode={focusMode}
        onToggleFocusMode={() => setFocusMode((f) => !f)}
      />

      <Paper
        sx={{
          flex: 1,
          borderRadius: 3,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DocEditorSurface
          value={md}
          editor={editor}
          mode={mode}
          onChange={(value) => {
            // Used by the split-mode markdown textarea
            mdRef.current = value;
            setMd(value);
          }}
          onToggleMode={() => setMode("edit")}
          isMobile={isMobile}
        />
      </Paper>

      {/* ── Status bar ───────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 2,
          px: 1,
          flexShrink: 0,
        }}
      >
        {hasUnsavedChanges && (
          <Typography variant="caption" color="warning.main">
            Unsaved changes
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {wordCount} {wordCount === 1 ? "word" : "words"} ·{" "}
          {charCount.toLocaleString()} chars
        </Typography>
      </Box>

      {/* ── Snackbar ─────────────────────────────────────── */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast({ ...toast, open: false })}
      >
        <Alert severity={toast.severity}>{toast.message}</Alert>
      </Snackbar>

      {/* ── Modals ───────────────────────────────────────── */}
      <ConfirmModal
        open={confirmOpen}
        title="Delete Document?"
        description="This sends a deletion request to your relays. This process is irreversible. Do you wish to proceed?"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={async () => {
          setConfirmOpen(false);
          await deleteEvent({
            address: selectedDocumentId!,
            relays,
            reason: "User requested deletion",
          });
          removeDocument(selectedDocumentId!);
          navigate("/");
        }}
        onCancel={() => setConfirmOpen(false)}
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
        onPrivateLink={async (canEdit) => {
          const result = await handleGeneratePrivateLink(
            canEdit,
            selectedDocumentId,
            md,
            relays,
            viewKey,
            editKey,
          );

          const sharedDocTag = [
            result.address,
            result.viewKey,
            ...(result.editKey ? [result.editKey] : []),
          ];
          await addSharedDoc(sharedDocTag);

          return result.url;
        }}
      />
    </Box>
  );
}
