import { Box, Typography } from "@mui/material";
import type { DecryptedComment } from "../../contexts/CommentContext";

type Props = {
  comment: DecryptedComment;
};

export function CommentCard({ comment }: Props) {
  const shortPubkey = `${comment.pubkey.slice(0, 8)}…${comment.pubkey.slice(-4)}`;
  const timestamp = new Date(comment.createdAt * 1000).toLocaleString();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        p: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, fontFamily: "monospace", color: "text.primary" }}
        >
          {shortPubkey}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {timestamp}
        </Typography>
      </Box>

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
