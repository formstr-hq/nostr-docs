import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
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
  useTheme,
  alpha,
} from "@mui/material";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CropFreeIcon from "@mui/icons-material/CropFree";
import { useDocMetadata } from "../../contexts/DocMetadataContext";
import { getDocumentTags } from "../AllPagesView";
import { useNavigate, useBlocker, useLocation } from "react-router-dom";
import { isEditModeRouteState } from "../../features/driveImport/editModeRoute";
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash, nip19, type Event } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { useEditor, type Editor } from "@tiptap/react";
import {
  DOMParser as ProseMirrorDOMParser,
  type Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { Markdown } from "tiptap-markdown";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { EncryptedFileNode } from "./extensions/EncryptedFileNode";
import { CommentHighlight } from "./extensions/CommentHighlight";
import { FormNode } from "./extensions/FormNode";
import { SlashCommand } from "./extensions/SlashCommand";
import { Indent } from "./extensions/Indent";
import { TableHandles } from "./extensions/TableHandles";
import {
  GhostTextSuggestion,
  setGhostSuggestion,
  setGhostLoading,
  clearGhostSuggestion,
  ghostSuggestionPluginKey,
} from "./extensions/GhostTextSuggestion";
import type { TextSuggestHook } from "../../hooks/useTextSuggest";
import { ProofreadDiffView } from "../textSuggest/ProofreadDiffView";
import { hasSameProtectedEmbeds } from "../../lib/textSuggest/textDiff";
import { assertProofreadFormattingPreserved } from "../../lib/textSuggest/wllama/markdownPreservation";
import { SlashCommandMenu } from "./SlashCommandMenu";
import type { SlashCommandItem } from "./extensions/SlashCommand";
import type { SlashCommandMenuHandle } from "./SlashCommandMenu";
import CreateFormDialog from "../CreateFormDialog";
import MyFormsPickerDialog from "../MyFormsPickerDialog";
import type { FormsSigner } from "@formstr/sdk";
import { createPortal } from "react-dom";

import { useDocumentContext } from "../../contexts/DocumentContext";
import { useUser } from "../../contexts/UserContext";
import { useSharedPages } from "../../contexts/SharedDocsContext";
import { CommentProvider, useComments } from "../../contexts/CommentContext";
import { signerManager } from "../../signer";
import { useRelays } from "../../contexts/RelayContext";
import { publishEvent } from "../../nostr/publish";
import { makeTag } from "../../utils/makeTag";
import {
  saveLocalDocState,
  markBroadcast,
  removeLocalEvent,
  trashLocalEvent,
  setLocalOnlyFlag,
  clearVisitedFlag,
} from "../../lib/localStore";
import { clearDraft, loadDraft, saveDraft } from "../../lib/draftStore";
import { heuristicTitle } from "../../lib/docSearch";
import { cacheLocalEvents } from "../../dataLayer";

import { EditorToolbar } from "./EditorToolbar";
import { DocEditorSurface } from "./DocEditorSurface";
import { PresenceAvatars } from "./PresenceAvatars";
import { createCollaborationCaretRenderers } from "./extensions/collaborationCaret";
import { useCollabSession } from "../../collab/useCollabSession";
import { useTrustedCollaborators } from "../../collab/useTrustedCollaborators";
import { deleteEvent } from "../../nostr/deleteRequest";
import ConfirmModal from "../common/ConfirmModal";
import ShareModal from "../ShareModal";
import PublishArticleDialog from "../PublishArticleDialog";
import { buildShareUrl, buildSharedDocPath, handleGeneratePrivateLink, handleSharePublic } from "./utils";
import { encryptContent } from "../../utils/encryption";
import { encryptFile } from "../../utils/fileEncryption";
import { uploadToBlossom } from "../../blossom/client";
import { useBlossomServers } from "../../contexts/BlossomContext";
import { KIND_FILE } from "../../nostr/kinds";
import { getLatestVersion } from "../../utils/helpers";
import { enableGroupSharing, updateRosterMembers, upsertMember, removeMember } from "../../nostr/shareV2";
import { fetchRoster, parseRootAddress, collabRoom, type DocMember, type DocMode } from "../../nostr/sharedDoc";
import { fetchProfile } from "../../nostr/fetchProfile";
import { encodeNKeys } from "../../utils/nkeys";
import {
  exportAsMarkdown,
  exportAsHtml,
  exportAsPlainText,
  exportAsPdf,
  exportAsDocx,
} from "../../utils/exportDocument";

// Delay after the last edit before auto-save fires (ms)
const AUTO_SAVE_DELAY_MS = 30_000;
// How long a collab session's last sync-step round-trip is trusted as "still
// connected" for the autosave gate below.
const RESYNC_FRESHNESS_MS = 2 * 60_000;

// Session flag set when the user hits Share on an unsaved draft. Saving the
// draft navigates to the document's own URL, which remounts this controller —
// so the intent to open the Share dialog once that lands has to outlive the
// instance. Session storage carries it across the remount.
const REOPEN_SHARE_KEY = "formstr:reopenShareAfterSave";

/** Wall-clock seconds. Extracted to module scope so the React Compiler does not
 *  treat a raw `Date.now()` inside component-scope helpers as a render-time
 *  impurity. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Next content `created_at`: strictly greater than the document's newest known
 *  version, since relays drop replaceable events that are not strictly newer. */
function nextContentCreatedAt(prevAt: number | undefined): number {
  return Math.max(nowSeconds(), (prevAt ?? 0) + 1);
}

type EditorMode = "edit" | "preview" | "split";

type MarkdownStorage = {
  markdown: {
    getMarkdown(): string;
    parser: { parse(content: string): string };
  };
};

function getEditorMarkdown(editor: Editor): string {
  return (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
}

function parseMarkdownDocument(editor: Editor, markdown: string): ProseMirrorNode {
  const storage = (editor.storage as unknown as MarkdownStorage).markdown;
  const element = document.createElement("div");
  element.innerHTML = storage.parser.parse(markdown);
  return ProseMirrorDOMParser.fromSchema(editor.schema).parse(element);
}

function TagRow({ address }: { address: string }) {
  const { docTags, setDocTags } = useDocMetadata();
  const tags = getDocumentTags(address, docTags);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    const tag = input.trim().toLowerCase().replace(/^#/, "");
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

function CommentHighlightEffect({ editor, mode }: { editor: Editor | null; mode: EditorMode }) {
  const { comments, resolvedIds, applyHighlights } = useComments();

  useEffect(() => {
    if (!editor || mode !== "edit") return;

    const raf = requestAnimationFrame(() => {
      applyHighlights(editor);
    });

    return () => cancelAnimationFrame(raf);
  }, [comments, resolvedIds, editor, mode, applyHighlights]);

  return null;
}

export function DocumentEditorController({
  viewKey,
  editKey,
  textSuggest,
}: {
  viewKey?: string;
  editKey?: string;
  textSuggest: TextSuggestHook;
}) {
  const {
    documents,
    selectedDocumentId,
    setSelectedDocumentId,
    removeDocument,
    addDocument,
    localOnlyAddresses,
    markLocalOnly,
    unmarkVisited,
  } = useDocumentContext();
  const { addSharedDoc, getKeys } = useSharedPages();
  const { setDocSharedAs, docSharedAs, docTags } = useDocMetadata();

  const navigate = useNavigate();
  // Set by flows that create a page for the user to work on straight away (Drive import).
  const startsInEditMode = isEditModeRouteState(useLocation().state);
  const { relays } = useRelays();

  const isDraft = selectedDocumentId === null;
  const isMobile = useMediaQuery("(max-width:900px)");
  const theme = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tbl-menu-bg", theme.palette.background.paper);
    root.style.setProperty("--tbl-menu-text", theme.palette.text.primary);
    root.style.setProperty("--tbl-menu-text-secondary", theme.palette.text.secondary);
    root.style.setProperty("--tbl-menu-border", theme.palette.divider);
    root.style.setProperty("--tbl-menu-hover", theme.palette.action.hover);
    root.style.setProperty("--tbl-menu-danger", theme.palette.error.main);
  }, [theme]);

  // viewKey present but no editKey = shared read-only link
  const { user } = useUser();
  const history = selectedDocumentId ? documents.get(selectedDocumentId) : null;
  const activeVersion = history ? getLatestVersion(history) : null;
  const docOwner = history?.owner ?? history?.versions[0]?.event.pubkey;
  const isOwner = !!user?.pubkey && !!docOwner && user.pubkey === docOwner;
  const sharedAsAddress = selectedDocumentId ? (docSharedAs.get(selectedDocumentId) ?? null) : null;

  // v2 write permission: a non-owner may edit a group document when the doc is
  // in `open` mode or their pubkey is a roster `editor`. Fetched once per doc;
  // legacy docs (editKey / no roster) keep their existing behavior.
  const [groupCanWrite, setGroupCanWrite] = useState(false);
  useEffect(() => {
    setGroupCanWrite(false);
    if (!selectedDocumentId || !viewKey || !user?.pubkey) return;
    if (isOwner || editKey) return;
    const target = parseRootAddress(selectedDocumentId);
    if (!target) return;
    let cancelled = false;
    (async () => {
      const roster = await fetchRoster(target.owner, target.d, viewKey, relays).catch(() => null);
      if (cancelled || !roster) return;
      setGroupCanWrite(
        roster.mode === "open" ||
          roster.members.some((m) => m.pubkey === user.pubkey && m.role === "editor"),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, viewKey, isOwner, editKey, user?.pubkey, relays]);

  const canWrite = isOwner || !!editKey || groupCanWrite;
  // Only shared documents (a viewKey or a legacy backup link) can be view-only;
  // drafts and personal docs must keep their editing UI (the original rule).
  const isViewOnly = (!!viewKey && !canWrite) || !!sharedAsAddress;
  const commentsEnabled = !!viewKey && !!selectedDocumentId;

  // Realtime collaboration (Yjs over Nostr) for writers on a shared document.
  // Starts only once the document's snapshot is loaded, so the Yjs doc can be
  // seeded from it (an empty seed would blank the editor). Solo/draft/view-only
  // docs never touch this and keep the plain markdown path.
  const isCollabDoc =
    canWrite && !!viewKey && !!selectedDocumentId && !isDraft && !!activeVersion;
  const collab = useCollabSession(
    isCollabDoc ? selectedDocumentId : null,
    isCollabDoc ? viewKey : undefined,
    relays,
  );
  const isCollabReady = isCollabDoc && !!collab?.ready;
  const { collaborators, collaboratorsRef } = useTrustedCollaborators(
    collab?.awareness,
    isCollabDoc ? selectedDocumentId : null,
    isCollabDoc ? viewKey : undefined,
    relays,
  );

  const sharedAsUrl = sharedAsAddress ? buildSharedDocPath(sharedAsAddress, getKeys) : null;

  // A view-only visitor to someone else's shared link that isn't yet in their
  // Shared list may bookmark it. Writers are filed automatically on first save
  // (see handleSave), so they never see this.
  const alreadyShared = selectedDocumentId ? getKeys(selectedDocumentId).length > 0 : false;
  const isVisitedPage =
    !!user && !isOwner && !!viewKey && !!selectedDocumentId && !alreadyShared && !canWrite;

  const versions =
    history?.versions.map((v) => ({
      id: v.event.id,
      created_at: v.event.created_at,
    })) ?? [];

  const initialContent = activeVersion?.decryptedContent ?? "";

  // A draft typed before login (or before a reload) is restored from the session
  // draft store. Logging in remounts the account subtree, which would otherwise
  // discard an unsaved draft entirely.
  const restoredDraft = useMemo(
    () => (isDraft ? loadDraft() : null),
    // Re-read only when entering or leaving the draft state.
    [isDraft],
  );
  const draftSeed = restoredDraft?.markdown ?? "";

  const [md, setMd] = useState(draftSeed || initialContent);
  const [mode, setMode] = useState<EditorMode>(
    isViewOnly ? "preview" : isDraft || startsInEditMode ? "edit" : "preview",
  );
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    activeVersion ? new Date(activeVersion.event.created_at * 1000) : null,
  );
  // Whether the last save was an auto-save (vs a manual save)
  const [wasAutoSaved, setWasAutoSaved] = useState(false);
  // Display name of the author of the currently rendered version (who last
  // edited), resolved from their kind-0 profile; "you" when it's the user.
  const [lastEditName, setLastEditName] = useState<string | null>(null);

  useEffect(() => {
    const ev = activeVersion?.event;
    if (!ev) {
      setLastEditName(null);
      return;
    }
    if (user?.pubkey && ev.pubkey === user.pubkey) {
      setLastEditName("you");
      return;
    }
    let cancelled = false;
    setLastEditName(null);
    (async () => {
      const profile = await fetchProfile(ev.pubkey, relays).catch(() => null);
      if (cancelled) return;
      const name =
        profile?.display_name ||
        profile?.name ||
        `${ev.pubkey.slice(0, 8)}…${ev.pubkey.slice(-4)}`;
      setLastEditName(name as string);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeVersion?.event, user?.pubkey, relays]);
  const [focusMode, setFocusMode] = useState(false);
  const [focusAnimation, setFocusAnimation] = useState<"enter" | "exit" | null>(null);
  const [showFocusHint, setShowFocusHint] = useState(false);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggleFocusMode = useCallback(() => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    if (focusHintTimeoutRef.current) clearTimeout(focusHintTimeoutRef.current);

    if (!focusMode) {
      // ENTER FOCUS MODE: slight 100ms deliberate delay & smooth ease-in animation
      setFocusAnimation("enter");
      setShowFocusHint(true);

      focusTimeoutRef.current = setTimeout(() => {
        setFocusMode(true);
      }, 100);

      // Auto-hide floating hint after 2.6s
      focusHintTimeoutRef.current = setTimeout(() => {
        setShowFocusHint(false);
      }, 2600);
    } else {
      // EXIT FOCUS MODE: smooth 240ms exit animation before unmounting fixed overlay
      setFocusAnimation("exit");
      setShowFocusHint(false);

      focusTimeoutRef.current = setTimeout(() => {
        setFocusMode(false);
        setFocusAnimation(null);
      }, 240);
    }
  }, [focusMode]);

  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
      if (focusHintTimeoutRef.current) clearTimeout(focusHintTimeoutRef.current);
    };
  }, []);

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
  const [shareMembers, setShareMembers] = useState<DocMember[]>([]);
  const [shareMode, setShareMode] = useState<DocMode | undefined>(undefined);

  // Load the v2 roster (members + mode) for the share dialog (owner only).
  // Reuses the viewKey the owner already holds; no-ops for legacy/personal docs.
  useEffect(() => {
    if (!shareOpen || !isOwner || !viewKey || !selectedDocumentId) {
      setShareMembers([]);
      setShareMode(undefined);
      return;
    }
    const parsed = selectedDocumentId.split(":");
    if (parsed.length < 3) return;
    const owner = parsed[1];
    const d = parsed.slice(2).join(":");
    let cancelled = false;
    (async () => {
      const roster = await fetchRoster(owner, d, viewKey, relays).catch(() => null);
      if (!cancelled) {
        setShareMembers(roster?.members ?? []);
        setShareMode(roster?.mode);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareOpen, isOwner, viewKey, selectedDocumentId, relays]);

  // Reopen the Share dialog after a draft was saved from the Share button.
  useEffect(() => {
    if (sessionStorage.getItem(REOPEN_SHARE_KEY) === "1") {
      sessionStorage.removeItem(REOPEN_SHARE_KEY);
      setShareOpen(true);
    }
  }, []);

  /** Share button: on a draft, save it first (which navigates and remounts),
   *  then the effect above reopens this dialog on the saved document. */
  const handleShareClick = async () => {
    if (!isDraft) {
      setShareOpen(true);
      return;
    }
    const content = mode === "edit" && editor ? getEditorMarkdown(editor) : mdRef.current;
    if (!content.trim()) {
      setToast({
        open: true,
        message: "Write something before sharing your page.",
        severity: "error",
      });
      return;
    }
    sessionStorage.setItem(REOPEN_SHARE_KEY, "1");
    const ok = await handleSave(false);
    if (!ok) sessionStorage.removeItem(REOPEN_SHARE_KEY);
  };

  const parseShareTarget = () => {
    if (!selectedDocumentId) return null;
    const [kindStr, owner, ...rest] = selectedDocumentId.split(":");
    if (!owner || rest.length === 0) return null;
    return { kind: Number(kindStr), owner, d: rest.join(":") };
  };

  const decodeEditorInput = (input: string): string | null => {
    const value = input.trim();
    if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
    try {
      const decoded = nip19.decode(value);
      return decoded.type === "npub" ? decoded.data : null;
    } catch {
      return null;
    }
  };

  const handleAddEditor = async (input: string) => {
    const target = parseShareTarget();
    if (!target || !viewKey) throw new Error("Share this page first, then add editors.");
    const hex = decodeEditorInput(input);
    if (!hex) throw new Error("Enter a valid npub or 64-character hex pubkey.");
    const next = upsertMember(shareMembers, hex, "editor");
    await updateRosterMembers(target.owner, target.d, viewKey, next, relays, "restricted");
    setShareMembers(next);
    setShareMode("restricted");
    setToast({ open: true, message: "Editor added.", severity: "success" });
  };

  const handleRemoveEditor = async (pubkey: string) => {
    const target = parseShareTarget();
    if (!target || !viewKey) throw new Error("This page isn't shared yet.");
    const next = removeMember(shareMembers, pubkey);
    await updateRosterMembers(target.owner, target.d, viewKey, next, relays);
    setShareMembers(next);
    setToast({ open: true, message: "Editor removed.", severity: "success" });
  };
  const [publishTarget, setPublishTarget] = useState<"longform" | "communityNip" | null>(null);
  const [savingToShared, setSavingToShared] = useState(false);
  // Device-only state: for drafts tracked locally; for saved docs derived from context
  const [draftLocalOnly, setDraftLocalOnly] = useState(
    restoredDraft?.localOnly ?? false,
  );
  const isLocalOnly = isDraft
    ? draftLocalOnly
    : (selectedDocumentId ? localOnlyAddresses.has(selectedDocumentId) : false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [localOnlyConfirmOpen, setLocalOnlyConfirmOpen] = useState(false);
  // Capture isLocalOnly at delete-click time so the modal always uses the right value
  const pendingDeleteLocalOnlyRef = useRef<boolean>(false);
  const [showComments, setShowComments] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [proofreadReview, setProofreadReview] = useState<{
    before: string;
    after: string;
    instruction: string;
    documentId: string | null;
  } | null>(null);

  // Promote a visited page into the user's Shared list. Writes the metadata
  // (once) so it syncs across devices, clears the local visited flag, and drops
  // it from the Visited tab.
  const handleSaveToShared = async () => {
    if (!selectedDocumentId || !viewKey) return;
    setSavingToShared(true);
    try {
      const tag = [selectedDocumentId, viewKey];
      if (editKey) tag.push(editKey);
      await clearVisitedFlag(selectedDocumentId).catch(() => {});
      unmarkVisited(selectedDocumentId);
      await addSharedDoc(tag);
      setToast({ open: true, message: "Saved to your Shared pages.", severity: "success" });
    } catch (err) {
      console.error("Failed to save to Shared:", err);
      setToast({ open: true, message: "Failed to save to Shared. Please try again.", severity: "error" });
    } finally {
      setSavingToShared(false);
    }
  };
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formsPickerOpen, setFormsPickerOpen] = useState(false);

  // Slash command menu state
  const slashMenuRef = useRef<SlashCommandMenuHandle | null>(null);
  const [slashMenuProps, setSlashMenuProps] = useState<{
    items: SlashCommandItem[];
    command: (item: SlashCommandItem) => void;
    rect: DOMRect;
  } | null>(null);

  const { servers: blossomServers } = useBlossomServers();

  // Each in-flight upload gets a unique entry so multiple concurrent uploads
  // are all visible and the button stays disabled until all finish.
  const [uploadQueue, setUploadQueue] = useState<{ id: string; filename: string }[]>([]);
  const uploading = uploadQueue.length > 0;

  const lastSavedMdRef = useRef<string>(activeVersion?.decryptedContent ?? "");
  // Always-current markdown — avoids stale closures in effects/save
  const mdRef = useRef<string>(draftSeed || initialContent);
  // Always-current mode — used in onUpdate to guard against split-mode clobber
  const modeRef = useRef<EditorMode>(mode);
  // Accepting a review from split mode already replaces TipTap with the final
  // candidate. Skip the normal split→edit sync once so Undo stays atomic.
  const skipNextEditModeSyncRef = useRef(false);
  // Track whether first-mount effect has run (skip re-setting content on init)
  const isFirstMount = useRef(true);
  // Always-current flags read by the auto-save timer at fire time
  const isDraftRef = useRef(isDraft);
  const isViewOnlyRef = useRef(isViewOnly);
  const selectedDocIdRef = useRef(selectedDocumentId);
  const isCollabDocRef = useRef(isCollabDoc);
  const collabRef = useRef(collab);

  // Keep all synchronous refs current on every render
  modeRef.current = mode;
  isDraftRef.current = isDraft;
  isViewOnlyRef.current = isViewOnly;
  selectedDocIdRef.current = selectedDocumentId;
  isCollabDocRef.current = isCollabDoc;
  collabRef.current = collab;

  /* ── Persist the in-progress draft ───────────────────────── */
  // A draft has no address until it is saved, so it lives only in component
  // state. Stash it (debounced) so the account-subtree remount on login/logout
  // doesn't discard it. Cleared as soon as the page is saved or emptied.
  useEffect(() => {
    if (!isDraft || !md.trim()) {
      clearDraft();
      return;
    }
    const timer = setTimeout(
      () => saveDraft({ markdown: md, localOnly: draftLocalOnly }),
      300,
    );
    return () => clearTimeout(timer);
  }, [isDraft, md, draftLocalOnly]);

  // Always-current upload function — avoids stale closures in editorProps handlers
  const uploadFileRef = useRef<(file: File) => Promise<void>>(async () => { });

  /* ── Local-AI text suggestions (ghost text) ────────────── */
  // Always-current — read inside the TipTap onUpdate handler below, which is
  // captured once when useEditor first builds the editor instance. Synced
  // via effect (not written during render) so re-renders never observe a
  // half-updated ref.
  const requestSuggestionRef = useRef(textSuggest.requestSuggestion);
  const clearSuggestionRef = useRef(textSuggest.clearSuggestion);
  const notifyCursorPosRef = useRef(textSuggest.notifyCursorPos);
  // Mirrors prefs.enabled for the onUpdate handler (the hook's state value
  // can lag a render behind a just-toggled setting).
  const textSuggestEnabledRef = useRef(false);
  useEffect(() => {
    requestSuggestionRef.current = textSuggest.requestSuggestion;
    clearSuggestionRef.current = textSuggest.clearSuggestion;
    notifyCursorPosRef.current = textSuggest.notifyCursorPos;
    textSuggestEnabledRef.current = textSuggest.prefs?.enabled ?? false;
  }, [
    textSuggest.requestSuggestion,
    textSuggest.clearSuggestion,
    textSuggest.notifyCursorPos,
    textSuggest.prefs,
  ]);

  /* ── TipTap editor instance ────────────────────────────── */
  const editor = useEditor({
    extensions: [
      // Collaboration's plugin construction throws on a null/undefined document,
      // so for solo docs (and collab docs still connecting) it — and
      // CollaborationCaret — must be absent, not configured empty. StarterKit's
      // undo/redo is incompatible with Collaboration, so only the collab path
      // disables it.
      isCollabReady ? StarterKit.configure({ undoRedo: false }) : StarterKit,
      ...(isCollabReady && collab
        ? [
            collab.CollaborationExt.configure({ document: collab.ydoc }),
            collab.CollaborationCaretExt.configure({
              provider: collab.provider,
              user: { sessionPubkey: collab.provider.sessionPubkey },
              ...createCollaborationCaretRenderers(collaboratorsRef),
            }),
          ]
        : []),
      TextStyle,
      FontFamily,
      // html: true so <encrypted-file> tags round-trip through markdown storage
      Markdown.configure({ html: true, tightLists: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: "Start writing your page here…",
      }),
      CharacterCount,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Indent,
      GhostTextSuggestion,
      TableHandles,
      EncryptedFileNode,
      CommentHighlight,
      FormNode,
      SlashCommand.configure({
        suggestion: {
          items: ({ query }) => {
            const all: SlashCommandItem[] = [
              {
                id: "h1",
                label: "Heading 1",
                description: "Large section heading",
                icon: "H₁",
                keywords: ["h1", "heading", "title", "large"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).toggleHeading({ level: 1 }).run(),
              },
              {
                id: "h2",
                label: "Heading 2",
                description: "Medium section heading",
                icon: "H₂",
                keywords: ["h2", "heading", "subtitle", "medium"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).toggleHeading({ level: 2 }).run(),
              },
              {
                id: "h3",
                label: "Heading 3",
                description: "Small section heading",
                icon: "H₃",
                keywords: ["h3", "heading", "subheading", "small"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).toggleHeading({ level: 3 }).run(),
              },
              {
                id: "bullet",
                label: "Bullet list",
                description: "Simple unordered list",
                icon: "•",
                keywords: ["bullet", "list", "unordered", "ul"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).toggleBulletList().run(),
              },
              {
                id: "numbered",
                label: "Numbered list",
                description: "Ordered list with numbers",
                icon: "1.",
                keywords: ["numbered", "ordered", "list", "ol"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).toggleOrderedList().run(),
              },
              {
                id: "quote",
                label: "Quote",
                description: "Capture a quotation",
                icon: "❝",
                keywords: ["quote", "blockquote", "callout"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).toggleBlockquote().run(),
              },
              {
                id: "code",
                label: "Code block",
                description: "Monospace code snippet",
                icon: "</>",
                keywords: ["code", "codeblock", "pre", "snippet", "mono"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).toggleCodeBlock().run(),
              },
              {
                id: "divider",
                label: "Divider",
                description: "Horizontal separator line",
                icon: "—",
                keywords: ["divider", "hr", "separator", "rule"],
                command: ({ editor, range }) =>
                  editor.deleteRange(range).setHorizontalRule().run(),
              },
              {
                id: "table",
                label: "Table",
                description: "Insert a 3×3 table",
                icon: "⊞",
                keywords: ["table", "grid", "rows", "columns", "spreadsheet"],
                command: ({ editor, range }) =>
                  editor
                    .deleteRange(range)
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run(),
              },
              {
                id: "form",
                label: "Form",
                description: "Create and embed a Nostr form",
                icon: "📋",
                keywords: ["form", "survey", "nostr", "embed", "questionnaire", "create"],
                command: ({ editor, range }) => {
                  editor.deleteRange(range).run();
                  setFormDialogOpen(true);
                },
              },
              {
                id: "my-forms",
                label: "My forms",
                description: "Embed one of your existing forms",
                icon: "📂",
                keywords: ["my forms", "existing", "reuse", "embed", "library"],
                command: ({ editor, range }) => {
                  editor.deleteRange(range).run();
                  setFormsPickerOpen(true);
                },
              },
            ];
            if (!query) return all;
            const q = query.toLowerCase();
            return all.filter(
              (item) =>
                item.label.toLowerCase().includes(q) ||
                item.keywords.some((k) => k.includes(q)),
            );
          },
          render: () => {
            let component: SlashCommandMenuHandle | null = null;

            return {
              onStart(props) {
                const rect = props.clientRect?.();
                if (!rect) return;
                setSlashMenuProps({
                  items: props.items as SlashCommandItem[],
                  command: (item) => props.command(item),
                  rect,
                });
              },
              onUpdate(props) {
                const rect = props.clientRect?.();
                if (!rect) return;
                setSlashMenuProps({
                  items: props.items as SlashCommandItem[],
                  command: (item) => props.command(item),
                  rect,
                });
                component = slashMenuRef.current;
              },
              onKeyDown(props) {
                if (props.event.key === "Escape") {
                  setSlashMenuProps(null);
                  return true;
                }
                component = slashMenuRef.current;
                return component?.onKeyDown(props.event) ?? false;
              },
              onExit() {
                setSlashMenuProps(null);
              },
            };
          },
        },
      }),
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
    // Collab docs get their content from the Yjs doc (via Collaboration), not
    // from the markdown snapshot.
    content: isCollabReady ? undefined : draftSeed || initialContent,
    // Editing is never blocked. While a collab session is still connecting the
    // user edits the plain-markdown editor; those keystrokes live in mdRef and
    // are carried into the shared doc by the seed effect when it becomes ready.
    editable: mode !== "preview",
    onUpdate: ({ editor }) => {
      // Only trust TipTap as the source of truth in WYSIWYG mode. Spurious
      // onUpdate calls fire during mode transitions (EditorContent remount,
      // setEditable dispatch) and would clobber textarea content with TipTap's
      // stale internal document. For collab docs the editor's content is the
      // authoritative Yjs state (local AND remote changes), so we must also
      // refresh the markdown snapshot in preview — otherwise a collaborator
      // watching in preview never sees live edits.
      if (modeRef.current !== "edit" && !isCollabDocRef.current) return;
      const newMd = getEditorMarkdown(editor);
      mdRef.current = newMd;
      setMd(newMd);
      if (modeRef.current !== "edit") {
        // Remote-driven change while in preview: the user made no local edit, so
        // don't flag the document as having unsaved changes (or block navigation).
        lastSavedMdRef.current = newMd;
      }
      setWordCount(editor.storage.characterCount.words());
      setCharCount(editor.storage.characterCount.characters());

      // ── Local-AI writing tools trigger ──────────────────────────────
      // Plain-text slices around the cursor (not markdown — re-serializing
      // the whole doc on every keystroke just to get plain text would be
      // wasteful, and the model only needs to read prose, not markdown
      // syntax). Skipped entirely when the user hasn't turned this on.
      if (!textSuggestEnabledRef.current) return;
      const { selection } = editor.state;
      if (!selection.empty) {
        clearSuggestionRef.current();
        return;
      }
      // Cap how much context we ship to the model per request — keeps
      // prompt re-evaluation fast (especially with WebGPU serialization).
      const CONTEXT_CHARS = 800;
      const prefix = editor.state.doc.textBetween(
        Math.max(0, selection.from - CONTEXT_CHARS),
        selection.from,
        "\n",
      );

      requestSuggestionRef.current(prefix, selection.from);
    },
    onSelectionUpdate: ({ editor }) => {
      if (!textSuggestEnabledRef.current) return;
      const { selection } = editor.state;
      if (!selection.empty) {
        clearSuggestionRef.current();
        return;
      }
      // Cursor moved without typing — drop stale pending/shown suggestions.
      notifyCursorPosRef.current(selection.from);
    },
    // Solo docs never change this dep (editor created once). Collab docs
    // recreate the editor exactly once, when the session flips to ready.
  }, [isCollabReady]);

  /* ── Sync word/char count on editor ready ──────────────── */
  useEffect(() => {
    if (editor) {
      setWordCount(editor.storage.characterCount.words());
      setCharCount(editor.storage.characterCount.characters());
    }
  }, [editor]);

  /* ── Seed a fresh Yjs doc from the existing snapshot ───── */
  // A brand-new collab session's Y.Doc starts empty and the Collaboration
  // extension can't know the pre-collab markdown snapshot. Give the initial
  // sync-step round-trip a chance to pull a peer's history first (the
  // isCollabReady grace period); only seed if the doc is still empty. The seed
  // uses mdRef (the live editor markdown) rather than the original snapshot, so
  // anything the user typed while the session was connecting is preserved. Runs
  // at most once per editor instance so it never clobbers collaborators' content.
  const seededCollabDocRef = useRef(false);
  useEffect(() => {
    seededCollabDocRef.current = false;
  }, [editor]);
  useEffect(() => {
    if (!isCollabReady || !editor || seededCollabDocRef.current) return;
    seededCollabDocRef.current = true;
    if (editor.getText().trim()) return;
    const seedSource = mdRef.current.trim() ? mdRef.current : initialContent;
    if (seedSource.trim()) {
      editor.commands.setContent(seedSource);
    }
  }, [isCollabReady, editor, initialContent]);

  const activeTextSuggestion = textSuggest.suggestion;
  const localAIPrefs = textSuggest.prefs;
  const clearTextSuggestion = textSuggest.clearSuggestion;
  const cancelProofread = textSuggest.cancelProofread;

  /* ── Push local-AI suggestions into the ghost-text decoration ──── */
  // The useTextSuggest hook owns *when* to suggest (debounce, model
  // loading, abort-on-keystroke); this effect just reflects its result
  // into the editor view whenever it changes — and only if the caret is
  // still at the position the suggestion was requested for.
  useEffect(() => {
    if (!editor) return;
    if (activeTextSuggestion) {
      const { text, pos } = activeTextSuggestion;
      const { selection } = editor.state;
      if (selection.empty && selection.from === pos) {
        if (activeTextSuggestion.loading) {
          setGhostLoading(editor.view, pos);
        } else {
          setGhostSuggestion(editor.view, text, pos);
        }
      } else {
        // Cursor moved while the model was thinking — ignore.
        clearTextSuggestion();
      }
    } else {
      clearGhostSuggestion(editor.view);
    }
  }, [editor, activeTextSuggestion, clearTextSuggestion]);

  useEffect(() => {
    if (!editor) return;
    if (!localAIPrefs?.enabled) {
      clearGhostSuggestion(editor.view);
      clearTextSuggestion();
    }
  }, [
    editor,
    localAIPrefs?.enabled,
    clearTextSuggestion,
  ]);

  /* ── Accept/dismiss feedback for the ghost-text extension ───────── */
  // Tap/Tab/Escape inside GhostTextSuggestion clear the ProseMirror
  // decoration directly (so the UI reacts instantly without waiting on this
  // hook's state). This effect mirrors that back into useTextSuggest's state
  // so a stale `textSuggest.suggestion` doesn't get re-applied by the effect
  // above on the next render.
  useEffect(() => {
    if (!editor) return;
    const onTransaction = () => {
      const ghost = ghostSuggestionPluginKey.getState(editor.state);
      if (!ghost?.text && activeTextSuggestion) {
        clearTextSuggestion();
      }
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, activeTextSuggestion, clearTextSuggestion]);

  /* ── Lock the editor during preview/review ────────────── */
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(mode !== "preview" && !proofreadReview, false);
  }, [mode, editor, proofreadReview]);

  /* ── Sync split-mode Markdown when returning to edit ──── */
  useEffect(() => {
    if (!editor || mode !== "edit") return;
    if (skipNextEditModeSyncRef.current) {
      skipNextEditModeSyncRef.current = false;
      setWordCount(editor.storage.characterCount.words());
      setCharCount(editor.storage.characterCount.characters());
      return;
    }
    // Switching back to WYSIWYG: sync TipTap with whatever was typed in the
    // split textarea. Pass `false` (not a truthy object) so onUpdate doesn't
    // fire and clobber mdRef with a re-serialized version.
    editor.commands.setContent(mdRef.current, { emitUpdate: false });
    setWordCount(editor.storage.characterCount.words());
    setCharCount(editor.storage.characterCount.characters());
  }, [mode, editor]);

  const handleProofread = async (instruction: string) => {
    const before = mdRef.current;
    if (!before.trim()) throw new Error("Start writing before proofreading.");
    const documentId = selectedDocIdRef.current;
    const result = await textSuggest.requestProofread(before, instruction);

    if (
      mdRef.current !== before ||
      selectedDocIdRef.current !== documentId
    ) {
      throw new Error(
        "The document changed while proofreading. Run the review again on the current text.",
      );
    }

    if (result.text === before) {
      setToast({
        open: true,
        message: "No changes suggested.",
        severity: "success",
      });
      return;
    }

    setProofreadReview({
      before,
      after: result.text,
      instruction,
      documentId,
    });
  };

  const rejectProofread = () => {
    setProofreadReview(null);
    setToast({
      open: true,
      message: "Proofreading changes rejected. Your document was not changed.",
      severity: "success",
    });
  };

  const acceptProofread = (acceptedDocument: string) => {
    if (!editor || !proofreadReview) return;
    if (
      mdRef.current !== proofreadReview.before ||
      selectedDocIdRef.current !== proofreadReview.documentId
    ) {
      setProofreadReview(null);
      setToast({
        open: true,
        message: "The document changed. Run proofreading again before accepting.",
        severity: "error",
      });
      return;
    }

    if (acceptedDocument === proofreadReview.before) {
      setProofreadReview(null);
      setToast({
        open: true,
        message: "No proofreading changes accepted. Your document was not changed.",
        severity: "success",
      });
      return;
    }

    if (!hasSameProtectedEmbeds(proofreadReview.before, acceptedDocument)) {
      setToast({
        open: true,
        message:
          "Those selections would alter a protected file or form embed. Restore the related change or reject all.",
        severity: "error",
      });
      return;
    }

    try {
      assertProofreadFormattingPreserved(
        proofreadReview.before,
        acceptedDocument,
        proofreadReview.instruction,
      );
    } catch (error) {
      setToast({
        open: true,
        message:
          error instanceof Error
            ? error.message
            : "Those selections would change Markdown formatting. Restore the related change or reject all.",
        severity: "error",
      });
      return;
    }

    try {
      const currentEditorMarkdown = getEditorMarkdown(editor);

      // Split-mode edits live in mdRef until TipTap is shown again. Sync that
      // exact reviewed base without adding a separate undo step.
      if (currentEditorMarkdown !== proofreadReview.before) {
        const baseDoc = parseMarkdownDocument(editor, proofreadReview.before);
        editor.view.dispatch(
          editor.state.tr
            .replaceWith(0, editor.state.doc.content.size, baseDoc.content)
            .setMeta("addToHistory", false)
            .setMeta("preventUpdate", true),
        );
      }

      const candidateDoc = parseMarkdownDocument(editor, acceptedDocument);
      if (modeRef.current !== "edit") skipNextEditModeSyncRef.current = true;
      modeRef.current = "edit";
      setMode("edit");
      editor.setEditable(true, false);
      editor.view.dispatch(
        closeHistory(editor.state.tr).replaceWith(
          0,
          editor.state.doc.content.size,
          candidateDoc.content,
        ),
      );
      // Close the accepted rewrite on both sides so the next keystroke is a
      // separate undo event even if it happens immediately.
      editor.view.dispatch(closeHistory(editor.state.tr));
      textSuggest.clearSuggestion();
      setProofreadReview(null);
      setToast({
        open: true,
        message: "Proofreading changes accepted.",
        severity: "success",
      });
    } catch (error) {
      setToast({
        open: true,
        message:
          error instanceof Error
            ? `Could not apply proofreading: ${error.message}`
            : "Could not apply proofreading.",
        severity: "error",
      });
    }
  };

  useEffect(() => {
    cancelProofread();
    setProofreadReview(null);
  }, [selectedDocumentId, cancelProofread]);

  /* ── Plain-text view of the doc for the comment layer ──── */
  // Comments anchor to plain rendered text, but `md` is the markdown source
  // (with `**`/`_`/`[](…)` markers and `\n\n` block breaks). Matching a
  // plain-text quote against markdown wrongly flags comments on bold/italic/
  // link/multi-paragraph text as outdated and hides their highlight. Use the
  // editor's plain text instead. Recomputed whenever `md` changes so it stays
  // current in edit and preview.
  const docPlainText = useMemo(
    () => editor?.getText() ?? "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, md],
  );

  /* ── Keyboard shortcuts ─────────────────────────────────── */
  // Use a ref so the keydown listener always calls the latest handleSave
  // without needing to re-register on every render.
  const handleSaveRef = useRef<(silent?: boolean) => Promise<boolean>>(
    async () => true,
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode && focusAnimation !== "exit") {
        handleToggleFocusMode();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode, focusAnimation, handleToggleFocusMode]);

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
  // Evaluated from refs at navigation time so a handler that just persisted
  // the content can mark it saved and navigate in the same tick (see the
  // view-only share path) — a plain boolean would be stale from the previous
  // render and still block.
  const blocker = useBlocker(() => mdRef.current !== lastSavedMdRef.current);

  /* ── Auto-save: debounced 30s after last content change ── */
  // Only fires for existing (non-draft) documents that the user can edit.
  // The timer is reset on every md change, so it only fires 30s after the
  // *last* keystroke. All conditions are re-checked at fire time via refs
  // to avoid stale closure issues.
  useEffect(() => {
    // Don't even set the timer if there's nothing to save
    if (md === lastSavedMdRef.current) return;

    // Bind this timer to the document that was active when the edit was made.
    // If the active document changes before the timer fires (e.g. the user
    // switched pages or created a new one), we must NOT flush this content into
    // whatever doc is now selected — that would overwrite an unrelated page.
    const armedDocId = selectedDocIdRef.current;

    const timer = setTimeout(() => {
      if (isDraftRef.current) return;      // never auto-create new documents
      if (isViewOnlyRef.current) return;   // never save read-only views
      if (!mdRef.current.trim()) return;   // don't save blank content
      if (selectedDocIdRef.current !== armedDocId) return; // doc switched — abort
      if (isCollabDocRef.current) {
        // A partitioned/stale collab client shouldn't snapshot a regressed view
        // over the others' work: only save when recently sync-stepped (kept fresh
        // by the provider's periodic re-broadcast).
        const provider = collabRef.current?.provider;
        const synced =
          !!provider?.lastSyncRequestAt &&
          Date.now() - provider.lastSyncRequestAt <= RESYNC_FRESHNESS_MS;
        if (!synced) return;
      }
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
    // Collab docs get remote content via live Yjs merge, not via activeVersion
    // changes — running this would clobber live-merged content with a lagging
    // Markdown snapshot.
    if (isCollabDocRef.current) return;
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
    // v2: the content event's `a` tag is the capability-derived room (not the
    // root), so the owner is not named in the public footprint; it still lets a
    // client find all versions (`#a`). Legacy readers ignore the extra tag.
    const aTag = viewKey ? collabRoom(viewKey) : address;
    const eventTags = [["d", dTag], ["a", aTag]];
    // Relays drop replaceable events whose created_at is not strictly newer, and
    // created_at has 1s granularity — so two saves in the same second (or a
    // re-publish right after a save, e.g. sharing) would be silently discarded.
    // Keep the timestamp strictly above this document's newest known version.
    const prevAt = documents.get(address)?.versions.at(-1)?.event.created_at ?? 0;
    const createdAt = nextContentCreatedAt(prevAt);
    // Kind-33457 content is plain Markdown; Yjs is a live-only layer (not stored).
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
        tags: eventTags,
        content: encryptedContent,
        created_at: createdAt,
        pubkey,
      };
      stored = { ...template, id: getEventHash(template), sig: "" };
    } else if (editKey) {
      stored = finalizeEvent(
        {
          kind: KIND_FILE,
          tags: eventTags,
          content: encryptedContent,
          created_at: createdAt,
        },
        hexToBytes(editKey),
      );
    } else {
      const signer = await signerManager.getSigner();
      if (!signer) throw new Error("No signer available");
      stored = await signer.signEvent({
        kind: KIND_FILE,
        tags: eventTags,
        content: encryptedContent,
        created_at: createdAt,
      });
    }

    // 1. Update React state (in-memory, for immediate UI). v2 group versions are
    //    keyed by the root address so every author lands under one document.
    addDocument(
      stored,
      { viewKey, editKey },
      { documentId: address, owner: address.split(":")[1] },
    );

    // 2. Cache the event in the local relay — the single owner of event
    //    payloads. Covers device-only (unsigned) events too, which are never
    //    published but must survive a reload.
    cacheLocalEvents([stored]);

    // 3. Persist only keys/flags in the legacy store. `pendingBroadcast` stays
    //    set until a relay accepts the event (cleared by markBroadcast below).
    await saveLocalDocState({
      address,
      viewKey: viewKey ?? undefined,
      editKey: editKey ?? undefined,
      pendingBroadcast: !localOnly,
      savedAt: Date.now(),
      localOnly: localOnly || undefined,
      lastEventCreatedAt: stored.created_at,
    });

    // 4. Broadcast to relays — skipped entirely for device-only documents.
    if (!localOnly) {
      try {
        await publishEvent(stored, relays);
        await markBroadcast(address);
        markLocalOnly(address, false);
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

  const handleSave = async (silent = false): Promise<boolean> => {
    if (saving) return false;

    // In WYSIWYG mode, read from editor (avoids stale React state).
    // In split/preview mode, mdRef is updated by the textarea onChange.
    const mdToSave =
      mode === "edit" && editor
        ? getEditorMarkdown(editor)
        : mdRef.current;

    if (mdToSave === lastSavedMdRef.current) return true;

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
      // v2: a logged-in writer on someone else's shared document keeps their own
      // fork and should be filed under their Shared list automatically once they
      // save — no manual "Save to Shared" step. Skipped without a signer: a legacy
      // edit-key editor may be anonymous, and addSharedDoc would prompt for login.
      if (!isOwner && !!viewKey && canWrite && selectedDocumentId && user?.pubkey) {
        if (getKeys(selectedDocumentId).length === 0) {
          try {
            await addSharedDoc([selectedDocumentId, viewKey]);
            unmarkVisited(selectedDocumentId);
          } catch (err) {
            console.warn("Failed to auto-add shared doc:", err);
          }
        }
      }
      return true;
    } catch (err) {
      lastSavedMdRef.current = prevSavedMd; // restore so unsaved indicator reappears
      console.error("Save failed:", err);
      setToast({
        open: true,
        message: "Failed to save!",
        severity: "error",
      });
      return false;
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
      removeLocalEvent(address).catch(() => { });
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

  const getDocTitle = () => heuristicTitle(mdRef.current, 60) || "Untitled";

  const handleExportMarkdown = () => {
    exportAsMarkdown(mdRef.current);
  };

  const handleExportHtml = () => {
    if (!editor) return;
    const html = editor.getHTML();
    void exportAsHtml(html, getDocTitle());
  };

  const handleExportPlainText = () => {
    exportAsPlainText(mdRef.current);
  };

  const handleExportPdf = () => {
    if (!editor) return;
    void exportAsPdf(editor.getHTML(), getDocTitle());
  };

  const handleExportDoc = () => {
    if (!editor) return;
    void exportAsDocx(editor.getHTML(), getDocTitle());
  };

  const handleFormCreated = (naddr: string, nkeys?: string) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: "nostrForm", attrs: { naddr, nkeys: nkeys ?? null } })
      .run();
  };

  /* Build a FormsSigner adapter from the app's signerManager */
  const formsSigner: FormsSigner | null = user
    ? {
      getPublicKey: () => signerManager.getSigner().then((s) => s.getPublicKey()),
      signEvent: (ev) => signerManager.getSigner().then((s) => s.signEvent(ev)),
      nip44Encrypt: (pub, pt) =>
        signerManager.getSigner().then((s) => {
          if (!s.nip44Encrypt) throw new Error("Signer does not support NIP-44");
          return s.nip44Encrypt(pub, pt);
        }),
      nip44Decrypt: (pub, ct) =>
        signerManager.getSigner().then((s) => {
          if (!s.nip44Decrypt) throw new Error("Signer does not support NIP-44");
          return s.nip44Decrypt(pub, ct);
        }),
    }
    : null;

  /* Build existing share links to pass to ShareModal */
  const viewKeys = selectedDocumentId ? getKeys(selectedDocumentId) : [];
  const existingViewLink = viewKeys[0] ? buildShareUrl(selectedDocumentId!, viewKeys[0]) : "";

  const editKeys = sharedAsAddress ? getKeys(sharedAsAddress) : [];
  const existingEditLink = editKeys[0] && editKeys[1] ? buildShareUrl(sharedAsAddress!, editKeys[0], editKeys[1]) : "";

  /* ── Render ────────────────────────────────────────────── */

  const editorJsx = (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "background.default",
        ...(focusMode && {
          position: "fixed",
          inset: 0,
          zIndex: 1300,
          bgcolor: "background.default",
          animation:
            focusAnimation === "exit"
              ? "focusExit 0.24s cubic-bezier(0.4, 0, 0.2, 1) forwards"
              : "focusEnter 0.36s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }),
      }}
    >
      {showFocusHint && focusMode && (
        <Box
          sx={{
            position: "fixed",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1400,
            pointerEvents: "none",
            animation: "focusHintFade 2.4s ease forwards",
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 0.75,
            borderRadius: 10,
            bgcolor: (t) => alpha(t.palette.background.paper, 0.94),
            backdropFilter: "blur(12px)",
            border: "1px solid",
            borderColor: "divider",
            boxShadow: (t) =>
              t.palette.mode === "dark"
                ? "0 8px 32px rgba(0, 0, 0, 0.45)"
                : "0 8px 24px rgba(0, 0, 0, 0.12)",
          }}
        >
          <CropFreeIcon sx={{ fontSize: 16, color: "secondary.main" }} />
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, fontSize: "0.78rem", color: "text.primary" }}
          >
            Focus mode · Press Esc to exit
          </Typography>
        </Box>
      )}
      {sharedAsUrl && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 0.75,
            bgcolor: (t) => t.palette.mode === "dark"
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.04)",
            borderBottom: "1px solid",
            borderColor: "divider",
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            This is a backup — the live shared copy is the editable version.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={() => navigate(sharedAsUrl)}
            sx={{ ml: 2, whiteSpace: "nowrap", fontSize: "0.72rem" }}
          >
            Go to live version
          </Button>
        </Box>
      )}

      {isVisitedPage && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 0.75,
            bgcolor: (t) => t.palette.mode === "dark"
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.04)",
            borderBottom: "1px solid",
            borderColor: "divider",
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            You're viewing a shared page. Save it to keep it in your Shared list across devices.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            disabled={savingToShared}
            onClick={handleSaveToShared}
            sx={{ ml: 2, whiteSpace: "nowrap", fontSize: "0.72rem" }}
          >
            {savingToShared ? "Saving…" : "Save to Shared"}
          </Button>
        </Box>
      )}

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          borderRadius: 0,
          overflow: "hidden",
          bgcolor: "background.default",
          display: "flex",
          flexDirection: "column",
          border: "none",
          backgroundImage: "none",
        }}
      >
        {!isViewOnly && !proofreadReview && (
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
            onShare={handleShareClick}
            versions={versions}
            onSelectVersion={handleSelectVersion}
            editor={editor}
            focusMode={focusMode}
            onToggleFocusMode={handleToggleFocusMode}
            isViewOnly={isViewOnly}
            relayEvent={isLocalOnly ? null : (history?.versions.at(-1)?.event ?? null)}
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
            documentAddress={selectedDocumentId ?? undefined}
            heuristicTitle={getDocTitle()}
            hasEditKey={!!editKey}
            textSuggestState={textSuggest.state}
            textSuggestEnabled={textSuggest.prefs?.enabled ?? false}
            onToggleTextSuggest={(next) => {
              if (!textSuggest.prefs) return;
              void textSuggest.updatePrefs({ ...textSuggest.prefs, enabled: next });
            }}
            onTextSuggestSettingsSaved={() => void textSuggest.reload()}
            proofreadDocumentLength={md.length}
            proofreadStatus={textSuggest.proofreadStatus}
            onProofread={handleProofread}
            onCancelProofread={cancelProofread}
          />
        )}
        {isViewOnly && commentsEnabled && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
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

        {!isViewOnly && selectedDocumentId && (
          <TagRow address={selectedDocumentId} />
        )}
        {proofreadReview ? (
          <ProofreadDiffView
            before={proofreadReview.before}
            after={proofreadReview.after}
            instruction={proofreadReview.instruction}
            onAccept={acceptProofread}
            onReject={rejectProofread}
          />
        ) : (
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
            onCommentClick={(id) => { setActiveCommentId(id); setShowComments(true); }}
            activeCommentId={activeCommentId}
          />
        )}
      </Paper>

      {/* ── Status bar ───────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 2,
          px: 2,
          py: 0.5,
          flexShrink: 0,
          bgcolor: "background.default",
          borderTop: "1px solid",
          borderColor: "divider",
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
            {canWrite ? (
              <EditOutlinedIcon sx={{ fontSize: 12 }} />
            ) : (
              <VisibilityOutlinedIcon sx={{ fontSize: 12 }} />
            )}
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Shared page · {canWrite ? "edit access" : "view only"}
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
        {isCollabDoc && (collaborators.size > 0 || !isCollabReady) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {!isCollabReady && (
              <Typography variant="caption" color="text.secondary">
                Connecting…
              </Typography>
            )}
            <PresenceAvatars collaborators={collaborators} />
          </Box>
        )}
        {activeVersion && (
          <Typography variant="caption" color="text.secondary">
            Last edit{lastEditName ? ` by ${lastEditName}` : ""} ·{" "}
            {new Date(activeVersion.event.created_at * 1000).toLocaleString()}
          </Typography>
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
          await trashLocalEvent(address).catch(() => { });
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

      {/* ── Slash command menu portal ─────────────────────── */}
      {slashMenuProps &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: slashMenuProps.rect.bottom + 4,
              left: slashMenuProps.rect.left,
              zIndex: 9999,
            }}
          >
            <SlashCommandMenu
              ref={(handle) => {
                slashMenuRef.current = handle;
              }}
              items={slashMenuProps.items}
              command={(item) => {
                slashMenuProps.command(item);
                setSlashMenuProps(null);
              }}
            />
          </div>,
          document.body,
        )}

      {/* ── Create form dialog ────────────────────────────── */}
      <CreateFormDialog
        open={formDialogOpen}
        onClose={() => setFormDialogOpen(false)}
        onCreated={handleFormCreated}
        signer={formsSigner}
      />

      {/* ── My forms picker ───────────────────────────────── */}
      <MyFormsPickerDialog
        open={formsPickerOpen}
        onClose={() => setFormsPickerOpen(false)}
        onPick={handleFormCreated}
      />

      <PublishArticleDialog
        open={publishTarget !== null}
        target={publishTarget ?? "longform"}
        onClose={() => setPublishTarget(null)}
        markdown={md}
        initialTitle={getDocTitle()}
        initialTags={selectedDocumentId ? (docTags.get(selectedDocumentId) ?? []) : []}
      />

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        docTitle={getDocTitle()}
        onPublicPost={() => handleSharePublic()}
        onPublish={(target) => {
          setShareOpen(false);
          setPublishTarget(target);
        }}
        existingViewLink={existingViewLink}
        existingEditLink={existingEditLink}
        members={shareMembers}
        onAddEditor={isOwner && viewKey ? handleAddEditor : undefined}
        onRemoveEditor={isOwner && viewKey ? handleRemoveEditor : undefined}
        v2={isOwner}
        mode={shareMode}
        onPrivateLink={async (canEdit, rotate, open) => {
          // Edit-access re-share: reuse the existing keys and skip publishing.
          // Republishing would push our stale local copy over any edits the
          // collaborator has made through the live shared link.
          if (canEdit && selectedDocumentId && sharedAsAddress) {
            const existing = getKeys(sharedAsAddress);
            if (existing[0] && existing[1]) {
              return buildShareUrl(sharedAsAddress, existing[0], existing[1]);
            }
          }

          if (!canEdit && selectedDocumentId && !rotate) {
            const existing = getKeys(selectedDocumentId);
            if (existing[0]) {
              return buildShareUrl(selectedDocumentId, existing[0]);
            }
          }

          // v2 group share (owner): keep the owner's own address, re-publish the
          // content under the document viewKey and a roster. No editKey and no
          // separate backup copy; only people added as editors can write.
          if (canEdit && isOwner && selectedDocumentId && user?.pubkey) {
            const target = parseShareTarget();
            if (target) {
              const vk = viewKey ?? bytesToHex(generateSecretKey());
              const mode: DocMode = open ? "open" : "restricted";
              // Make sure the viewKey-encrypted re-publish strictly supersedes the
              // owner's last version (relays drop equal-or-older replaceables).
              const lastAt = history?.versions.at(-1)?.event.created_at ?? 0;
              const createdAt = nextContentCreatedAt(lastAt);
              const sharedEvent = await enableGroupSharing(
                target.owner,
                target.d,
                vk,
                md,
                relays,
                open ? [] : shareMembers,
                mode,
                createdAt,
              );
              // Register the viewKey+version locally right away so this session's
              // live/hydration paths decrypt the owner's own viewKey-encrypted
              // events instead of attempting a self-decrypt.
              await addDocument(
                sharedEvent,
                { viewKey: vk },
                { documentId: selectedDocumentId, owner: target.owner },
              );
              setShareMode(mode);
              // Adopt the viewKey so this session keeps encrypting with it.
              // Mark the snapshot saved so the unsaved-changes blocker doesn't
              // intercept the navigation.
              lastSavedMdRef.current = md;
              setLastSavedAt(new Date());
              const naddr = nip19.naddrEncode({
                kind: KIND_FILE,
                pubkey: target.owner,
                identifier: target.d,
              });
              navigate(`/doc/${naddr}#${encodeNKeys({ viewKey: vk })}`, {
                replace: true,
              });
              return buildShareUrl(selectedDocumentId, vk);
            }
          }

          const result = await handleGeneratePrivateLink(
            canEdit,
            selectedDocumentId,
            md,
            relays,
            // Rotating a view link must mint a fresh viewKey — reusing the one
            // this session already adopted would leave every link handed out
            // earlier still working.
            !canEdit && rotate ? undefined : viewKey,
            editKey,
            blossomServers,
            history?.versions.at(-1)?.event.created_at ?? 0,
          );

          const sharedDocTag = [
            result.address,
            result.viewKey,
            ...(result.editKey ? [result.editKey] : []),
          ];
          await addSharedDoc(sharedDocTag);

          // Mark the original doc as a backup pointing to the shared copy.
          // Only makes sense when the logged-in owner is sharing their own doc.
          if (result.editKey && selectedDocumentId && isOwner) {
            await setDocSharedAs(selectedDocumentId, result.address);
          }

          // View-only share keeps the same doc address but re-encrypts the doc
          // under a freshly-generated viewKey. The edit-share path hands the
          // owner off to the keyed "live version" URL, but view-only sharing
          // had no equivalent — so the editing session never adopted the
          // viewKey. Two bugs followed: the comments button stayed hidden
          // (commentsEnabled = !!viewKey) and subsequent saves self-encrypted
          // (encryptContent(content, undefined)), breaking the view link.
          // Refresh the URL with the viewKey so the session picks it up.
          if (
            !result.editKey &&
            isOwner &&
            !viewKey &&
            selectedDocumentId === result.address
          ) {
            // The snapshot just published *is* the current content, so mark
            // it saved — otherwise the unsaved-changes blocker intercepts
            // this navigation, and if the user picks "stay" the session
            // never adopts the viewKey and the next save silently breaks the
            // link that was just handed out.
            lastSavedMdRef.current = md;
            setLastSavedAt(new Date());
            const [kind, pubkey, identifier] = result.address.split(":");
            const naddr = nip19.naddrEncode({
              kind: Number(kind),
              pubkey,
              identifier,
            });
            navigate(`/doc/${naddr}#${encodeNKeys({ viewKey: result.viewKey })}`, {
              replace: true,
            });
          }

          return result.url;
        }}
      />
    </Box>
  );

  // Always wrap in CommentProvider so the root element type is stable. Swapping
  // it in/out when the owner adopts a share viewKey used to remount the whole
  // editor subtree (closing the open Share dialog, restarting the collab
  // session). `enabled` toggles the comment subscriptions instead.
  return (
    <CommentProvider
      enabled={commentsEnabled}
      viewKey={viewKey ?? ""}
      docAddress={selectedDocumentId ?? ""}
      currentDocText={docPlainText}
      editKey={editKey}
      myPubkey={user?.pubkey}
    >
      {commentsEnabled && <CommentHighlightEffect editor={editor} mode={mode} />}
      {editorJsx}
    </CommentProvider>
  );
}
