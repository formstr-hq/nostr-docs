import { Badge, IconButton, Tooltip } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { useComments } from "../../contexts/CommentContext";

type Props = {
  open: boolean;
  onToggle: () => void;
};

/**
 * Toolbar toggle for the comments sidebar, badged with the number of open
 * threads so it's visible at a glance that someone has commented.
 */
export function CommentsButton({ open, onToggle }: Props) {
  const { comments, resolvedIds, isOutdated } = useComments();
  const openThreads = comments.filter(
    (c) => !resolvedIds.has(c.id) && !isOutdated(c),
  ).length;

  return (
    <Tooltip title={open ? "Hide comments" : "Show comments"}>
      <IconButton
        size="small"
        onClick={onToggle}
        color={open ? "secondary" : "default"}
        sx={{ p: 0.6, ...(open ? {} : { color: "text.secondary" }) }}
      >
        <Badge
          badgeContent={openThreads}
          color="secondary"
          max={99}
          sx={{ "& .MuiBadge-badge": { fontSize: "0.65rem", height: 16, minWidth: 16, px: 0.5 } }}
        >
          <ChatBubbleOutlineIcon sx={{ fontSize: 19 }} />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
