import { useEffect, useRef, useState } from "react";
import {
  Box,
  Paper,
  Snackbar,
  Alert,
  useMediaQuery,
  Typography,
  Chip,
  InputBase,
  CircularProgress,
  IconButton,
  Tooltip,
} from "@mui/material";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { useDocMetadata } from "../../contexts/DocMetadataContext";
import { useNavigate, useBlocker } from "react-router-dom";
import { finalizeEvent, getPublicKey, getEventHash, nip19, type Event } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { EncryptedFileNode } from "./extensions/EncryptedFileNode";

import { useDocumentContext } from "../../contexts/DocumentContext";
import { useUser } from "../../contexts/UserContext";
import { useSharedPages } from "../../contexts/SharedDocsContext";
import { CommentProvider } from "../../contexts/CommentContext";
import { signerManager } from "../../signer";
import { useRelays } from "../../contexts/RelayContext";
import { publishEvent } from "../../nostr/publish";
import { makeTag } from "../../utils/makeTag";
import {
  storeLocalEvent,
  markBroadcast,
  removeLocalEvent,
  trashLocalEvent,
  setLocalOnlyFlag,
} from "../../lib/localStore";

import { EditorToolbar } from "./EditorToolbar";
import { DocEditorSurface } from "./DocEditorSurface";
import { deleteEvent } from "../../nostr/deleteRequest";
import ConfirmModal from "../common/ConfirmModal";
import ShareModal from "../ShareModal";
import { handleGeneratePrivateLink, handleSharePublic } from "./utils";
import { encryptContent } from "../../utils/encryption";
import { encryptFile } from "../../utils/fileEncryption";
import { uploadToBlossom } from "../../blossom/client";
import { useBlossomServers } from "../../contexts/BlossomContext";
import { KIND_FILE } from "../../nostr/kinds";
import { getLatestVersion } from "../../utils/helpers";
import { encodeNKeys } from "../../utils/nkeys";
import {
  exportAsMarkdown,
  exportAsHtml,
  exportAsPlainText,
  exportAsPdf,
  exportAsDoc,
} from "../../utils/exportDocument";

// Delay after the last edit before auto-save fires (ms)
const AUTO_SAVE_DELAY_MS = 30_000;

type EditorMode = "edit" | "preview" | "split";

function TagRow({ address }: { address: string }) {
  const { docTags, setDocTags } = useDocMetadata();
  const tags = docTags.get(address) ?? [];
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    const tag = input.trim().toLowerCase();
    if (!tag || tags.includes(tag)) { setInput(""); return; }
    setSaving(true);
    try { await setDocTags(address, [...tags, tag]); }
    finally { setSaving(false); setInput(""); }
  };

  const handleRemove = async (tag: string) => {
    setSaving(true);
    try { await setDocTags(address, tags.filter((t) => t !== tag)); }
    finally { setSaving(false); }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0.75,
        px: 1.5,
        py: 0.75,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <LabelOutlinedIcon sx={{ fontSize: 15, opacity: 0.4, flexShrink: 0 }} />
      {tags.map((tag) => (
        <Chip
          key={tag}
          label={tag}
          size="small"
          onDelete={saving ? undefined : () => handleRemove(tag)}
          sx={{ height: 20, fontSize: "0.7rem", "& .MuiChip-label": { px: 1 } }}
        />
      ))}
      <InputBase
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
          if (e.key === "Escape") setInput("");
        }}
        disabled={saving}
        placeholder="add tag…"
        sx={{
          fontSize: "0.72rem",
          color: "text.secondary",
          "& input": { p: 0 },
          "& input::placeholder": { opacity: 0.5 },
          minWidth: 70,
          flex: 1,
        }}
      />
    </Box>
  );
}

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
    localOnlyAddresses,
    markLocalOnly,
  } = useDocumentContext();
  const { addSharedDoc } = useSharedPages();

  const navigate = useNavigate();
  const { relays } = useRelays();

  const isDraft = selectedDocumentId === null;
  const isMobile = useMediaQuery("(max-width:900px)");
  // viewKey present but no editKey = shared read-only link
  const { user } = useUser();
  const history = selectedDocumentId ? documents.get(selectedDocumentId) : null;
  const isOwner = !!user?.pubkey && !!history?.versions[0]?.event.pubkey && user.pubkey === history.versions[0].event.pubkey;
  const isViewOnly = !!viewKey && !editKey && !isOwner;
  const commentsEnabled = !!viewKey && !!selectedDocumentId;

  const versions =
    history?.versions.map((v) => ({
      id: v.event.id,
      created_at: v.event.created_at,
    })) ?? [];
  const activeVersion = history ? getLatestVersion(history) : null;

  const initialContent = activeVersion?.decryptedContent ?? "";

  const [md, setMd] = useState(initialContent);
  const [mode, setMode] = useState<EditorMode>(
    isViewOnly || !isDraft ? "preview" : "edit",
  );
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    activeVersion ? new Date(activeVersion.event.created_at * 1000) : null,
  );
  // Whether the last save was an auto-save (vs a manual save)
  const [wasAutoSaved, setWasAutoSaved] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Address captured at delete-click time so the modal always deletes the right doc,
  // even if selectedDocumentId in context changes before the user confirms.
  const pendingDeleteAddressRef = useRef<string | null>(null);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [historyConfirmOpen, setHistoryConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const [shareOpen, setShareOpen] = useState(false);
  // Device-only state: for drafts tracked locally; for saved docs derived from context
  const [draftLocalOnly, setDraftLocalOnly] = useState(false);
  const isLocalOnly = isDraft
    ? draftLocalOnly
    : (selectedDocumentId ? localOnlyAddresses.has(selectedDocumentId) : false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [localOnlyConfirmOpen, setLocalOnlyConfirmOpen] = useState(false);
  // Capture isLocalOnly at delete-click time so the modal always uses the right value
  const pendingDeleteLocalOnlyRef = useRef<boolean>(false);
  const [showComments, setShowComments] = useState(false);

  const { servers: blossomServers } = useBlossomServers();

  // Each in-flight upload gets a unique entry so multiple concurrent uploads
  // are all visible and the button stays disabled until all finish.
  const [uploadQueue, setUploadQueue] = useState<{ id: string; filename: string }[]>([]);
  const uploading = uploadQueue.length > 0;

  const lastSavedMdRef = useRef<string>(initialContent);
  // Always-current markdown — avoids stale closures in effects/save
  const mdRef = useRef<string>(initialContent);
  // Always-current mode — used in onUpdate to guard against split-mode clobber
  const modeRef = useRef<EditorMode>(mode);
  // Track whether first-mount effect has run (skip re-setting content on init)
  const isFirstMount = useRef(true);
  // Always-current flags read by the auto-save timer at fire time
  const isDraftRef = useRef(isDraft);
  const isViewOnlyRef = useRef(isViewOnly);

  // Keep all synchronous refs current on every render
  modeRef.current = mode;
  isDraftRef.current = isDraft;
  isViewOnlyRef.current = isViewOnly;

  // Always-current upload function — avoids stale closures in editorProps handlers
  const uploadFileRef = useRef<(file: File) => Promise<void>>(async () => {});

  /* ── TipTap editor instance ────────────────────────────── */
  const editor = useEditor({
    extensions: [
      StarterKit,
      // html: true so <encrypted-file> tags round-trip through markdown storage
      Markdown.configure({ html: true, tightLists: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: "Start writing your page here…",
      }),
      CharacterCount,
      EncryptedFileNode,
    ],
    editorProps: {
      attributes: { class: "tiptap" },
      handlePaste(_view, event) {
        if (isViewOnlyRef.current) return false;
        const files = event.clipboardData?.files;
        if (!files?.length) return false;
        Array.from(files).forEach((f) => uploadFileRef.current(f));
        return true;
      },
      handleDrop(_view, event, _slice, moved) {
        if (moved || isViewOnlyRef.current) return false;
        const files = (event as DragEvent).dataTransfer?.files;
        if (!files?.length) return false;
        Array.from(files).forEach((f) => uploadFileRef.current(f));
        return true;
      },
    },
    content: initialContent,
    editable: mode !== "preview",
    onUpdate: ({ editor }) => {
      // Only trust TipTap as the source of truth in WYSIWYG mode. Spurious
      // onUpdate calls fire during mode transitions (EditorContent remount,
      // setEditable dispatch) and would clobber textarea content with TipTap's
      // stale internal document.
      if (modeRef.current !== "edit") return;
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
    // Switching back to WYSIWYG: sync TipTap with whatever was typed in the
    // split textarea. Pass `false` (not a truthy object) so onUpdate doesn't
    // fire and clobber mdRef with a re-serialized version.
    if (mode === "edit") {
      editor.commands.setContent(mdRef.current, { emitUpdate: false });
      setWordCount(editor.storage.characterCount.words());
      setCharCount(editor.storage.characterCount.characters());
    }
  }, [mode, editor]);

  /* ── Keyboard shortcuts ─────────────────────────────────── */
  // Use a ref so the keydown listener always calls the latest handleSave
  // without needing to re-register on every render.
  const handleSaveRef = useRef<(silent?: boolean) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) setFocusMode(false);
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

  /* ── Warn on browser close / refresh ───────────────────── */
  const hasUnsavedChanges = md !== lastSavedMdRef.current;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  /* ── Block in-app navigation when there are unsaved changes  */
  // useBlocker intercepts React Router navigations (sidebar clicks, back
  // button, navigate() calls) before they happen. When blocked we show a
  // confirmation modal; the user can then call blocker.proceed() to allow
  // the navigation or blocker.reset() to stay on the page.
  const blocker = useBlocker(hasUnsavedChanges);

  /* ── Auto-save: debounced 30s after last content change ── */
  // Only fires for existing (non-draft) documents that the user can edit.
  // The timer is reset on every md change, so it only fires 30s after the
  // *last* keystroke. All conditions are re-checked at fire time via refs
  // to avoid stale closure issues.
  useEffect(() => {
    // Don't even set the timer if there's nothing to save
    if (md === lastSavedMdRef.current) return;

    const timer = setTimeout(() => {
      if (isDraftRef.current) return;      // never auto-create new documents
      if (isViewOnlyRef.current) return;   // never save read-only views
      if (!mdRef.current.trim()) return;   // don't save blank content
      handleSaveRef.current(true);         // silent = true (no toast)
    }, AUTO_SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [md]);

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
      const { from, to } = editor.state.selection;
      editor.commands.setContent(content, { emitUpdate: false });
      // Restore cursor, clamped to new doc length in case content shrank
      const docSize = editor.state.doc.content.size;
      editor.commands.setTextSelection({
        from: Math.min(from, docSize),
        to: Math.min(to, docSize),
      });
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

  /* ── File upload ───────────────────────────────────────── */

  const handleFileUpload = async (file: File) => {
    if (!editor) return;

    if (blossomServers.length === 0) {
      setToast({ open: true, message: "No blossom servers configured", severity: "error" });
      return;
    }

    const uploadId = Math.random().toString(36).slice(2);
    setUploadQueue((q) => [...q, { id: uploadId, filename: file.name }]);

    try {
      const { encryptedData, decryptionKey, decryptionNonce, x } =
        await encryptFile(file);
      const url = await uploadToBlossom(blossomServers, encryptedData, x);

      // Move cursor to end of current selection first — prevents replacing a
      // selected file node when the user uploads another while one is selected.
      const insertPos = editor.state.selection.to;
      editor.chain()
        .setTextSelection(insertPos)
        .insertContent({
          type: "encryptedFile",
          attrs: {
            src: url,
            decryptionKey,
            decryptionNonce,
            mimeType: file.type || "application/octet-stream",
            filename: file.name,
            x,
          },
        })
        .run();
    } catch (err) {
      console.error("File upload failed:", err);
      setToast({
        open: true,
        message: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
      });
    } finally {
      setUploadQueue((q) => q.filter((item) => item.id !== uploadId));
    }
  };

  // Keep ref current so paste/drop handlers always call the latest version
  uploadFileRef.current = handleFileUpload;

  /* ── Save helpers ──────────────────────────────────────── */

  const saveSnapshotWithAddress = async (
    address: string,
    content: string,
    localOnly = false,
  ) => {
    const dTag = address.split(":")?.[2];
    const encryptedContent = await encryptContent(content, viewKey);
    if (!encryptedContent) throw new Error("Encryption failed");

    let stored: Event;

    if (localOnly) {
      // Device-only: encrypt and compute a valid event id but leave sig empty.
      // An empty signature is rejected by every relay, providing a hard
      // structural guarantee that this event can never be accidentally published.
      const signer = await signerManager.getSigner();
      if (!signer) throw new Error("No signer available");
      const pubkey = editKey
        ? getPublicKey(hexToBytes(editKey))
        : await signer.getPublicKey();
      const template = {
        kind: KIND_FILE,
        tags: [["d", dTag]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
        pubkey,
      };
      stored = { ...template, id: getEventHash(template), sig: "" };
    } else if (editKey) {
      stored = finalizeEvent(
        {
          kind: KIND_FILE,
          tags: [["d", dTag]],
          content: encryptedContent,
          created_at: Math.floor(Date.now() / 1000),
        },
        hexToBytes(editKey),
      );
    } else {
      const signer = await signerManager.getSigner();
      if (!signer) throw new Error("No signer available");
      stored = await signer.signEvent({
        kind: KIND_FILE,
        tags: [["d", dTag]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
      });
    }

    // 1. Update React state (in-memory, for immediate UI)
    addDocument(stored, { viewKey, editKey });

    // 2. Persist locally — source of truth when offline (or device-only).
    await storeLocalEvent({
      address,
      event: stored,
      viewKey: viewKey ?? undefined,
      editKey: editKey ?? undefined,
      pendingBroadcast: !localOnly,
      savedAt: Date.now(),
      localOnly: localOnly || undefined,
    });

    // 3. Broadcast to relays — skipped entirely for device-only documents.
    if (!localOnly) {
      try {
        await publishEvent(stored, relays);
        await markBroadcast(address);
      } catch (err) {
        console.warn("Relay broadcast failed (saved locally):", err);
      }
    }
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
    await saveSnapshotWithAddress(address, content, draftLocalOnly);
    if (draftLocalOnly) markLocalOnly(address, true);
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
    await saveSnapshotWithAddress(address, content, isLocalOnly);
  };

  const handleToggleLocalOnly = async () => {
    if (isDraft) {
      if (!draftLocalOnly) {
        // Turning on — show warning first
        setLocalOnlyConfirmOpen(true);
      } else {
        setDraftLocalOnly(false);
      }
      return;
    }

    if (isLocalOnly) {
      // Turning off — requires confirmation since it will publish to relays
      setSyncConfirmOpen(true);
    } else {
      // Turning on — show warning first
      setLocalOnlyConfirmOpen(true);
    }
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
    const prevSavedMd = lastSavedMdRef.current;
    lastSavedMdRef.current = mdToSave; // update before navigate() fires in saveNewDocument
    try {
      if (isDraft) {
        await saveNewDocument(mdToSave);
      } else {
        await saveExistingDocument(selectedDocumentId!, mdToSave);
      }
      setLastSavedAt(new Date());
      setWasAutoSaved(silent);
      if (!silent) {
        setToast({ open: true, message: "Saved", severity: "success" });
      }
    } catch (err) {
      lastSavedMdRef.current = prevSavedMd; // restore so unsaved indicator reappears
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

  // Keep the ref pointing at the latest handleSave so the keydown listener
  // and auto-save timer always call the current version without going stale.
  handleSaveRef.current = handleSave;

  const handleDelete = async (skipPrompt = false) => {
    if (isDraft) return;

    const address = selectedDocumentId!;

    if (skipPrompt) {
      await deleteEvent({
        address,
        relays,
        reason: "User requested deletion",
        eventIds: history?.versions.map((v) => v.event.id) ?? [],
      });
      removeDocument(address);
      removeLocalEvent(address).catch(() => {});
      navigate("/");
      return;
    }

    // Capture address and localOnly flag before the modal opens so the confirm
    // handler always acts on the document the user intended to delete.
    pendingDeleteAddressRef.current = address;
    pendingDeleteLocalOnlyRef.current = isLocalOnly;
    setConfirmOpen(true);
  };

  /* ── Export helpers ──────────────────────────────────────── */

  const getDocTitle = () => {
    const firstLine = mdRef.current.split("\n").find((l) => l.trim());
    return firstLine
      ? firstLine.replace(/^#+\s*/, "").trim().slice(0, 60) || "Untitled"
      : "Untitled";
  };

  const handleExportMarkdown = () => {
    exportAsMarkdown(mdRef.current);
  };

  const handleExportHtml = () => {
    if (!editor) return;
    const html = editor.getHTML();
    exportAsHtml(html, getDocTitle());
  };

  const handleExportPlainText = () => {
    exportAsPlainText(mdRef.current);
  };

  const handleExportPdf = () => {
    if (!editor) return;
    exportAsPdf(editor.getHTML(), getDocTitle());
  };

  const handleExportDoc = () => {
    if (!editor) return;
    exportAsDoc(editor.getHTML(), getDocTitle());
  };

  /* ── Render ────────────────────────────────────────────── */

  const editorJsx = (
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
      {!isViewOnly && (
        <EditorToolbar
          saving={saving}
          mode={mode}
          onSetMode={(newMode) => {
            // Pre-sync TipTap before the re-render so that if onUpdate fires
            // during EditorContent remount it fires with the correct content.
            if (newMode === "edit" && editor) {
              editor.commands.setContent(mdRef.current, { emitUpdate: false });
            }
            setMode(newMode);
          }}
          onSave={() => handleSave(false)}
          handleDelete={handleDelete}
          onShare={() => setShareOpen(true)}
          versions={versions}
          onSelectVersion={handleSelectVersion}
          editor={editor}
          focusMode={focusMode}
          onToggleFocusMode={() => setFocusMode((f) => !f)}
          isViewOnly={isViewOnly}
          onAttachFile={(files) => Array.from(files).forEach(handleFileUpload)}
          uploading={uploading}
          isLocalOnly={isLocalOnly}
          onToggleLocalOnly={handleToggleLocalOnly}
          showLocalOnlyToggle={!viewKey && !editKey}
          onExportMarkdown={handleExportMarkdown}
          onExportHtml={handleExportHtml}
          onExportPlainText={handleExportPlainText}
          onExportPdf={handleExportPdf}
          onExportDoc={handleExportDoc}
          showComments={commentsEnabled ? showComments : undefined}
          onToggleComments={commentsEnabled ? () => setShowComments((s) => !s) : undefined}
        />
      )}
      {isViewOnly && commentsEnabled && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", p: 1 }}>
          <Tooltip title={showComments ? "Hide comments" : "Show comments"}>
            <IconButton
              size="small"
              onClick={() => setShowComments((s) => !s)}
              color={showComments ? "secondary" : "default"}
            >
              <ChatBubbleOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Paper
        sx={{
          flex: 1,
          borderRadius: 3,
          overflow: "hidden",
          bgcolor: "background.paper",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {!isViewOnly && selectedDocumentId && (
          <TagRow address={selectedDocumentId} />
        )}
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
          canEdit={!isViewOnly}
          commentsEnabled={commentsEnabled}
          showComments={commentsEnabled && showComments}
          onCloseComments={() => setShowComments(false)}
          docEventId={activeVersion?.event.id ?? ""}
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
        {!isDraft && !isOwner && !!user && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              mr: "auto",
              color: "info.main",
            }}
          >
            {editKey ? (
              <EditOutlinedIcon sx={{ fontSize: 12 }} />
            ) : (
              <VisibilityOutlinedIcon sx={{ fontSize: 12 }} />
            )}
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Shared page · {editKey ? "edit access" : "view only"}
            </Typography>
          </Box>
        )}
        {(isDraft || isOwner) && isLocalOnly && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              mr: "auto",
              color: "text.secondary",
            }}
          >
            <SmartphoneIcon sx={{ fontSize: 12 }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Device only
            </Typography>
          </Box>
        )}
        {hasUnsavedChanges ? (
          <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
            ● Unsaved changes
          </Typography>
        ) : lastSavedAt ? (
          <Typography variant="caption" color="text.secondary">
            {wasAutoSaved ? "Auto-saved" : "Saved"}{" "}
            {lastSavedAt.toLocaleTimeString()}
          </Typography>
        ) : null}
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
        description={
          pendingDeleteLocalOnlyRef.current
            ? "This note is only on this device and cannot be recovered once deleted. Do you wish to proceed?"
            : "This sends a deletion request to your relays. This process is irreversible. Do you wish to proceed?"
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={async () => {
          const address = pendingDeleteAddressRef.current ?? selectedDocumentId!;
          const wasLocalOnly = pendingDeleteLocalOnlyRef.current;
          pendingDeleteAddressRef.current = null;
          pendingDeleteLocalOnlyRef.current = false;
          setConfirmOpen(false);
          if (!wasLocalOnly) {
            try {
              await deleteEvent({
                address,
                relays,
                reason: "User requested deletion",
                eventIds: documents.get(address)?.versions.map((v) => v.event.id) ?? [],
              });
            } catch (err) {
              console.error("Failed to publish deletion event:", err);
              setToast({ open: true, message: "Failed to delete from relays", severity: "error" });
            }
          }
          removeDocument(address);
          await trashLocalEvent(address).catch(() => {});
          navigate("/");
        }}
        onCancel={() => {
          pendingDeleteAddressRef.current = null;
          pendingDeleteLocalOnlyRef.current = false;
          setConfirmOpen(false);
        }}
      />
      <ConfirmModal
        open={syncConfirmOpen}
        title="Sync to relays?"
        description="This note will be published to your relays the next time you save it. This cannot be undone."
        confirmText="Turn off device only"
        cancelText="Keep device only"
        onConfirm={async () => {
          setSyncConfirmOpen(false);
          await setLocalOnlyFlag(selectedDocumentId!, false);
          markLocalOnly(selectedDocumentId!, false);
          setToast({
            open: true,
            message: "Device only off. Save to publish to your relays.",
            severity: "success",
          });
        }}
        onCancel={() => setSyncConfirmOpen(false)}
      />
      <ConfirmModal
        open={localOnlyConfirmOpen}
        title="Save to this device only?"
        description="This page won't sync to your relays or any other device. This will be the only copy — if you lose this device or clear the app, it's gone permanently."
        confirmText="Save device only"
        cancelText="Keep syncing"
        onConfirm={async () => {
          setLocalOnlyConfirmOpen(false);
          if (isDraft) {
            setDraftLocalOnly(true);
          } else {
            await setLocalOnlyFlag(selectedDocumentId!, true);
            markLocalOnly(selectedDocumentId!, true);
          }
          setToast({
            open: true,
            message: "Device only on. This note won't sync to relays or other devices.",
            severity: "success",
          });
        }}
        onCancel={() => setLocalOnlyConfirmOpen(false)}
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
      {/* ── Unsaved navigation warning ────────────────────── */}
      <ConfirmModal
        open={blocker.state === "blocked"}
        title="Leave without saving?"
        description="You have unsaved changes that will be lost if you leave this page."
        confirmText="Leave"
        cancelText="Stay"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
      {/* ── Upload queue ─────────────────────────────────── */}
      {uploadQueue.length > 0 && (
        <Paper
          elevation={4}
          sx={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 1400,
            p: 1.5,
            minWidth: 220,
            maxWidth: 300,
            borderRadius: 2,
            display: "flex",
            flexDirection: "column",
            gap: 0.75,
          }}
        >
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            Uploading {uploadQueue.length} file{uploadQueue.length > 1 ? "s" : ""}…
          </Typography>
          {uploadQueue.map((item) => (
            <Box key={item.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={14} thickness={5} />
              <InsertDriveFileIcon sx={{ fontSize: 14, opacity: 0.5 }} />
              <Typography variant="caption" noWrap sx={{ flex: 1 }}>
                {item.filename}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}

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

  if (commentsEnabled) {
    return (
      <CommentProvider viewKey={viewKey!} docAddress={selectedDocumentId!}>
        {editorJsx}
      </CommentProvider>
    );
  }

  return editorJsx;
}
