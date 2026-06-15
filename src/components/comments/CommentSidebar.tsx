import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography, Divider, IconButton, Tooltip, Snackbar, Alert } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useComments } from "../../contexts/CommentContext";
import { CommentCard } from "./CommentCard";

type Props = {
  onClose: () => void;
  activeCommentId?: string | null;
  isMobile?: boolean;
};

export function CommentSidebar({ onClose, activeCommentId, isMobile }: Props) {
  const { comments, resolvedIds, resolveComment, unresolveComment, isOutdated } = useComments();
  const [showResolved, setShowResolved] = useState(false);
  const [showOutdated, setShowOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleResolve = (commentId: string) => {
    resolveComment(commentId).catch(() => setError("Failed to resolve comment. Please try again."));
  };

  const handleUnresolve = (commentId: string) => {
    unresolveComment(commentId).catch(() => setError("Failed to unresolve comment. Please try again."));
  };

  useEffect(() => {
    if (!activeCommentId) return;
    const el = cardRefs.current.get(activeCommentId);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeCommentId]);

  const active = comments.filter((c) => !resolvedIds.has(c.id) && !isOutdated(c));
  const outdated = comments.filter((c) => !resolvedIds.has(c.id) && isOutdated(c));
  const resolved = comments.filter((c) => resolvedIds.has(c.id));

  useEffect(() => {
    if (resolved.length === 0) setShowResolved(false);
  }, [resolved.length]);

  useEffect(() => {
    if (outdated.length === 0) setShowOutdated(false);
  }, [outdated.length]);

  return (
    <Box
      sx={isMobile ? {
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: "50vh",
        borderRadius: "16px 16px 0 0",
        zIndex: 1300,
        bgcolor: "background.paper",
        boxShadow: 3,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      } : {
        width: 300,
        flexShrink: 0,
        borderLeft: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 1,
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Comments {active.length > 0 && `(${active.length})`}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Button
            size="small"
            disabled={!showOutdated && outdated.length === 0}
            onClick={() => setShowOutdated((v) => !v)}
            sx={{ textTransform: "none", minWidth: 0, px: 0.5, fontSize: "0.75rem" }}
          >
            {showOutdated
              ? "Hide outdated"
              : outdated.length > 0
                ? `Show outdated (${outdated.length})`
                : "Show outdated"}
          </Button>
          <Button
            size="small"
            disabled={!showResolved && resolved.length === 0}
            onClick={() => setShowResolved((v) => !v)}
            sx={{ textTransform: "none", minWidth: 0, px: 0.5, fontSize: "0.75rem" }}
          >
            {showResolved
              ? "Hide resolved"
              : resolved.length > 0
                ? `Show resolved (${resolved.length})`
                : "Show resolved"}
          </Button>
          <Tooltip title="Close comments">
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Divider />

      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 1,
          p: 1.5,
        }}
      >
        {active.length === 0 && !showOutdated && !showResolved ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", mt: 4, fontStyle: "italic" }}
          >
            No comments yet.
          </Typography>
        ) : (
          <>
            {active.map((comment) => (
              <Box
                key={comment.id}
                ref={(el: HTMLDivElement | null) => {
                  if (el) cardRefs.current.set(comment.id, el);
                  else cardRefs.current.delete(comment.id);
                }}
                sx={{ borderRadius: 2 }}
              >
                <CommentCard
                  comment={comment}
                  isResolved={false}
                  isOutdated={false}
                  onResolve={() => handleResolve(comment.id)}
                  onCardClick={comment.quote ? () => {
                    document.querySelector(`[data-comment-id="${comment.id}"]`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  } : undefined}
                />
              </Box>
            ))}
            {showOutdated && outdated.length > 0 && (
              <>
                <Divider />
                {outdated.map((comment) => (
                  <Box
                    key={comment.id}
                    ref={(el: HTMLDivElement | null) => {
                      if (el) cardRefs.current.set(comment.id, el);
                      else cardRefs.current.delete(comment.id);
                    }}
                    sx={{ borderRadius: 2 }}
                  >
                    <CommentCard
                      comment={comment}
                      isResolved={false}
                      isOutdated={true}
                      onResolve={() => handleResolve(comment.id)}
                    />
                  </Box>
                ))}
              </>
            )}
            {showResolved && resolved.length > 0 && (
              <>
                <Divider />
                {resolved.map((comment) => (
                  <Box
                    key={comment.id}
                    ref={(el: HTMLDivElement | null) => {
                      if (el) cardRefs.current.set(comment.id, el);
                      else cardRefs.current.delete(comment.id);
                    }}
                    sx={{ borderRadius: 2 }}
                  >
                    <CommentCard
                      comment={comment}
                      isResolved={true}
                      isOutdated={isOutdated(comment)}
                      onUnresolve={() => handleUnresolve(comment.id)}
                      onCardClick={comment.quote ? () => {
                        document.querySelector(`[data-comment-id="${comment.id}"]`)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                      } : undefined}
                    />
                  </Box>
                ))}
              </>
            )}
          </>
        )}
      </Box>

      <Snackbar
        open={!!error}
        autoHideDuration={4000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}
