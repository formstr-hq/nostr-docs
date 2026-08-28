import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

import { diffText } from "../textDiff";

const markdown = new MarkdownIt({
  html: true,
  linkify: false,
  breaks: false,
});

const FORMATTING_ACTION_RE =
  /\b(?:convert|format|render|rewrite|transform|turn)\b[\s\S]{0,48}\b(?:as|into|to|using|with)\b[\s\S]{0,32}\b(?:blockquotes?|bold|bullets?|code blocks?|emphasis|headings?|html|italics?|links?|lists?|markdown|numbered lists?|strikethrough|tables?)\b|\b(?:add|apply|create|insert|use)\b[\s\S]{0,48}\b(?:backticks?|blockquotes?|bold|bullets?|code blocks?|code fences?|emphasis|headings?|html|italics?|links?|lists?|markdown|numbered lists?|strikethrough|tables?)\b|\bmake\b[\s\S]{0,48}\b(?:bold|italic|a heading|a list|a table|strikethrough)\b|\b(?:enclose|place|put|wrap)\b[\s\S]{0,48}\b(?:as|in|inside|with)\b[\s\S]{0,32}\b(?:backticks?|code blocks?|code fences?|markdown)\b|\b(?:alter|change|edit|fix|replace|update)\b[\s\S]{0,48}\b(?:html attributes?|hrefs?|link targets?|markdown formatting|urls?)\b|\b(?:bold|bullet|italicize|strikethrough)\b/iu;
const NEGATED_ACTION_RE =
  /\b(?:avoid|do not|don't|dont|never|no)\b[\s\S]{0,36}\b(?:add|alter|apply|change|convert|create|enclose|format|insert|make|place|put|render|rewrite|show|transform|turn|use|wrap)\b/iu;
const PRESERVE_FORMATTING_RE =
  /\b(?:keep|leave|preserve|retain)\b[\s\S]{0,48}\b(?:backticks?|code fences?|formatting|html|markdown|structure)\b|\bwithout\b[\s\S]{0,48}\b(?:altering|changing|converting|formatting|reformatting|using)\b[\s\S]{0,48}\b(?:backticks?|code fences?|formatting|html|markdown|structure)\b/iu;

const OUTER_MARKDOWN_FENCE_RE =
  /^(?<fence>`{3,}|~{3,})[ \t]*(?:markdown|md)?[ \t]*\n(?<document>[\s\S]*?)\n\k<fence>[ \t]*(?:\n)?$/iu;
const OUTER_FENCE_REQUEST_RE =
  /\b(?:enclose|place|put|return|show|wrap)\b[\s\S]{0,60}\b(?:document|output|text)\b[\s\S]{0,60}\b(?:code block|code fence|fenced block|triple backticks?)\b|\b(?:code block|code fence|fenced block|triple backticks?)\b[\s\S]{0,60}\b(?:document|output|text)\b/iu;

const EXACT_CONTENT_TOKEN_TYPES = new Set([
  "code_block",
  "code_inline",
  "fence",
  "html_block",
  "html_inline",
]);

const FORMATTING_ERROR =
  "The local model tried to change Markdown formatting or add backticks, so no changes were applied. Ask for formatting explicitly if you want it changed.";

function instructionClauses(instruction: string): string[] {
  return instruction
    .split(/(?:[.!?;,\n]+|\b(?:and|but|however|while)\b)/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** Formatting stays locked unless a clause clearly asks to change it. */
export function instructionAllowsMarkdownChanges(instruction: string): boolean {
  return instructionClauses(instruction).some(
    (clause) =>
      FORMATTING_ACTION_RE.test(clause) &&
      !NEGATED_ACTION_RE.test(clause) &&
      !PRESERVE_FORMATTING_RE.test(clause),
  );
}

function instructionRequestsOuterFence(instruction: string): boolean {
  return instructionClauses(instruction).some(
    (clause) =>
      OUTER_FENCE_REQUEST_RE.test(clause) &&
      !NEGATED_ACTION_RE.test(clause) &&
      !PRESERVE_FORMATTING_RE.test(clause),
  );
}

function tokenSignature(token: Token): string {
  const attrs = [...(token.attrs ?? [])].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify({
    type: token.type,
    tag: token.tag,
    nesting: token.nesting,
    markup: token.markup,
    info: token.info,
    attrs,
    hidden: token.hidden,
    content: EXACT_CONTENT_TOKEN_TYPES.has(token.type) ? token.content : "",
  });
}

function formattingSignature(document: string): string[] {
  const signature: string[] = [];
  const visit = (tokens: readonly Token[]) => {
    for (const token of tokens) {
      if (token.type === "text") {
        // Keep the text-node position without comparing its editable prose.
        signature.push("text");
      } else if (token.type !== "inline") {
        signature.push(tokenSignature(token));
      }
      if (token.children) visit(token.children);
    }
  };
  visit(markdown.parse(document, {}));
  return signature;
}

function hasChangedBackticks(before: string, after: string): boolean {
  return diffText(before, after).some(
    (part) => part.type !== "equal" && part.text.includes("`"),
  );
}

function hasSameFormattingStructure(before: string, after: string): boolean {
  const beforeSignature = formattingSignature(before);
  const afterSignature = formattingSignature(after);
  return (
    beforeSignature.length === afterSignature.length &&
    beforeSignature.every((part, index) => part === afterSignature[index])
  );
}

/** Throws rather than silently accepting a model-created Markdown structure. */
export function assertProofreadFormattingPreserved(
  before: string,
  after: string,
  instruction: string,
): void {
  if (instructionAllowsMarkdownChanges(instruction)) return;
  if (
    hasChangedBackticks(before, after) ||
    !hasSameFormattingStructure(before, after)
  ) {
    throw new Error(FORMATTING_ERROR);
  }
}

function unwrapAccidentalOuterFence(
  before: string,
  candidate: string,
  instruction: string,
): string {
  if (
    OUTER_MARKDOWN_FENCE_RE.test(before) ||
    instructionRequestsOuterFence(instruction)
  ) {
    return candidate;
  }

  const match = candidate.match(OUTER_MARKDOWN_FENCE_RE);
  return match?.groups?.document ?? candidate;
}

/** Normalize only an unrequested whole-response fence, then enforce the lock. */
export function normalizeAndValidateProofreadFormatting(
  before: string,
  candidate: string,
  instruction: string,
): string {
  const normalized = unwrapAccidentalOuterFence(before, candidate, instruction);
  assertProofreadFormattingPreserved(before, normalized, instruction);
  return normalized;
}
