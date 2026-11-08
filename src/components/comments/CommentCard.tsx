import { useState } from "react";
import { Box, Button, Chip, IconButton, TextField, Tooltip, Typography, alpha } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import type { DecryptedComment } from "../../contexts/CommentContext";

type Props = {
  comment: DecryptedComment;
  isResolved: boolean;
  isOutdated: boolean;
  onResolve?: () => void;
  onUnresolve?: () => void;
  onCardClick?: () => void;
  /** Replies to this comment, oldest first. */
  replies?: DecryptedComment[];
  /** Post a reply. Omit to hide the reply action (e.g. on resolved threads). */
  onReply?: (content: string) => Promise<void>;
};

function shortKey(pubkey: string) {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

function formatTime(createdAt: number) {
  return new Date(createdAt * 1000).toLocaleString();
}

function ReplyBox({ onReply }: { onReply: (content: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const submit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    setError(false);
    try {
      await onReply(body.trim());
      setBody("");
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        sx={{ alignSelf: "flex-start", textTransform: "none", minWidth: 0, px: 0.5, fontSize: "0.75rem" }}
      >
        Reply
      </Button>
    );
  }

  return (
    // Keep clicks inside the reply box from reaching the card, which scrolls
    // to the highlight on click.
    <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <TextField
        autoFocus
        multiline
        minRows={2}
        size="small"
        placeholder="Write a reply…"
        value={body}
        disabled={submitting}
        error={error}
        helperText={error ? "Failed to post reply. Please try again." : undefined}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5 }}>
        <Button size="small" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </Button>
        <Button size="small" variant="contained" onClick={submit} disabled={submitting || !body.trim()}>
          {submitting ? "Posting…" : "Reply"}
        </Button>
      </Box>
    </Box>
  );
}

export function CommentCard({ comment, isResolved, isOutdated, onResolve, onUnresolve, onCardClick, replies = [], onReply }: Props) {
  const shortPubkey = shortKey(comment.pubkey);
  const timestamp = formatTime(comment.createdAt);

  return (
    <Box
      onClick={onCardClick}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 1.5,
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.06)",
        bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
        transition: "background-color 0.2s ease",
        "&:hover": {
          bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
        },
        ...(onCardClick && { cursor: "pointer" }),
        ...(isResolved || isOutdated) && { opacity: isResolved ? 0.6 : isOutdated ? 0.5 : 1 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, fontFamily: "monospace", color: "text.primary" }}
        >
          {shortPubkey}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: "auto" }}>
          {timestamp}
        </Typography>
        {(onResolve || onUnresolve || isResolved) && (
          <Box sx={{ alignSelf: "center" }}>
            {isResolved ? (
              onUnresolve ? (
                <Tooltip title="Mark as unresolved">
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); onUnresolve!(); }} sx={{ p: 0 }}>
                    <CheckCircleIcon fontSize="small" color="success" />
                  </IconButton>
                </Tooltip>
              ) : (
                <CheckCircleIcon fontSize="small" color="success" />
              )
            ) : onResolve ? (
              <Tooltip title="Resolve comment">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); onResolve!(); }} sx={{ p: 0 }}>
                  <CheckCircleOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        )}
      </Box>
      {isOutdated && (
        <Tooltip title="The text this comment refers to no longer exists in the document, so it can't be located.">
          <Chip label="Outdated" size="small" variant="outlined" color="warning" sx={{ height: 18, fontSize: "0.65rem", alignSelf: "flex-end" }} />
        </Tooltip>
      )}

      {comment.quote && (
        <Box
          sx={{
            borderLeft: "3px solid",
            borderColor: "secondary.main",
            pl: 1,
            py: 0.25,
            bgcolor: "action.hover",
            borderRadius: "0 4px 4px 0",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              fontStyle: "italic",
              color: "text.secondary",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {comment.quote}
          </Typography>
        </Box>
      )}

      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {comment.content}
      </Typography>

      {replies.length > 0 && (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            pl: 1.25,
            borderLeft: "2px solid",
            borderColor: "divider",
          }}
        >
          {replies.map((reply) => (
            <Box key={reply.id} sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, fontFamily: "monospace", color: "text.primary" }}
                >
                  {shortKey(reply.pubkey)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  {formatTime(reply.createdAt)}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {reply.content}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {onReply && <ReplyBox onReply={onReply} />}
    </Box>
  );
}
