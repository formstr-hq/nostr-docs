import {
  Paper,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import EditNoteIcon from "@mui/icons-material/EditNote";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
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
import AttachFileIcon from "@mui/icons-material/AttachFile";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import DescriptionIcon from "@mui/icons-material/Description";
import HtmlIcon from "@mui/icons-material/Html";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import { useState, useRef } from "react";
import { useUser } from "../../contexts/UserContext";
import type { Editor } from "@tiptap/react";

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
}: Props) {
  const { user, loginModal } = useUser();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [historyAnchor, setHistoryAnchor] = useState<null | HTMLElement>(null);

  const exportButtonRef = useRef<HTMLLIElement>(null);
  const hideExportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);

  const handleExportEnter = () => {
    clearTimeout(hideExportTimer.current);
    setExportOpen(true);
  };

  const handleExportLeave = () => {
    hideExportTimer.current = setTimeout(() => {
      setExportOpen(false);
    }, 200);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const menuOpen = Boolean(menuAnchor);
  const historyOpen = Boolean(historyAnchor);

  const showFormatting = (mode === "edit" || mode === "split") && !!editor;

  const handleLink = () => {
    if (!editor) return;
    const url = window.prompt("Enter URL");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <Paper
      elevation={2}
      sx={{
        borderRadius: 2,
        border: "1px solid rgba(0,0,0,0.08)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* ── Row 1: mode toggles + actions ─────────────────── */}
      <Box
        sx={{
          p: 1,
          px: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        {/* Left: mode toggle — hidden for view-only shared links */}
        {!isViewOnly && (
          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_, val) => val && onSetMode(val as EditorMode)}
            sx={{ "& .MuiToggleButton-root": { px: 1.5 } }}
          >
            <ToggleButton value="edit" title="WYSIWYG editor">
              <EditIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="split" title="Markdown source">
              <EditNoteIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="preview" title="Rendered preview">
              <VisibilityIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        )}
        {isViewOnly && <Box />}

        {/* Right: save + focus + overflow menu */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {!isViewOnly && (user ? (
            <Tooltip title={isLocalOnly ? "Saving to device only" : ""}>
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={onSave}
                startIcon={isLocalOnly ? <SmartphoneIcon fontSize="small" /> : undefined}
                sx={{ fontWeight: 700, px: 2 }}
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
              sx={{ fontWeight: 700, px: 2 }}
            >
              Login to Save
            </Button>
          ))}

          <Tooltip title={focusMode ? "Exit focus mode" : "Focus mode"}>
            <IconButton size="small" onClick={onToggleFocusMode}>
              {focusMode ? (
                <FullscreenExitIcon fontSize="small" />
              ) : (
                <FullscreenIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>

          <IconButton
            size="small"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>

          <Menu
            anchorEl={menuAnchor}
            open={menuOpen}
            onClose={() => setMenuAnchor(null)}
          >
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
              onMouseEnter={handleExportEnter}
              onMouseLeave={handleExportLeave}
              onClick={(e) => {
                e.stopPropagation();
                // For mobile, a click can toggle it too if hover isn't available
                setExportOpen(!exportOpen); 
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
            MenuListProps={{
              onMouseEnter: handleExportEnter,
              onMouseLeave: handleExportLeave,
            }}
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
                primary="Word (.doc)"
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
        </Box>
      </Box>

      {/* ── Row 2: formatting buttons (edit/split only) ───── */}
      {showFormatting && (
        <>
          <Divider />
          <Box
            sx={{
              px: 1,
              py: 0.5,
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              flexWrap: "wrap",
            }}
          >
            {/* Undo / Redo */}
            <Tooltip title="Undo">
              <span>
                <IconButton
                  size="small"
                  onClick={() => editor.chain().focus().undo().run()}
                  disabled={!editor.can().undo()}
                >
                  <UndoIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Redo">
              <span>
                <IconButton
                  size="small"
                  onClick={() => editor.chain().focus().redo().run()}
                  disabled={!editor.can().redo()}
                >
                  <RedoIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            {/* Text style */}
            <Tooltip title="Bold (Ctrl+B)">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleBold().run()}
                color={editor.isActive("bold") ? "secondary" : "default"}
                sx={{ fontWeight: 900 }}
              >
                <FormatBoldIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Italic (Ctrl+I)">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                color={editor.isActive("italic") ? "secondary" : "default"}
              >
                <FormatItalicIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Inline code">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleCode().run()}
                color={editor.isActive("code") ? "secondary" : "default"}
              >
                <CodeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Link">
              <IconButton
                size="small"
                onClick={handleLink}
                color={editor.isActive("link") ? "secondary" : "default"}
              >
                <LinkIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            {/* Headings */}
            {([1, 2, 3] as const).map((level) => (
              <Tooltip key={level} title={`Heading ${level}`}>
                <ButtonBase
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level }).run()
                  }
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: 1,
                    fontSize: "0.7rem",
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

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            {/* Lists */}
            <Tooltip title="Bullet list">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                color={editor.isActive("bulletList") ? "secondary" : "default"}
              >
                <FormatListBulletedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Numbered list">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                color={
                  editor.isActive("orderedList") ? "secondary" : "default"
                }
              >
                <FormatListNumberedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Indent list item (Tab)">
              <span>
                <IconButton
                  size="small"
                  onClick={() =>
                    editor.chain().focus().sinkListItem("listItem").run()
                  }
                  disabled={!editor.can().sinkListItem("listItem")}
                >
                  <FormatIndentIncreaseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Unindent list item (Shift+Tab)">
              <span>
                <IconButton
                  size="small"
                  onClick={() =>
                    editor.chain().focus().liftListItem("listItem").run()
                  }
                  disabled={!editor.can().liftListItem("listItem")}
                >
                  <FormatIndentDecreaseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Blockquote">
              <IconButton
                size="small"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                color={
                  editor.isActive("blockquote") ? "secondary" : "default"
                }
              >
                <FormatQuoteIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            {/* Code block */}
            <Tooltip title="Code block">
              <ButtonBase
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                sx={{
                  width: 32,
                  height: 28,
                  borderRadius: 1,
                  fontSize: "0.62rem",
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

            {/* Attach file */}
            {onAttachFile && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
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
                    >
                      <AttachFileIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
          </Box>
        </>
      )}
    </Paper>
  );
}
