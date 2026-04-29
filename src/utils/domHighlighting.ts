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

function findTextRange(
  nodes: Text[],
  offsets: number[],
  from: number,
  to: number,
): { startNode: Text; startOffset: number; endNode: Text; endOffset: number } | null {
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (let i = 0; i < nodes.length; i++) {
    const nodeStart = offsets[i];
    const nodeEnd = nodeStart + nodes[i].length;

    if (!startNode && from < nodeEnd) {
      startNode = nodes[i];
      startOffset = from - nodeStart;
    }
    if (to <= nodeEnd) {
      endNode = nodes[i];
      endOffset = to - nodeStart;
      break;
    }
  }

  if (!startNode || !endNode) return null;
  if (startNode !== endNode) return null;

  return { startNode, startOffset, endNode, endOffset };
}

export function applyDomHighlights(
  container: HTMLElement,
  comments: DecryptedComment[],
  resolvedIds: Set<string>,
  isOutdated: (comment: DecryptedComment) => boolean,
): void {
  removeHighlights(container);

  for (const comment of comments) {
    if (!comment.quote || resolvedIds.has(comment.id) || isOutdated(comment)) continue;

    const { nodes, offsets } = collectText(container);
    const fullText = nodes.map((n) => n.data).join("");
    const occurrences = findAllOccurrences(fullText, comment.quote);

    if (occurrences.length === 0) continue;

    const bestOffset = findBestOccurrence(fullText, occurrences, comment.quote.length, comment.context);

    const textRange = findTextRange(nodes, offsets, bestOffset, bestOffset + comment.quote.length);
    if (!textRange) continue;

    try {
      const range = document.createRange();
      range.setStart(textRange.startNode, textRange.startOffset);
      range.setEnd(textRange.endNode, textRange.endOffset);

      const span = document.createElement("span");
      span.className = "comment-highlight";
      span.setAttribute("data-comment-id", comment.id);
      span.style.backgroundColor = "var(--comment-highlight-color, rgba(255, 213, 0, 0.4))";
      span.style.borderRadius = "2px";
      span.style.cursor = "pointer";

      range.surroundContents(span);
    } catch {
      continue;
    }
  }
}
