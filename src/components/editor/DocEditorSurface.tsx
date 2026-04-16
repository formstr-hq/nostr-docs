import { useRef } from "react";
import { Box, Typography, useTheme, Fab } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import EditIcon from "@mui/icons-material/Edit";
import { EncryptedFilePreview } from "./EncryptedFilePreview";
import type { EncryptedFileAttrs } from "./EncryptedFilePreview";
import { CommentComposer } from "../comments/CommentComposer";
import { CommentSidebar } from "../comments/CommentSidebar";

type Props = {
  value: string;
  editor: Editor | null;
  mode: "edit" | "preview" | "split";
  onChange: (value: string) => void;
  onToggleMode: () => void;
  isMobile: boolean;
  canEdit: boolean;
  commentsEnabled: boolean;
  showComments: boolean;
  onCloseComments: () => void;
  docEventId: string;
};

const markdownSxBase = {
  "& h1, & h2, & h3, & h4": {
    fontWeight: 800,
    marginTop: "0.6em",
    marginBottom: "0.3em",
  },
  "& p": { lineHeight: 1.7 },
  "& code": {
    background: "rgba(128,128,128,0.15)",
    borderRadius: "4px",
    padding: "0.15em 0.4em",
    fontFamily: "monospace",
    fontSize: "0.88em",
  },
  "& pre": {
    background: "rgba(128,128,128,0.12)",
    borderRadius: "8px",
    padding: "1em",
    overflowX: "auto",
  },
  "& pre code": { background: "none", padding: 0 },
  "& ul, & ol": { paddingLeft: "1.5em" },
  "& blockquote": {
    borderLeft: "3px solid rgba(128,128,128,0.35)",
    paddingLeft: "1em",
    margin: "0.5em 0",
    opacity: 0.85,
  },
};

// Custom component map for ReactMarkdown — handles <encrypted-file> HTML elements
// that tiptap-markdown serializes into the document markdown.
// Cast to any: react-markdown's Components type only covers known HTML tags,
// but rehype-raw passes custom elements through as-is.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markdownComponents: any = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "encrypted-file": (props: any) => {
    const attrs: EncryptedFileAttrs = {
      src: props["data-src"] ?? "",
      decryptionKey: props["data-key"] ?? "",
      decryptionNonce: props["data-nonce"] ?? "",
      mimeType: props["data-mime"] ?? "",
      filename: decodeURIComponent(props["data-filename"] ?? "file"),
      width: props["data-width"] ? Number(props["data-width"]) : null,
    };
    if (!attrs.src || !attrs.decryptionKey) return null;
    return <EncryptedFilePreview {...attrs} />;
  },
};

export function DocEditorSurface({
  value,
  editor,
  mode,
  onChange,
  onToggleMode,
  isMobile,
  canEdit,
  commentsEnabled,
  showComments,
  onCloseComments,
  docEventId,
}: Props) {
  const theme = useTheme();
  const previewRef = useRef<HTMLElement>(null);

  const linkSx = {
    "& a": {
      color: theme.palette.secondary.main,
      textDecoration: "underline",
      "&:hover": { opacity: 0.8 },
    },
  };

  /* ── Preview mode ─────────────────────────────────────── */
  if (mode === "preview") {
    return (
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Box
          ref={previewRef}
          sx={{
            flex: 1,
            overflowY: "auto",
            p: 3,
            ...markdownSxBase,
            ...linkSx,
            color: theme.palette.text.primary,
          }}
        >
          {/* Sticky edit button — hidden for view-only shared links */}
          {canEdit && (
            <Fab
              size="small"
              color="secondary"
              onClick={onToggleMode}
              title="Edit document"
              sx={{ position: "sticky", top: 0, float: "right", mb: 1, ml: 1 }}
            >
              <EditIcon fontSize="small" />
            </Fab>
          )}

          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>{value}</ReactMarkdown>
          ) : (
            <Typography color="text.secondary">
              Nothing to preview yet —{" "}
              {isMobile ? "tap the edit button" : "click the edit button"} to
              start writing.
            </Typography>
          )}
        </Box>
        {commentsEnabled && (
          <CommentComposer editor={null} containerRef={previewRef} docEventId={docEventId} />
        )}
        {showComments && <CommentSidebar onClose={onCloseComments} />}
      </Box>
    );
  }

  /* ── Split mode — markdown only on mobile, split on desktop ── */
  if (mode === "split") {
    const markdownPane = (
      <Box
        component="textarea"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        spellCheck={false}
        placeholder="Start writing Markdown here…"
        sx={{
          flex: 1,
          resize: "none",
          border: "none",
          borderRight: isMobile ? "none" : "1px solid",
          borderColor: "divider",
          outline: "none",
          background: "transparent",
          color: "text.primary",
          fontSize: "14px",
          lineHeight: 1.7,
          fontFamily:
            '"Fira Code", "Cascadia Code", ui-monospace, "Menlo", monospace',
          p: 3,
          boxSizing: "border-box",
          "&::placeholder": { color: "text.secondary", opacity: 0.5 },
        }}
      />
    );

    if (isMobile) return markdownPane;

    return (
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {markdownPane}
        <Box
          sx={{
            flex: 1,
            overflowY: "auto",
            p: 3,
            ...markdownSxBase,
            ...linkSx,
            color: theme.palette.text.primary,
          }}
        >
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>{value}</ReactMarkdown>
          ) : (
            <Typography color="text.secondary" fontStyle="italic">
              Preview will appear here as you type…
            </Typography>
          )}
        </Box>
        {showComments && <CommentSidebar onClose={onCloseComments} />}
      </Box>
    );
  }

  /* ── Edit mode — TipTap WYSIWYG ───────────────────────── */
  return (
    <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <Box
        sx={{ flex: 1, overflowY: "auto", p: 3, cursor: "text" }}
        onClick={() => editor?.commands.focus()}
      >
        <EditorContent editor={editor} />
        {commentsEnabled && (
          <CommentComposer editor={editor} docEventId={docEventId} />
        )}
      </Box>
      {showComments && <CommentSidebar onClose={onCloseComments} />}
    </Box>
  );
}
