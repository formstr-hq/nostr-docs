import { useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Divider, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Link, useParams } from "react-router-dom";
import MarkdownIt from "markdown-it";
import { CommentProvider, useComments } from "../../contexts/CommentContext";
import { useDocumentContext } from "../../contexts/DocumentContext";
import { useUser } from "../../contexts/UserContext";
import { getLatestVersion } from "../../utils/helpers";
import { buildCommentThreads, getCommentAncestors, getDiscussionRows } from "../../utils/commentThreads";
import { CommentCard } from "./CommentCard";
import { discussionPath } from "./discussionPath";

const markdown = new MarkdownIt({ html: false });
const PAGE_SIZE = 100;

export function DiscussionPage({ viewKey, editKey }: { viewKey?: string; editKey?: string }) {
  const { documents, selectedDocumentId } = useDocumentContext();
  const { user } = useUser();
  const { naddr, commentId = "" } = useParams();
  const history = selectedDocumentId ? documents.get(selectedDocumentId) : undefined;
  const content = history ? getLatestVersion(history)?.decryptedContent ?? "" : "";
  const plainText = useMemo(() => {
    const rendered = new DOMParser().parseFromString(markdown.render(content), "text/html");
    return rendered.body.textContent ?? "";
  }, [content]);

  if (!viewKey || !selectedDocumentId) {
    return (
      <Box sx={{ p: 3 }}>
        <Button component={Link} to={`/doc/${naddr}`} startIcon={<ArrowBackIcon />}>Back to page</Button>
        <Alert severity="info" sx={{ mt: 2 }}>Open this discussion with the shared page link to access its comments.</Alert>
      </Box>
    );
  }

  return (
    <CommentProvider viewKey={viewKey} editKey={editKey} docAddress={selectedDocumentId} myPubkey={user?.pubkey} currentDocText={plainText}>
      <Discussion key={commentId} commentId={commentId} />
    </CommentProvider>
  );
}

function Discussion({ commentId }: { commentId: string }) {
  const { documentPath, comments, replyToComment, resolvedIds, resolveComment, unresolveComment, canResolve, isOutdated } = useComments();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const ancestors = useMemo(() => getCommentAncestors(threads, commentId), [threads, commentId]);
  const rows = useMemo(() => getDiscussionRows(threads, commentId, visibleCount + 1), [threads, commentId, visibleCount]);
  const selected = threads.byId.get(commentId);
  const root = ancestors[0] ?? selected;
  const parent = ancestors.at(-1);
  const resolved = !!root && resolvedIds.has(root.id);
  const outdated = !!root && isOutdated(root);
  const missingParent = !!root?.parentId && !threads.byId.has(root.parentId);

  const toggleResolution = async () => {
    if (!root) return;
    setError(null);
    try {
      if (resolved) await unresolveComment(root.id);
      else await resolveComment(root.id);
    } catch {
      setError("Failed to update this discussion. Please try again.");
    }
  };

  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      <Box sx={{ maxWidth: 900, mx: "auto", p: { xs: 2, md: 4 } }}>
        <Button component={Link} to={documentPath} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>Back to page</Button>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, mb: 1 }}>
          <Typography variant="h5" component="h1">Discussion</Typography>
          {resolved && <Chip label="Resolved" size="small" color="success" />}
          {outdated && <Chip label="Outdated" size="small" color="warning" />}
          {root && !missingParent && canResolve(root) && (
            <Button size="small" onClick={() => void toggleResolution()} sx={{ ml: "auto" }}>
              {resolved ? "Reopen discussion" : "Resolve discussion"}
            </Button>
          )}
        </Box>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>Follow the conversation and reply to any comment.</Typography>
        {parent && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
            <Button component={Link} to={discussionPath(documentPath, parent.id)} size="small">Parent comment</Button>
            {root && root.id !== parent.id && (
              <Button component={Link} to={discussionPath(documentPath, root.id)} size="small">Show full thread</Button>
            )}
          </Box>
        )}
        <Divider sx={{ mb: 2 }} />
        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
        {missingParent && <Alert severity="info" sx={{ mb: 2 }}>An earlier comment in this discussion has not loaded yet.</Alert>}
        {!selected && (
          <Alert severity="info">This comment has not loaded. Check your connection and that you have the correct shared page link.</Alert>
        )}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.slice(0, visibleCount).map(({ comment, depth }) => {
            const replyParent = comment.parentId ? threads.byId.get(comment.parentId) : undefined;
            return (
              <Box key={comment.id} sx={{ ml: { xs: Math.min(depth, 3), md: Math.min(depth, 3) * 2 }, minWidth: 0 }}>
                {replyParent && depth > 0 && (
                  <Button component={Link} to={discussionPath(documentPath, replyParent.id)} size="small" sx={{ textTransform: "none", mb: 0.5 }}>
                    Reply to {replyParent.pubkey.slice(0, 8)}… · View parent
                  </Button>
                )}
                <CommentCard
                  comment={comment}
                  isResolved={resolved}
                  isOutdated={depth === 0 && outdated}
                  onReply={!resolved && !missingParent ? (body) => replyToComment(comment, body) : undefined}
                />
              </Box>
            );
          })}
        </Box>
        {rows.length > visibleCount && (
          <Button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} sx={{ mt: 2 }}>Load more replies</Button>
        )}
      </Box>
    </Box>
  );
}
