import type { Node as PMNode } from "@tiptap/pm/model";
import { findAllOccurrences, findBestOccurrence } from "./textMatching";

function textOffsetToPos(doc: PMNode, offset: number): number {
  let accumulated = 0;
  let result = -1;
  let lastTextEnd = 0;

  doc.descendants((node, pos) => {
    if (result !== -1) return false;

    if (node.isText) {
      const len = node.nodeSize;
      if (accumulated + len > offset) {
        result = pos + (offset - accumulated);
        return false;
      }
      accumulated += len;
      lastTextEnd = pos + len;
    }

    return true;
  });

  // offset === total text length: point just past the last text node, not
  // doc.content.size, so trailing non-text nodes (e.g. file/form embeds)
  // aren't included in the highlight range.
  return result === -1 ? lastTextEnd : result;
}

export function locateComment(
  doc: PMNode,
  quote: string,
  context?: { prefix: string; suffix: string },
): { from: number; to: number } | null {
  const fullText = doc.textContent;
  const occurrences = findAllOccurrences(fullText, quote);

  if (occurrences.length === 0) return null;

  const best = findBestOccurrence(fullText, occurrences, context);

  const from = textOffsetToPos(doc, best.start);
  const to = textOffsetToPos(doc, best.end);

  return from >= 0 && to >= 0 ? { from, to } : null;
}
