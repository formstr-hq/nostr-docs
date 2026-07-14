import { Box, IconButton, Tooltip, Typography, useTheme } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import type { DecryptedComment } from "../../contexts/CommentContext";
import { hashHue } from "../../lib/hashHue";

type Props = {
  comment: DecryptedComment;
  isResolved: boolean;
  isOutdated: boolean;
  onResolve?: () => void;
  onUnresolve?: () => void;
  onCardClick?: () => void;
};

/** Coarse "2h ago" / "3d ago" formatting — falls back to a date once it's old. */
function formatRelativeTime(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function CommentCard({ comment, isResolved, isOutdated, onResolve, onUnresolve, onCardClick }: Props) {
  const theme = useTheme();
  const shortPubkey = `${comment.pubkey.slice(0, 8)}…${comment.pubkey.slice(-4)}`;
  const initial = comment.pubkey.slice(0, 1).toUpperCase();
  const hue = hashHue(comment.pubkey);
  const dark = theme.palette.mode === "dark";
  const avatarBg = `hsl(${hue}, ${dark ? 42 : 48}%, ${dark ? 38 : 62}%)`;
  const avatarFg = `hsl(${hue}, ${dark ? 60 : 55}%, ${dark ? 90 : 18}%)`;

  const dimmed = isResolved || isOutdated;

  return (
    <Box
      onClick={onCardClick}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        py: 1.25,
        borderBottom: "1px solid",
        borderColor: "divider",
        ...(onCardClick && { cursor: "pointer" }),
        ...(dimmed && { opacity: isResolved ? 0.6 : 0.55 }),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Box sx={{ position: "relative", flexShrink: 0 }}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              bgcolor: avatarBg,
              color: avatarFg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.7rem",
              fontWeight: 700,
            }}
          >
            {initial}
          </Box>
          {isOutdated && (
            <Tooltip title="The text this comment refers to no longer exists in the document, so it can't be located.">
              <Box
                sx={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  bgcolor: "warning.main",
                  border: "1.5px solid",
                  borderColor: "background.paper",
                }}
              />
            </Tooltip>
          )}
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" sx={{ display: "block", fontWeight: 600, color: "text.primary" }}>
            {shortPubkey}
          </Typography>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
            {formatRelativeTime(comment.createdAt)}
            {isOutdated && " · anchor moved"}
          </Typography>
        </Box>

        {(onResolve || onUnresolve || isResolved) && (
          <Box sx={{ flexShrink: 0 }}>
            {isResolved ? (
              onUnresolve ? (
                <Tooltip title="Mark as unresolved">
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); onUnresolve!(); }} sx={{ p: 0.25 }}>
                    <CheckCircleIcon fontSize="small" color="success" />
                  </IconButton>
                </Tooltip>
              ) : (
                <CheckCircleIcon fontSize="small" color="success" sx={{ display: "block", m: 0.25 }} />
              )
            ) : onResolve ? (
              <Tooltip title="Resolve comment">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); onResolve!(); }} sx={{ p: 0.25 }}>
                  <CheckCircleOutlineIcon fontSize="small" sx={{ color: "text.secondary" }} />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        )}
      </Box>

      {comment.quote && (
        <Box
          sx={{
            borderLeft: "2px solid",
            borderColor: "secondary.main",
            pl: 1,
            ml: "36px",
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

      <Typography variant="body2" sx={{ ml: "36px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {comment.content}
      </Typography>
    </Box>
  );
}
