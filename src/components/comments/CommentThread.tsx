import { Box, Button } from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import { useComments, type DecryptedComment } from "../../contexts/CommentContext";
import type { CommentThreads } from "../../utils/commentThreads";
import { CommentCard } from "./CommentCard";
import { discussionPath } from "./discussionPath";

type Props = {
  comment: DecryptedComment;
  threads: CommentThreads<DecryptedComment>;
  isResolved: boolean;
  isOutdated: boolean;
  onReply?: (parent: DecryptedComment, content: string) => Promise<void>;
  onResolve?: () => void;
  onUnresolve?: () => void;
  onCardClick?: () => void;
  depth?: number;
};

const SIDEBAR_REPLY_LEVELS = 3;

export function CommentThread({ comment, threads, isResolved, isOutdated, onReply, depth = 0, ...actions }: Props) {
  const { documentPath } = useComments();
  const navigate = useNavigate();
  const threadPath = discussionPath(documentPath, comment.id);
  const replies = threads.repliesByParent.get(comment.id) ?? [];
  const atLimit = depth >= SIDEBAR_REPLY_LEVELS;

  return (
    <CommentCard
      comment={comment}
      isResolved={depth === 0 && isResolved}
      isOutdated={depth === 0 && isOutdated}
      {...actions}
      onReply={onReply ? async (content) => {
        await onReply(comment, content);
        if (atLimit) navigate(threadPath);
      } : undefined}
    >
      {replies.length > 0 && (atLimit ? (
        <Button component={Link} to={threadPath} onClick={(e) => e.stopPropagation()} size="small" sx={{ textTransform: "none", alignSelf: "flex-start" }}>
          Continue discussion
        </Button>
      ) : (
        <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex", flexDirection: "column", gap: 1, pl: 0.75, borderLeft: "2px solid", borderColor: "divider" }}>
          {replies.map((reply) => (
            <CommentThread
              key={reply.id}
              comment={reply}
              threads={threads}
              isResolved={isResolved}
              isOutdated={isOutdated}
              onReply={onReply}
              depth={depth + 1}
            />
          ))}
        </Box>
      ))}
    </CommentCard>
  );
}
