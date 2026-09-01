import { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Paper,
  IconButton,
  TextField,
  Button,
  Tooltip,
  alpha,
} from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import type { Editor } from "@tiptap/react";
import { useComments } from "../../contexts/CommentContext";

type Props = {
  editor: Editor | null;
  containerRef?: React.RefObject<HTMLElement | null>;
  docEventId: string;
  isMobile?: boolean;
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

export function CommentComposer({ editor, containerRef, docEventId, isMobile }: Props) {
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

  // On mobile, pin to the right edge at the selection's vertical midpoint so
  // the button is never obscured by the native copy/paste/select menu.
  const buttonTop = isMobile
    ? anchorRect.top + anchorRect.height / 2 - 18
    : anchorRect.top - 8;
  const buttonSx = isMobile
    ? { position: "fixed" as const, top: buttonTop, right: 12, zIndex: 1500 }
    : {
        position: "fixed" as const,
        top: buttonTop,
        left: anchorRect.left + anchorRect.width / 2,
        transform: "translateX(-50%) translateY(-100%)",
        zIndex: 1500,
      };

  // Compose form: on mobile centre horizontally and anchor just below the button.
  const formTop = isMobile ? buttonTop + 44 : buttonTop;
  const formSx = isMobile
    ? {
        position: "fixed" as const,
        top: formTop,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1500,
        width: "min(320px, calc(100vw - 32px))",
      }
    : {
        position: "fixed" as const,
        top: formTop,
        left: anchorRect.left + anchorRect.width / 2,
        transform: "translateX(-50%) translateY(-100%)",
        zIndex: 1500,
        width: 280,
      };

  if (!composing) {
    return (
      <Box
        sx={buttonSx}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip title="Add comment">
          <IconButton
            size="small"
            onClick={handleOpen}
            sx={{
              bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
              color: "primary.main",
              border: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(8px)",
              boxShadow: 2,
              "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.16) },
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
        ...formSx,
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        borderRadius: "12px",
        border: "1px solid",
        borderColor: (t) => alpha(t.palette.text.primary, 0.06),
        bgcolor: "background.paper",
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
        sx={{
          "& .MuiOutlinedInput-root": {
            borderRadius: "8px",
            bgcolor: (t) => alpha(t.palette.background.default, 0.6),
          },
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
