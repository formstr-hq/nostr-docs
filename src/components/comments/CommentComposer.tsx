import { useState, useEffect, useRef } from "react";
import {
  Box,
  Paper,
  IconButton,
  TextField,
  Button,
  Tooltip,
} from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import type { Editor } from "@tiptap/react";
import { useComments } from "../../contexts/CommentContext";

type Props = {
  editor: Editor | null;
  docEventId: string;
};

export function CommentComposer({ editor, docEventId }: Props) {
  const { addComment } = useComments();

  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Use a ref so the selectionUpdate handler always reads the current value
  // without needing to be re-registered when composing changes.
  const composingRef = useRef(false);

  // Captured at selection time and held stable while the form is open.
  const quoteRef = useRef("");
  const prefixRef = useRef("");
  const suffixRef = useRef("");

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      // Never reset the anchor while the compose form is open.
      if (composingRef.current) return;

      const { from, to } = editor.state.selection;
      if (from === to) {
        setAnchorRect(null);
        return;
      }

      const selectedText = editor.state.doc.textBetween(from, to);
      if (!selectedText.trim()) {
        setAnchorRect(null);
        return;
      }

      // Capture quote + surrounding context before the selection can change.
      const docSize = editor.state.doc.content.size;
      quoteRef.current = selectedText;
      prefixRef.current = editor.state.doc.textBetween(
        Math.max(0, from - 32),
        from,
      );
      suffixRef.current = editor.state.doc.textBetween(
        to,
        Math.min(docSize, to + 32),
      );

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;
      const rect = domSelection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setAnchorRect(rect);
    };

    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => { editor.off("selectionUpdate", handleSelectionUpdate); };
  }, [editor]);

  const handleOpen = () => {
    composingRef.current = true;
    setComposing(true);
    setBody("");
  };

  const handleClose = () => {
    composingRef.current = false;
    setComposing(false);
    setAnchorRect(null);
    setBody("");
  };

  const handleSubmit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await addComment(
        {
          content: body.trim(),
          type: "comment",
          ...(quoteRef.current
            ? {
                quote: quoteRef.current,
                context: {
                  prefix: prefixRef.current,
                  suffix: suffixRef.current,
                },
              }
            : {}),
        },
        docEventId,
      );
      handleClose();
    } catch (err) {
      console.error("Failed to post comment:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!anchorRect) return null;

  const top = anchorRect.top - 8;
  const left = anchorRect.left + anchorRect.width / 2;

  if (!composing) {
    return (
      <Box
        sx={{
          position: "fixed",
          top,
          left,
          transform: "translateX(-50%) translateY(-100%)",
          zIndex: 1500,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip title="Add comment">
          <IconButton
            size="small"
            onClick={handleOpen}
            sx={{
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              boxShadow: 2,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <ChatBubbleOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Paper
      elevation={4}
      sx={{
        position: "fixed",
        top,
        left,
        transform: "translateX(-50%) translateY(-100%)",
        zIndex: 1500,
        p: 1.5,
        width: 280,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        borderRadius: 2,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {quoteRef.current && (
        <Box
          sx={{
            borderLeft: "3px solid",
            borderColor: "secondary.main",
            pl: 1,
            fontSize: "0.75rem",
            color: "text.secondary",
            fontStyle: "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {quoteRef.current}
        </Box>
      )}
      <TextField
        autoFocus
        multiline
        minRows={2}
        maxRows={5}
        size="small"
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onFocus={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") handleClose();
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSubmit();
        }}
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.75 }}>
        <Button size="small" onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          color="secondary"
          onClick={handleSubmit}
          disabled={!body.trim() || submitting}
        >
          {submitting ? "Posting…" : "Comment"}
        </Button>
      </Box>
    </Paper>
  );
}
