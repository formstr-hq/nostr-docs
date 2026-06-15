export interface MatchRange {
  /** Start offset in the original corpus (inclusive). */
  start: number;
  /** End offset in the original corpus (exclusive). */
  end: number;
}

// Collapse a string to its non-whitespace characters, remembering the original
// index of each kept character. This lets us match a quote against a corpus
// while ignoring differences in whitespace — paragraph breaks in particular
// are rendered inconsistently depending on where the quote/corpus came from
// (TipTap `textBetween` uses no block separator, `Selection.toString()` uses
// "\n", a markdown source uses "\n\n", a joined DOM TreeWalker uses nothing).
function compact(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) continue;
    text += s[i];
    map.push(i);
  }
  return { text, map };
}

function compactStrip(s: string): string {
  return s.replace(/\s+/g, "");
}

function scoreContext(
  corpus: string,
  matchStart: number,
  matchEnd: number,
  prefix: string,
  suffix: string,
): number {
  let score = 0;

  const compactPrefix = compactStrip(prefix);
  const compactSuffix = compactStrip(suffix);
  const before = compactStrip(corpus.slice(0, matchStart));
  const after = compactStrip(corpus.slice(matchEnd));

  for (let i = 0; i < compactPrefix.length && i < before.length; i++) {
    if (before[before.length - 1 - i] === compactPrefix[compactPrefix.length - 1 - i]) {
      score++;
    }
  }

  for (let i = 0; i < compactSuffix.length && i < after.length; i++) {
    if (after[i] === compactSuffix[i]) {
      score++;
    }
  }

  return score;
}

export function findBestOccurrence(
  corpus: string,
  occurrences: MatchRange[],
  context?: { prefix: string; suffix: string },
): MatchRange {
  if (occurrences.length === 1 || !context) return occurrences[0];
  let best = occurrences[0];
  let bestScore = -1;
  for (const occ of occurrences) {
    const score = scoreContext(corpus, occ.start, occ.end, context.prefix, context.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = occ;
    }
  }
  return best;
}

/**
 * Finds every occurrence of `query` inside `corpus`, ignoring differences in
 * whitespace between the two. Each returned range is in original `corpus`
 * coordinates and spans from the first matched non-whitespace character to just
 * past the last — so any whitespace interior to the match (e.g. a paragraph
 * break the quote crossed) is included, but leading/trailing whitespace is not.
 */
export function findAllOccurrences(corpus: string, query: string): MatchRange[] {
  const c = compact(corpus);
  const q = compact(query);
  const result: MatchRange[] = [];
  if (q.text.length === 0) return result;

  let searchFrom = 0;
  while (true) {
    const idx = c.text.indexOf(q.text, searchFrom);
    if (idx === -1) break;
    result.push({
      start: c.map[idx],
      end: c.map[idx + q.text.length - 1] + 1,
    });
    searchFrom = idx + 1;
  }
  return result;
}
