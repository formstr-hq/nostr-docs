import type { DecryptedComment } from "../contexts/CommentContext";
import { findAllOccurrences, findBestOccurrence } from "./textMatching";

function removeHighlights(container: HTMLElement): void {
  container.querySelectorAll(".comment-highlight").forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  });
}

function collectText(container: HTMLElement): { nodes: Text[]; offsets: number[] } {
  const nodes: Text[] = [];
  const offsets: number[] = [];
  let accumulated = 0;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    nodes.push(node);
    offsets.push(accumulated);
    accumulated += node.length;
  }

  return { nodes, offsets };
}

/**
 * Wraps the text in [from, to) with one or more "comment-highlight" spans,
 * splitting text nodes as needed so the highlight can span element
 * boundaries (e.g. across bold/italic/link text). Returns true if any text
 * was wrapped.
 *
 * Must be called with `nodes`/`offsets` from a single `collectText` pass,
 * processing ranges in descending `from` order — splitting a node only
 * affects nodes at or after its own offset, so earlier ranges in the same
 * pass remain valid.
 */
function wrapRange(
  nodes: Text[],
  offsets: number[],
  from: number,
  to: number,
  commentId: string,
): boolean {
  let wrapped = false;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodeStart = offsets[i];
    const nodeEnd = nodeStart + node.length;
    if (nodeEnd <= from || nodeStart >= to) continue;

    const startInNode = Math.max(0, from - nodeStart);
    const endInNode = Math.min(node.length, to - nodeStart);
    if (startInNode >= endInNode) continue;

    let target = node;
    if (endInNode < target.length) target.splitText(endInNode);
    if (startInNode > 0) target = target.splitText(startInNode);

    const parent = target.parentNode;
    if (!parent) continue;

    const span = document.createElement("span");
    span.className = "comment-highlight";
    span.setAttribute("data-comment-id", commentId);
    span.style.backgroundColor = "var(--comment-highlight-color, rgba(255, 213, 0, 0.4))";
    span.style.borderRadius = "2px";
    span.style.cursor = "pointer";

    parent.insertBefore(span, target);
    span.appendChild(target);
    wrapped = true;
  }

  return wrapped;
}

export function applyDomHighlights(
  container: HTMLElement,
  comments: DecryptedComment[],
  resolvedIds: Set<string>,
  isOutdated: (comment: DecryptedComment) => boolean,
): void {
  removeHighlights(container);

  const { nodes, offsets } = collectText(container);
  const fullText = nodes.map((n) => n.data).join("");

  const ranges: { from: number; to: number; commentId: string }[] = [];

  for (const comment of comments) {
    if (!comment.quote || resolvedIds.has(comment.id) || isOutdated(comment)) continue;

    const occurrences = findAllOccurrences(fullText, comment.quote);
    if (occurrences.length === 0) continue;

    const bestOffset = findBestOccurrence(fullText, occurrences, comment.quote.length, comment.context);
    ranges.push({ from: bestOffset, to: bestOffset + comment.quote.length, commentId: comment.id });
  }

  // Process right-to-left: splitting a node only shifts boundaries at or
  // after its start, so earlier (lower-offset) ranges stay valid.
  ranges.sort((a, b) => b.from - a.from);

  for (const { from, to, commentId } of ranges) {
    wrapRange(nodes, offsets, from, to, commentId);
  }
}
