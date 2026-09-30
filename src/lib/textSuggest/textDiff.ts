import diffSequence from "diff-sequences";

export type TextDiffPart = {
  type: "equal" | "delete" | "insert";
  text: string;
};

export type TextDiffSegment =
  | { type: "equal"; text: string }
  | {
      type: "change";
      id: string;
      before: string;
      after: string;
    };

type ChangeSegment = Extract<TextDiffSegment, { type: "change" }>;

function tokenize(text: string): string[] {
  return (
    text.match(
      /\s+|[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|[^\s]/gu,
    ) ?? []
  );
}

function append(parts: TextDiffPart[], type: TextDiffPart["type"], text: string) {
  if (!text) return;
  const previous = parts.at(-1);
  if (previous?.type === type) {
    previous.text += text;
  } else {
    parts.push({ type, text });
  }
}

export function diffText(before: string, after: string): TextDiffPart[] {
  if (before === after) return before ? [{ type: "equal", text: before }] : [];

  const a = tokenize(before);
  const b = tokenize(after);
  const parts: TextDiffPart[] = [];
  let aIndex = 0;
  let bIndex = 0;

  diffSequence(
    a.length,
    b.length,
    (left, right) => a[left] === b[right],
    (commonLength, commonA, commonB) => {
      append(parts, "delete", a.slice(aIndex, commonA).join(""));
      append(parts, "insert", b.slice(bIndex, commonB).join(""));
      append(parts, "equal", a.slice(commonA, commonA + commonLength).join(""));
      aIndex = commonA + commonLength;
      bIndex = commonB + commonLength;
    },
  );

  append(parts, "delete", a.slice(aIndex).join(""));
  append(parts, "insert", b.slice(bIndex).join(""));
  return parts;
}

/** Group adjacent delete/insert parts into independently reviewable changes. */
function isPureInsertion(change: ChangeSegment): boolean {
  return change.before === "" && change.after !== "";
}

function isPureDeletion(change: ChangeSegment): boolean {
  return change.after === "" && change.before !== "";
}

function looksLikePairedWrapper(left: string, right: string): boolean {
  return (
    (/\*\*$/.test(left) && /^\*\*/.test(right)) ||
    (/__$/.test(left) && /^__/.test(right)) ||
    (/\*$/.test(left) && /^\*/.test(right)) ||
    (/_$/.test(left) && /^_/.test(right)) ||
    (/`+$/.test(left) && /^`+/.test(right)) ||
    (/\[$/.test(left) && /^\](?:\([^\n]*\)|\[[^\n]*\])/.test(right))
  );
}

function mergeCohesiveChanges(
  segments: readonly TextDiffSegment[],
): TextDiffSegment[] {
  const merged: TextDiffSegment[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const left = segments[index];
    const equal = segments[index + 1];
    const right = segments[index + 2];

    if (
      left?.type === "change" &&
      equal?.type === "equal" &&
      right?.type === "change"
    ) {
      const pairedInsertions = isPureInsertion(left) && isPureInsertion(right);
      const pairedDeletions = isPureDeletion(left) && isPureDeletion(right);
      const compactCenter =
        equal.text.length <= 80 && !/\s/.test(equal.text);
      const wrapperPair = pairedInsertions
        ? looksLikePairedWrapper(left.after, right.after)
        : pairedDeletions
          ? looksLikePairedWrapper(left.before, right.before)
          : false;

      if ((pairedInsertions || pairedDeletions) && (compactCenter || wrapperPair)) {
        merged.push({
          type: "change",
          id: "",
          before: pairedInsertions
            ? equal.text
            : left.before + equal.text + right.before,
          after: pairedInsertions
            ? left.after + equal.text + right.after
            : equal.text,
        });
        index += 2;
        continue;
      }
    }

    merged.push(left);
  }

  let changeIndex = 0;
  return merged.map((segment) => {
    if (segment.type === "equal") return segment;
    const identified = { ...segment, id: `change-${changeIndex}` };
    changeIndex += 1;
    return identified;
  });
}

export function createTextDiffSegments(
  before: string,
  after: string,
): TextDiffSegment[] {
  const segments: TextDiffSegment[] = [];
  let changeIndex = 0;

  for (const part of diffText(before, after)) {
    if (part.type === "equal") {
      segments.push({ type: "equal", text: part.text });
      continue;
    }

    let change = segments.at(-1);
    if (change?.type !== "change") {
      change = {
        type: "change",
        id: `change-${changeIndex}`,
        before: "",
        after: "",
      };
      changeIndex += 1;
      segments.push(change);
    }

    if (part.type === "delete") change.before += part.text;
    else change.after += part.text;
  }

  return mergeCohesiveChanges(segments);
}

/** Rebuild the exact Markdown using original text for rejected changes. */
export function resolveTextDiff(
  segments: readonly TextDiffSegment[],
  rejectedChangeIds: ReadonlySet<string>,
): string {
  const knownChangeIds = new Set(
    segments.flatMap((segment) =>
      segment.type === "change" ? [segment.id] : [],
    ),
  );
  for (const id of rejectedChangeIds) {
    if (!knownChangeIds.has(id)) {
      throw new Error(`Unknown proofreading change: ${id}`);
    }
  }

  return segments
    .map((segment) => {
      if (segment.type === "equal") return segment.text;
      return rejectedChangeIds.has(segment.id)
        ? segment.before
        : segment.after;
    })
    .join("");
}

const PROTECTED_EMBED_RE =
  /<(encrypted-file|nostr-form)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Prevent a mixed selection from losing or duplicating protected embeds. */
export function hasSameProtectedEmbeds(before: string, after: string): boolean {
  const collect = (text: string) => text.match(PROTECTED_EMBED_RE) ?? [];
  const beforeEmbeds = collect(before);
  const afterEmbeds = collect(after);
  if (beforeEmbeds.length !== afterEmbeds.length) return false;

  const remaining = new Map<string, number>();
  for (const embed of beforeEmbeds) {
    remaining.set(embed, (remaining.get(embed) ?? 0) + 1);
  }
  for (const embed of afterEmbeds) {
    const count = remaining.get(embed) ?? 0;
    if (count === 0) return false;
    if (count === 1) remaining.delete(embed);
    else remaining.set(embed, count - 1);
  }
  return remaining.size === 0;
}
