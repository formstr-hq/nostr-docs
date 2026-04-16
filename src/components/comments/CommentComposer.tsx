import { useState, useEffect, useRef, useCallback } from "react";
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
  containerRef?: React.RefObject<HTMLElement | null>;
  docEventId: string;
};

function extractContext(range: Range, count: number) {
  let prefix = "";
  let suffix = "";

  // ── prefix: text before the selection start ──
  const preRange = range.cloneRange();
  preRange.collapse(true);
  const startContainer = preRange.startContainer;
  const startOffset = preRange.startOffset;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const textBefore = (startContainer.textContent ?? "").slice(0, startOffset);
    prefix = textBefore.slice(-count);
  }

  if (prefix.length < count) {
    const remaining = count - prefix.length;
    // TreeWalker has no previousNode from the initial position, so collect
    // preceding nodes into an array and walk it in reverse.
    const nodesBeforeStart: Text[] = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer.parentElement ?? document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      if (walker.currentNode === startContainer) break;
      nodesBeforeStart.push(walker.currentNode as Text);
    }
    const parts: string[] = [];
    let collected = 0;
    for (let i = nodesBeforeStart.length - 1; i >= 0 && collected < remaining; i--) {
      const t = nodesBeforeStart[i].textContent ?? "";
      parts.unshift(t);
      collected += t.length;
    }
    prefix = (parts.join("") + prefix).slice(-count);
  }

  // ── suffix: text after the selection end ──
  const postRange = range.cloneRange();
  postRange.collapse(false);
  const endContainer = postRange.endContainer;
  const endOffset = postRange.endOffset;

  if (endContainer.nodeType === Node.TEXT_NODE) {
    const textAfter = (endContainer.textContent ?? "").slice(endOffset);
    suffix = textAfter.slice(0, count);
  }

  if (suffix.length < count) {
    const remaining = count - suffix.length;
    const walker = document.createTreeWalker(
      range.commonAncestorContainer.parentElement ?? document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      if (walker.currentNode === endContainer) break;
    }
    let collected = 0;
    while (walker.nextNode() && collected < remaining) {
      const t = (walker.currentNode as Text).textContent ?? "";
      suffix += t;
      collected += t.length;
    }
    suffix = suffix.slice(0, count);
  }

  return { prefix, suffix };
}

export function CommentComposer({ editor, containerRef, docEventId }: Props) {
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

  /* ── TipTap selection mode ───────────────────────────────── */
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

  /* ── Native DOM selection mode (preview) ─────────────────── */
  const handleNativeSelection = useCallback(() => {
    if (composingRef.current) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setAnchorRect(null);
      return;
    }

    const container = containerRef?.current;
    if (!container) return;

    // Only handle selections within our container
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setAnchorRect(null);
      return;
    }

    const selectedText = sel.toString();
    if (!selectedText.trim()) {
      setAnchorRect(null);
      return;
    }

    quoteRef.current = selectedText;
    const ctx = extractContext(range, 32);
    prefixRef.current = ctx.prefix;
    suffixRef.current = ctx.suffix;

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    setAnchorRect(rect);
  }, [containerRef]);

  useEffect(() => {
    // Only activate native mode when there's no editor and a container is provided
    if (editor || !containerRef?.current) return;

    document.addEventListener("selectionchange", handleNativeSelection);
    return () => document.removeEventListener("selectionchange", handleNativeSelection);
  }, [editor, containerRef, handleNativeSelection]);

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
