interface ThreadComment {
  id: string;
  parentId?: string;
  createdAt: number;
}

export interface CommentThreads<T extends ThreadComment> {
  byId: Map<string, T>;
  repliesByParent: Map<string, T[]>;
  roots: T[];
}

/** Missing parents stay visible until relay delivery fills in the thread. */
export function buildCommentThreads<T extends ThreadComment>(comments: T[]): CommentThreads<T> {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const repliesByParent = new Map<string, T[]>();
  const roots: T[] = [];
  const sorted = [...byId.values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  for (const comment of sorted) {
    if (!comment.parentId || !byId.has(comment.parentId) || comment.parentId === comment.id) {
      roots.push(comment);
      continue;
    }
    const siblings = repliesByParent.get(comment.parentId) ?? [];
    siblings.push(comment);
    repliesByParent.set(comment.parentId, siblings);
  }
  return { byId, repliesByParent, roots };
}

/** Root first; excludes the selected comment. Never recurse through relay data. */
export function getCommentAncestors<T extends ThreadComment>(threads: CommentThreads<T>, id: string): T[] {
  const ancestors: T[] = [];
  const seen = new Set([id]);
  let parentId = threads.byId.get(id)?.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = threads.byId.get(parentId);
    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  return ancestors.reverse();
}

/** Preorder rows keep arbitrarily deep threads out of the JS/React call stack. */
export function getDiscussionRows<T extends ThreadComment>(
  threads: CommentThreads<T>,
  id: string,
  limit = Infinity,
): { comment: T; depth: number }[] {
  const root = threads.byId.get(id);
  if (!root) return [];
  const rows: { comment: T; depth: number }[] = [];
  const pending = [{ comment: root, depth: 0 }];
  const seen = new Set<string>();
  while (pending.length && rows.length < limit) {
    const row = pending.pop()!;
    if (seen.has(row.comment.id)) continue;
    seen.add(row.comment.id);
    rows.push(row);
    const children = threads.repliesByParent.get(row.comment.id) ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      pending.push({ comment: children[i], depth: row.depth + 1 });
    }
  }
  return rows;
}
