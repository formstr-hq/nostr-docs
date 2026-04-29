function scoreContext(
  fullText: string,
  matchStart: number,
  matchEnd: number,
  prefix: string,
  suffix: string,
): number {
  let score = 0;

  const beforeText = fullText.slice(Math.max(0, matchStart - prefix.length), matchStart);
  const afterText = fullText.slice(matchEnd, matchEnd + suffix.length);

  for (let i = 0; i < prefix.length && i < beforeText.length; i++) {
    if (beforeText[beforeText.length - 1 - i] === prefix[prefix.length - 1 - i]) {
      score++;
    }
  }

  for (let i = 0; i < suffix.length && i < afterText.length; i++) {
    if (afterText[i] === suffix[i]) {
      score++;
    }
  }

  return score;
}

export function findBestOccurrence(
  fullText: string,
  occurrences: number[],
  quoteLength: number,
  context?: { prefix: string; suffix: string },
): number {
  if (occurrences.length === 1 || !context) return occurrences[0];
  let bestOffset = occurrences[0];
  let bestScore = -1;
  for (const offset of occurrences) {
    const score = scoreContext(fullText, offset, offset + quoteLength, context.prefix, context.suffix);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

export function findAllOccurrences(text: string, query: string): number[] {
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(query, searchFrom);
    if (idx === -1) break;
    occurrences.push(idx);
    searchFrom = idx + 1;
  }
  return occurrences;
}
