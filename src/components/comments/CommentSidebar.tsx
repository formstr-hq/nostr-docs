import { Box, Typography, Divider, IconButton, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useComments } from "../../contexts/CommentContext";
import { CommentCard } from "./CommentCard";

type Props = {
  onClose: () => void;
};

export function CommentSidebar({ onClose }: Props) {
  const { comments } = useComments();

  return (
    <Box
      sx={{
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
          Comments {comments.length > 0 && `(${comments.length})`}
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
          gap: 1,
          p: 1.5,
        }}
      >
        {comments.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", mt: 4, fontStyle: "italic" }}
          >
            No comments yet.
          </Typography>
        ) : (
          comments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))
        )}
      </Box>
    </Box>
  );
}
