import { useEffect, useRef, useState } from "react";
import { Box, Typography, Divider, IconButton, Tooltip, Snackbar, Alert } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useComments } from "../../contexts/CommentContext";
import { scrollToComment } from "../../utils/scrollToComment";
import { CommentCard } from "./CommentCard";

function SectionLabel({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const clickable = !!onToggle;
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        pt: 1.25,
        pb: 0.5,
        ...(clickable && { cursor: "pointer" }),
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "text.secondary",
          fontSize: "0.68rem",
        }}
      >
        {label} · {count}
      </Typography>
      {clickable && (
        <ExpandMoreIcon
          sx={{
            fontSize: 16,
            color: "text.secondary",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      )}
    </Box>
  );
}

type Props = {
  onClose: () => void;
  activeCommentId?: string | null;
  isMobile?: boolean;
};

export function CommentSidebar({ onClose, activeCommentId, isMobile }: Props) {
  const { comments, resolvedIds, resolveComment, unresolveComment, isOutdated, canResolve } = useComments();
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

  // A section is only open while it has content, so an emptied section
  // collapses on its own — no state syncing needed.
  const outdatedOpen = showOutdated && outdated.length > 0;
  const resolvedOpen = showResolved && resolved.length > 0;

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
          Comments
        </Typography>
        <Tooltip title="Close comments">
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Divider />

      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          px: 1.5,
          pb: 1.5,
        }}
      >
        {active.length === 0 && !outdatedOpen && !resolvedOpen ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", mt: 4, fontStyle: "italic" }}
          >
            No comments yet.
          </Typography>
        ) : (
          <>
            {active.length > 0 && <SectionLabel label="Active" count={active.length} />}
            {active.map((comment) => (
              <Box
                key={comment.id}
                ref={(el: HTMLDivElement | null) => {
                  if (el) cardRefs.current.set(comment.id, el);
                  else cardRefs.current.delete(comment.id);
                }}
              >
                <CommentCard
                  comment={comment}
                  isResolved={false}
                  isOutdated={false}
                  onResolve={canResolve(comment) ? () => handleResolve(comment.id) : undefined}
                  onCardClick={comment.quote ? () => scrollToComment(comment.id) : undefined}
                />
              </Box>
            ))}
            {outdated.length > 0 && (
              <SectionLabel
                label="Outdated"
                count={outdated.length}
                open={outdatedOpen}
                onToggle={() => setShowOutdated(!outdatedOpen)}
              />
            )}
            {outdatedOpen &&
              outdated.map((comment) => (
                <Box
                  key={comment.id}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) cardRefs.current.set(comment.id, el);
                    else cardRefs.current.delete(comment.id);
                  }}
                >
                  <CommentCard
                    comment={comment}
                    isResolved={false}
                    isOutdated={true}
                    onResolve={canResolve(comment) ? () => handleResolve(comment.id) : undefined}
                  />
                </Box>
              ))}
            {resolved.length > 0 && (
              <SectionLabel
                label="Resolved"
                count={resolved.length}
                open={resolvedOpen}
                onToggle={() => setShowResolved(!resolvedOpen)}
              />
            )}
            {resolvedOpen &&
              resolved.map((comment) => (
                <Box
                  key={comment.id}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) cardRefs.current.set(comment.id, el);
                    else cardRefs.current.delete(comment.id);
                  }}
                >
                  <CommentCard
                    comment={comment}
                    isResolved={true}
                    isOutdated={isOutdated(comment)}
                    onUnresolve={canResolve(comment) ? () => handleUnresolve(comment.id) : undefined}
                    onCardClick={comment.quote ? () => scrollToComment(comment.id) : undefined}
                  />
                </Box>
              ))}
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
