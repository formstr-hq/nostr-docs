/** Keep capability keys in the fragment, including on native hash routers. */
export function discussionPath(documentPath: string, commentId: string): string {
  const hashStart = documentPath.indexOf("#");
  const path = hashStart < 0 ? documentPath : documentPath.slice(0, hashStart);
  const hash = hashStart < 0 ? "" : documentPath.slice(hashStart);
  return `${path}/discussion/${encodeURIComponent(commentId)}${hash}`;
}
