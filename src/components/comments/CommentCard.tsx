import { Box, Chip, IconButton, Tooltip, Typography } from "@mui/material";
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
};

export function CommentCard({ comment, isResolved, isOutdated, onResolve, onUnresolve, onCardClick }: Props) {
  const shortPubkey = `${comment.pubkey.slice(0, 8)}…${comment.pubkey.slice(-4)}`;
  const timestamp = new Date(comment.createdAt * 1000).toLocaleString();

  return (
    <Box
      onClick={onCardClick}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        p: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
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
    </Box>
  );
}
