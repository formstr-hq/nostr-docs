import { alpha } from "@mui/material/styles";
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Tooltip,
  Typography,
} from "@mui/material";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import EditNoteIcon from "@mui/icons-material/EditNote";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MenuIcon from "@mui/icons-material/Menu";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CropFreeIcon from "@mui/icons-material/CropFree";
import HistoryIcon from "@mui/icons-material/History";
import SensorsIcon from "@mui/icons-material/Sensors";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import CodeIcon from "@mui/icons-material/Code";
import LinkIcon from "@mui/icons-material/Link";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import FormatIndentIncreaseIcon from "@mui/icons-material/FormatIndentIncrease";
import FormatIndentDecreaseIcon from "@mui/icons-material/FormatIndentDecrease";
import TableChartIcon from "@mui/icons-material/TableChart";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import DescriptionIcon from "@mui/icons-material/Description";
import HtmlIcon from "@mui/icons-material/Html";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import { useState, useRef, useEffect } from "react";
import { InputBase } from "@mui/material";
import { useUser } from "../../contexts/UserContext";
import { useDocMetadata } from "../../contexts/DocMetadataContext";
import { useRelays } from "../../contexts/RelayContext";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import DictationButton from "../dictation/DictationButton";
import TextSuggestButton from "../textSuggest/TextSuggestButton";
import type { TextSuggestState } from "../../lib/textSuggest/types";

type EditorMode = "edit" | "preview" | "split";

type VersionEntry = {
  id: string;
  created_at: number;
};

type Props = {
  mode: EditorMode;
  saving: boolean;
  onSetMode: (mode: EditorMode) => void;
  onSave: () => void;
  handleDelete: () => void;
  onShare: () => void;
  versions: VersionEntry[];
  onSelectVersion: (eventId: string) => void;
  editor: Editor | null;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  isViewOnly: boolean;
  onAttachFile?: (files: FileList) => void;
  uploading?: boolean;
  isLocalOnly?: boolean;
  onToggleLocalOnly?: () => void;
  showLocalOnlyToggle?: boolean;
  onExportMarkdown?: () => void;
  onExportHtml?: () => void;
  onExportPlainText?: () => void;
  onExportPdf?: () => void;
  onExportDoc?: () => void;
  showComments?: boolean;
  onToggleComments?: () => void;
  documentAddress?: string;
  heuristicTitle?: string;
  hasEditKey?: boolean;
  textSuggestState?: TextSuggestState;
  textSuggestEnabled?: boolean;
  onToggleTextSuggest?: (next: boolean) => void;
  onTextSuggestSettingsSaved?: () => void;
  onOpenSidebar?: () => void;
};

export function EditorToolbar({
  mode,
  saving,
  onSetMode,
  onSave,
  handleDelete,
  onShare,
  versions,
  onSelectVersion,
  editor,
  focusMode,
  onToggleFocusMode,
  isViewOnly,
  onAttachFile,
  uploading,
  isLocalOnly = false,
  onToggleLocalOnly,
  showLocalOnlyToggle = false,
  onExportMarkdown,
  onExportHtml,
  onExportPlainText,
  onExportPdf,
  onExportDoc,
  showComments,
  onToggleComments,
  documentAddress,
  heuristicTitle,
  hasEditKey = false,
  textSuggestState = { kind: "disabled" },
  textSuggestEnabled = false,
  onToggleTextSuggest,
  onTextSuggestSettingsSaved,
  onOpenSidebar,
}: Props) {
  const { user, loginModal } = useUser();
  const { relays } = useRelays();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [historyAnchor, setHistoryAnchor] = useState<null | HTMLElement>(null);
  const [tableMenuAnchor, setTableMenuAnchor] = useState<null | HTMLElement>(null);
  const tableMenuOpen = Boolean(tableMenuAnchor);

  const exportButtonRef = useRef<HTMLLIElement>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const menuOpen = Boolean(menuAnchor);
  const historyOpen = Boolean(historyAnchor);

  const showFormatting = (mode === "edit" || mode === "split") && !!editor;
  const isInTable = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.isActive("table") ?? false,
  });

  const handleLink = () => {
    if (!editor) return;
    const url = window.prompt("Enter URL");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <>
      {/* ── Top Navigation & Action Header (Attached to Editor Box) ── */}
      <Box
        sx={{
          py: 1,
          px: { xs: 1.5, sm: 2 },
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          minHeight: 56,
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? alpha(t.palette.common.black, 0.45)
              : alpha(t.palette.common.black, 0.04),
          borderBottom: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        {/* Left: Breadcrumbs / Title + Mobile Menu Toggle */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}>
          {onOpenSidebar && (
            <IconButton
              size="small"
              aria-label="Open sidebar menu"
              onClick={onOpenSidebar}
              sx={{
                display: { xs: "inline-flex", md: "none" },
                p: 0.5,
                borderRadius: 1,
                color: "text.primary",
                flexShrink: 0,
              }}
            >
              <MenuIcon sx={{ fontSize: 20 }} />
            </IconButton>
          )}

          {documentAddress ? (
            <ToolbarTitle
              address={documentAddress}
              heuristicTitle={heuristicTitle || "Untitled"}
              canEdit={!isViewOnly}
            />
          ) : (
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, fontSize: "0.92rem", color: "text.primary" }}
            >
              {heuristicTitle || "Untitled"}
            </Typography>
          )}
        </Box>

        {/* Right: Exit Focus + Avatars + 3 relays + Broadcast + History + Share */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0 }}>
          {/* Focus Toggle Button */}
          <Button
            size="small"
            onClick={onToggleFocusMode}
            startIcon={
              focusMode ? (
                <FullscreenExitIcon sx={{ fontSize: 17 }} />
              ) : (
                <CropFreeIcon sx={{ fontSize: 16 }} />
              )
            }
            sx={{
              display: { xs: "none", sm: "inline-flex" },
              bgcolor: (t) => alpha(t.palette.secondary.main, 0.18),
              color: "secondary.main",
              fontWeight: 600,
              fontSize: "0.8rem",
              borderRadius: 1,
              px: 1.5,
              py: 0.5,
              textTransform: "none",
              boxShadow: "none",
              "&:hover": {
                bgcolor: (t) => alpha(t.palette.secondary.main, 0.28),
                boxShadow: "none",
              },
            }}
          >
            {focusMode ? "Exit Focus" : "Focus"}
          </Button>

          {/* Relay Sync Dots & Count */}
          <Tooltip title={`Connected to ${relays.length || 3} relays`}>
            <Box
              sx={{
                display: { xs: "none", md: "flex" },
                alignItems: "center",
                gap: 0.6,
                color: "text.secondary",
                fontSize: "0.78rem",
                cursor: "default",
                userSelect: "none",
                px: 0.5,
              }}
            >
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.35 }}>
                <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "#34D399" }} />
                <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "#34D399" }} />
                <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "text.disabled", opacity: 0.5 }} />
              </Box>
              <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.78rem" }}>
                {relays.length || 3} relays
              </Typography>
            </Box>
          </Tooltip>

          {/* Live broadcast status icon */}
          <Tooltip title="Live Relay Broadcast">
            <IconButton size="small" sx={{ color: "text.secondary", p: 0.6, display: { xs: "none", sm: "inline-flex" } }}>
              <SensorsIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          {/* History Button */}
          <Tooltip title="Version History">
            <IconButton
              size="small"
              onClick={(e) => setHistoryAnchor(e.currentTarget)}
              sx={{ color: "text.secondary", p: 0.6 }}
            >
              <HistoryIcon sx={{ fontSize: 19 }} />
            </IconButton>
          </Tooltip>

          {/* Share Button */}
          <Button
            variant="outlined"
            size="small"
            onClick={onShare}
            sx={{
              color: "text.primary",
              borderColor: (t) => alpha(t.palette.text.primary, 0.15),
              bgcolor: (t) => alpha(t.palette.text.primary, 0.03),
              borderRadius: 1,
              px: 1.75,
              py: 0.5,
              fontSize: "0.82rem",
              fontWeight: 600,
              textTransform: "none",
              "&:hover": {
                borderColor: (t) => alpha(t.palette.text.primary, 0.3),
                bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
              },
            }}
          >
            Share
          </Button>

          {/* Save Action (if logged in / has edit key) */}
          {!isViewOnly && (user || hasEditKey ? (
            <Tooltip title={hasEditKey ? "Saving with shared key" : isLocalOnly ? "Saving to device only" : ""}>
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={onSave}
                startIcon={hasEditKey ? <VpnKeyIcon sx={{ fontSize: 14 }} /> : isLocalOnly ? <SmartphoneIcon sx={{ fontSize: 14 }} /> : undefined}
                sx={{
                  fontWeight: 600,
                  px: 1.5,
                  py: 0.5,
                  fontSize: "0.8rem",
                  borderRadius: 1,
                  boxShadow: "none",
                  "&:hover": { boxShadow: "none" },
                }}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </Tooltip>
          ) : (
            <Button
              variant="contained"
              color="secondary"
              size="small"
              onClick={() => loginModal()}
              sx={{
                fontWeight: 600,
                px: 1.5,
                py: 0.5,
                fontSize: "0.8rem",
                borderRadius: 1,
                boxShadow: "none",
              }}
            >
              Login
            </Button>
          ))}

          {/* Overflow Menu */}
          <IconButton
            size="small"
            aria-label="More actions"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={{ color: "text.secondary", p: 0.5 }}
          >
            <MoreVertIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>

          <Menu
            anchorEl={menuAnchor}
            open={menuOpen}
            onClose={() => setMenuAnchor(null)}
          >
            {/* Mode items */}
            {!isViewOnly && (
              <>
                <MenuItem
                  selected={mode === "edit"}
                  onClick={() => {
                    onSetMode("edit");
                    setMenuAnchor(null);
                  }}
                >
                  <ListItemIcon>
                    <EditIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Visual editor" />
                </MenuItem>
                <MenuItem
                  selected={mode === "split"}
                  onClick={() => {
                    onSetMode("split");
                    setMenuAnchor(null);
                  }}
                >
                  <ListItemIcon>
                    <EditNoteIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Markdown source" />
                </MenuItem>
                <MenuItem
                  selected={mode === "preview"}
                  onClick={() => {
                    onSetMode("preview");
                    setMenuAnchor(null);
                  }}
                >
                  <ListItemIcon>
                    <VisibilityIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Rendered preview" />
                </MenuItem>
                <Divider />
              </>
            )}

            {/* Comments Toggle */}
            {onToggleComments && (
              <MenuItem
                onClick={() => {
                  onToggleComments();
                  setMenuAnchor(null);
                }}
              >
                <ListItemIcon>
                  <ChatBubbleOutlineIcon fontSize="small" color={showComments ? "secondary" : "inherit"} />
                </ListItemIcon>
                <ListItemText
                  primary={showComments ? "Hide Comments" : "Show Comments"}
                />
              </MenuItem>
            )}

            <MenuItem
              onClick={() => {
                onShare();
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <ShareIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Share" />
            </MenuItem>

            <MenuItem
              onClick={(e) => {
                e.stopPropagation();
                setHistoryAnchor(e.currentTarget);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <VisibilityIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="History" />
            </MenuItem>

            <MenuItem
              ref={exportButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                // Open the submenu on press (not hover) to avoid it popping open
                // just from the pointer passing over the item.
                setExportOpen((v) => !v);
              }}
              sx={{ display: "flex", justifyContent: "space-between" }}
            >
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <ListItemIcon>
                  <FileDownloadIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Export" />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                ▸
              </Typography>
            </MenuItem>

            {showLocalOnlyToggle && (
              <MenuItem
                onClick={() => {
                  onToggleLocalOnly?.();
                  setMenuAnchor(null);
                }}
              >
                <ListItemIcon>
                  <CloudOffIcon fontSize="small" color={isLocalOnly ? "secondary" : "inherit"} />
                </ListItemIcon>
                <ListItemText
                  primary="Device only"
                  secondary={isLocalOnly ? "On · won't sync to relays" : "Off · syncs to relays"}
                  secondaryTypographyProps={{ sx: { fontSize: "0.7rem" } }}
                />
              </MenuItem>
            )}

            <Divider />

            <MenuItem
              onClick={() => {
                handleDelete();
                setMenuAnchor(null);
              }}
              sx={{ color: "error.main" }}
            >
              <ListItemIcon sx={{ color: "error.main" }}>
                <DeleteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Delete" />
            </MenuItem>
          </Menu>

          <Menu
            anchorEl={exportButtonRef.current}
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            anchorOrigin={{ vertical: "top", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
            slotProps={{
              paper: {
                style: {
                  pointerEvents: "auto",
                },
              },
            }}
          >
            <MenuItem
              onClick={() => {
                onExportPdf?.();
                setExportOpen(false);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <PictureAsPdfIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary="PDF"
                secondary="Print / Save as PDF"
                secondaryTypographyProps={{ sx: { fontSize: "0.7rem" } }}
              />
            </MenuItem>
            <MenuItem
              onClick={() => {
                onExportDoc?.();
                setExportOpen(false);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <ArticleOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary="Word (.docx)"
                secondary="Microsoft Word / Google Docs"
                secondaryTypographyProps={{ sx: { fontSize: "0.7rem" } }}
              />
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                onExportMarkdown?.();
                setExportOpen(false);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <DescriptionIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary="Markdown (.md)"
                secondary="Raw markdown source"
                secondaryTypographyProps={{ sx: { fontSize: "0.7rem" } }}
              />
            </MenuItem>
            <MenuItem
              onClick={() => {
                onExportHtml?.();
                setExportOpen(false);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <HtmlIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary="HTML (.html)"
                secondary="Styled web page"
                secondaryTypographyProps={{ sx: { fontSize: "0.7rem" } }}
              />
            </MenuItem>
            <MenuItem
              onClick={() => {
                onExportPlainText?.();
                setExportOpen(false);
                setMenuAnchor(null);
              }}
            >
              <ListItemIcon>
                <TextSnippetIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary="Plain Text (.txt)"
                secondary="No formatting"
                secondaryTypographyProps={{ sx: { fontSize: "0.7rem" } }}
              />
            </MenuItem>
          </Menu>

          <Menu
            anchorEl={historyAnchor}
            open={historyOpen}
            onClose={() => setHistoryAnchor(null)}
          >
            {versions.length === 0 && (
              <MenuItem disabled>
                <ListItemText primary="No history yet" />
              </MenuItem>
            )}
            {versions
              .slice()
              .sort((a, b) => b.created_at - a.created_at)
              .map((v) => (
                <MenuItem
                  key={v.id}
                  onClick={() => {
                    onSelectVersion(v.id);
                    setHistoryAnchor(null);
                  }}
                >
                  <ListItemText
                    primary={new Date(v.created_at * 1000).toLocaleString()}
                  />
                </MenuItem>
              ))}
          </Menu>

      {/* ── Row 2: formatting buttons (edit/split only) ───── */}
      {showFormatting && (
        <>
          <Divider />
          <Box
            sx={{
              position: "fixed",
              bottom: { xs: 0, sm: 16 },
              left: { xs: 0, sm: "50%" },
              transform: { xs: "none", sm: "translateX(-50%)" },
              width: { xs: "100%", sm: "auto" },
              maxWidth: { xs: "100vw", sm: "calc(100vw - 32px)" },
              zIndex: 1300,
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              flexWrap: "nowrap",
              overflowX: "auto",
              overflowY: "hidden",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
              "&::-webkit-scrollbar": { display: "none" },
              px: { xs: 1.25, sm: 1.5 },
              py: { xs: 0.75, sm: 0.5 },
              borderRadius: { xs: 0, sm: 1.5 },
              bgcolor: (t) => alpha(t.palette.background.paper, 0.95),
              border: "1px solid",
              borderColor: (t) => alpha(t.palette.text.primary, 0.08),
              borderBottom: { xs: "none", sm: "1px solid" },
              borderLeft: { xs: "none", sm: "1px solid" },
              borderRight: { xs: "none", sm: "1px solid" },
              borderTop: "1px solid",
              backdropFilter: "blur(16px)",
              boxShadow: (t) => `0 8px 32px ${alpha(t.palette.common.black, 0.35)}`,
              boxSizing: "border-box",
              "& > *": {
                flexShrink: 0,
              },
            }}
          >
            {/* Undo / Redo */}
            <Tooltip title="Undo">
              <span>
                <IconButton
                  size="small"
                  onClick={() => editor.chain().focus().undo().run()}
                  disabled={!editor.can().undo()}
                  sx={{ p: 0.75 }}
                >
                  <UndoIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Redo">
              <span>
                <IconButton
                  size="small"
                  onClick={() => editor.chain().focus().redo().run()}
                  disabled={!editor.can().redo()}
                  sx={{ p: 0.75 }}
                >
                  <RedoIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: (t) => alpha(t.palette.text.primary, 0.08) }} />

            {/* Text style */}
            <Tooltip title="Bold (Ctrl+B)">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleBold().run()}
                color={editor.isActive("bold") ? "secondary" : "default"}
                sx={{ p: 0.75 }}
              >
                <FormatBoldIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Italic (Ctrl+I)">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                color={editor.isActive("italic") ? "secondary" : "default"}
                sx={{ p: 0.75 }}
              >
                <FormatItalicIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Inline code">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleCode().run()}
                color={editor.isActive("code") ? "secondary" : "default"}
                sx={{ p: 0.75 }}
              >
                <CodeIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Link">
              <IconButton
                size="small"
                onClick={handleLink}
                color={editor.isActive("link") ? "secondary" : "default"}
                sx={{ p: 0.75 }}
              >
                <LinkIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: (t) => alpha(t.palette.text.primary, 0.08) }} />

            {/* Headings */}
            {([1, 2, 3] as const).map((level) => (
              <Tooltip key={level} title={`Heading ${level}`}>
                <ButtonBase
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level }).run()
                  }
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: 1,
                    fontSize: "0.65rem",
                    fontWeight: 800,
                    fontFamily: "inherit",
                    color: editor.isActive("heading", { level })
                      ? "secondary.main"
                      : "text.secondary",
                    "&:hover": { bgcolor: "action.hover" },
                    transition: "background-color 0.15s, color 0.15s",
                  }}
                >
                  H{level}
                </ButtonBase>
              </Tooltip>
            ))}

            <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: (t) => alpha(t.palette.text.primary, 0.08) }} />

            {/* Lists */}
            <Tooltip title="Bullet list">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                color={editor.isActive("bulletList") ? "secondary" : "default"}
                sx={{ p: 0.75 }}
              >
                <FormatListBulletedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Numbered list">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                color={
                  editor.isActive("orderedList") ? "secondary" : "default"
                }
                sx={{ p: 0.75 }}
              >
                <FormatListNumberedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Indent (Tab)">
              <IconButton
                size="small"
                onClick={() => {
                  if (editor.isActive("listItem")) {
                    editor.chain().focus().sinkListItem("listItem").run();
                  } else {
                    editor.chain().focus().indent().run();
                  }
                }}
                sx={{ p: 0.75 }}
              >
                <FormatIndentIncreaseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Outdent (Shift+Tab)">
              <IconButton
                size="small"
                onClick={() => {
                  if (editor.isActive("listItem")) {
                    editor.chain().focus().liftListItem("listItem").run();
                  } else {
                    editor.chain().focus().outdent().run();
                  }
                }}
                sx={{ p: 0.75 }}
              >
                <FormatIndentDecreaseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Blockquote">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                color={
                  editor.isActive("blockquote") ? "secondary" : "default"
                }
                sx={{ p: 0.75 }}
              >
                <FormatQuoteIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: (t) => alpha(t.palette.text.primary, 0.08) }} />

            {/* Code block */}
            <Tooltip title="Code block">
              <ButtonBase
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                sx={{
                  width: 30,
                  height: 26,
                  borderRadius: 1,
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: editor.isActive("codeBlock")
                    ? "secondary.main"
                    : "text.secondary",
                  "&:hover": { bgcolor: "action.hover" },
                  transition: "background-color 0.15s, color 0.15s",
                }}
              >
                {"</>"}
              </ButtonBase>
            </Tooltip>

            {/* Table */}
            <Tooltip title="Insert table">
              <IconButton
                size="small"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
                color={isInTable ? "secondary" : "default"}
                sx={{ p: 0.75 }}
              >
                <TableChartIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            {isInTable && (
              <>
                <Tooltip title="Table options">
                  <ButtonBase
                    onClick={(e) => setTableMenuAnchor(e.currentTarget)}
                    sx={{
                      height: 26,
                      px: 0.5,
                      borderRadius: 1,
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      fontFamily: "inherit",
                      color: "secondary.main",
                      bgcolor: "action.selected",
                      "&:hover": { bgcolor: "action.hover" },
                      transition: "background-color 0.15s, color 0.15s",
                    }}
                  >
                    Table ▾
                  </ButtonBase>
                </Tooltip>
                <Menu
                  anchorEl={tableMenuAnchor}
                  open={tableMenuOpen}
                  onClose={() => setTableMenuAnchor(null)}
                >
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().addRowBefore().run();
                      setTableMenuAnchor(null);
                    }}
                  >
                    <ListItemText primary="Add row above" />
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().addRowAfter().run();
                      setTableMenuAnchor(null);
                    }}
                  >
                    <ListItemText primary="Add row below" />
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().deleteRow().run();
                      setTableMenuAnchor(null);
                    }}
                  >
                    <ListItemText primary="Delete row" />
                  </MenuItem>
                  <Divider />
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().addColumnBefore().run();
                      setTableMenuAnchor(null);
                    }}
                  >
                    <ListItemText primary="Add column before" />
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().addColumnAfter().run();
                      setTableMenuAnchor(null);
                    }}
                  >
                    <ListItemText primary="Add column after" />
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().deleteColumn().run();
                      setTableMenuAnchor(null);
                    }}
                  >
                    <ListItemText primary="Delete column" />
                  </MenuItem>
                  <Divider />
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().toggleHeaderRow().run();
                      setTableMenuAnchor(null);
                    }}
                  >
                    <ListItemText primary="Toggle header row" />
                  </MenuItem>
                  <Divider />
                  <MenuItem
                    onClick={() => {
                      editor.chain().focus().deleteTable().run();
                      setTableMenuAnchor(null);
                    }}
                    sx={{ color: "error.main" }}
                  >
                    <ListItemIcon sx={{ color: "error.main" }}>
                      <DeleteIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary="Delete table" />
                  </MenuItem>
                </Menu>
              </>
            )}

            <Divider orientation="vertical" flexItem sx={{ mx: 0.25, borderColor: (t) => alpha(t.palette.text.primary, 0.08) }} />

            {/* Dictation */}
            <DictationButton
              size="small"
              tooltip="Dictate"
              onTranscript={(text) =>
                editor.chain().focus().insertContent(text + " ").run()
              }
            />

            {/* AI text suggestions */}
            {onToggleTextSuggest && (
              <TextSuggestButton
                size="small"
                state={textSuggestState}
                enabled={textSuggestEnabled}
                onSettingsSaved={onTextSuggestSettingsSaved ?? (() => {})}
              />
            )}

            {/* Attach file */}
            {onAttachFile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="*/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      onAttachFile(e.target.files);
                      e.target.value = "";
                    }
                  }}
                />
                <Tooltip title={uploading ? "Uploading…" : "Attach file"}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      color="default"
                      sx={{ p: 0.75 }}
                    >
                      <AttachFileIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
          </Box>
        </>
      )}
    </>
  );
}

function ToolbarTitle({
  address,
  heuristicTitle,
  canEdit,
}: {
  address: string;
  heuristicTitle: string;
  canEdit: boolean;
}) {
  const { docTitles, setDocTitle, docTags } = useDocMetadata();
  const customTitle = docTitles.get(address) || "";
  const displayTitle = customTitle || heuristicTitle;
  const primaryCategory = (address ? docTags.get(address)?.[0] : null) || "Workspace";

  const [input, setInput] = useState(displayTitle);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setInput(displayTitle);
    }
  }, [displayTitle, editing]);

  const handleSave = async () => {
    let newTitle = input.trim();
    if (newTitle === "" || newTitle === heuristicTitle) {
      newTitle = "";
    }
    if (newTitle === customTitle) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await setDocTitle(address, newTitle);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        gap: 0.75,
        "&:hover .edit-icon": { opacity: 1 },
      }}
      onDoubleClick={() => canEdit && setEditing(true)}
    >
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          fontSize: "0.86rem",
          fontWeight: 500,
          whiteSpace: "nowrap",
          letterSpacing: "-0.01em",
        }}
      >
        {primaryCategory}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.disabled",
          fontSize: "0.86rem",
          userSelect: "none",
        }}
      >
        /
      </Typography>

      {editing ? (
        <InputBase
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setInput(displayTitle);
              setEditing(false);
            }
          }}
          disabled={saving}
          placeholder="Enter document title..."
          sx={{
            fontSize: "0.92rem",
            fontWeight: 700,
            width: "100%",
            maxWidth: 360,
          }}
          inputProps={{ style: { textAlign: "left" } }}
        />
      ) : (
        <Box sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              fontSize: "0.92rem",
              color: "text.primary",
              cursor: canEdit ? "text" : "default",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: { xs: 140, sm: 240, md: 380 },
            }}
            title={displayTitle}
          >
            {displayTitle}
          </Typography>
          {canEdit && (
            <Tooltip title="Rename Document">
              <IconButton
                className="edit-icon"
                size="small"
                onClick={() => setEditing(true)}
                sx={{
                  opacity: 0,
                  transition: "opacity 0.2s",
                  p: 0.25,
                  ml: 0.5,
                }}
              >
                <EditIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
    </Box>
  );
}
