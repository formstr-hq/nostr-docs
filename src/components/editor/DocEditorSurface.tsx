import { Box, Typography, useTheme, Fab } from "@mui/material";
import ReactMarkdown from "react-markdown";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import EditIcon from "@mui/icons-material/Edit";

type Props = {
  value: string;
  editor: Editor | null;
  mode: "edit" | "preview" | "split";
  onChange: (value: string) => void;
  onToggleMode: () => void;
  isMobile: boolean;
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

export function DocEditorSurface({
  value,
  editor,
  mode,
  onChange,
  onToggleMode,
  isMobile,
}: Props) {
  const theme = useTheme();

  /* ── Preview mode ─────────────────────────────────────── */
  if (mode === "preview") {
    return (
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          p: 3,
          ...markdownSxBase,
          color: theme.palette.text.secondary,
          "& h1, & h2, & h3, & h4": {
            ...markdownSxBase["& h1, & h2, & h3, & h4"],
            color: theme.palette.text.primary,
          },
        }}
      >
        {/* Sticky edit button */}
        <Fab
          size="small"
          color="secondary"
          onClick={onToggleMode}
          title="Edit document"
          sx={{ position: "sticky", top: 0, float: "right", mb: 1, ml: 1 }}
        >
          <EditIcon fontSize="small" />
        </Fab>

        {value.trim() ? (
          <ReactMarkdown>{value}</ReactMarkdown>
        ) : (
          <Typography color="text.secondary">
            Nothing to preview yet —{" "}
            {isMobile ? "tap the edit button" : "click the edit button"} to
            start writing.
          </Typography>
        )}
      </Box>
    );
  }

  /* ── Split mode — plain markdown textarea + rendered preview ── */
  if (mode === "split") {
    return (
      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left: raw markdown textarea */}
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
            borderRight: "1px solid",
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

        {/* Right: rendered preview */}
        <Box
          sx={{
            flex: 1,
            overflowY: "auto",
            p: 3,
            ...markdownSxBase,
            color: theme.palette.text.secondary,
            "& h1, & h2, & h3, & h4": {
              ...markdownSxBase["& h1, & h2, & h3, & h4"],
              color: theme.palette.text.primary,
            },
          }}
        >
          {value.trim() ? (
            <ReactMarkdown>{value}</ReactMarkdown>
          ) : (
            <Typography color="text.secondary" fontStyle="italic">
              Preview will appear here as you type…
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  /* ── Edit mode — TipTap WYSIWYG ───────────────────────── */
  return (
    <Box
      sx={{
        flex: 1,
        overflowY: "auto",
        p: 3,
        cursor: "text",
      }}
      onClick={() => editor?.commands.focus()}
    >
      <EditorContent editor={editor} />
    </Box>
  );
}
