import type { Node as PMNode } from "@tiptap/pm/model";
import { findAllOccurrences, findBestOccurrence } from "./textMatching";

function textOffsetToPos(doc: PMNode, offset: number): number {
  let accumulated = 0;
  let result = -1;

  doc.descendants((node, pos) => {
    if (result !== -1) return false;

    if (node.isText) {
      const len = node.nodeSize;
      if (accumulated + len > offset) {
        result = pos + (offset - accumulated);
        return false;
      }
      accumulated += len;
    }

    return true;
  });

  return result === -1 ? doc.content.size : result;
}

export function locateComment(
  doc: PMNode,
  quote: string,
  context?: { prefix: string; suffix: string },
): { from: number; to: number } | null {
  const fullText = doc.textContent;
  const occurrences = findAllOccurrences(fullText, quote);

  if (occurrences.length === 0) return null;

  const bestOffset = findBestOccurrence(fullText, occurrences, quote.length, context);

  const from = textOffsetToPos(doc, bestOffset);
  const to = textOffsetToPos(doc, bestOffset + quote.length);

  return from >= 0 && to >= 0 ? { from, to } : null;
}
