import type { Wllama } from "@wllama/wllama/esm/index.js";
import type {
  ProofreadRequest,
  ProofreadResult,
  SuggestRequest,
  SuggestResult,
} from "../types";
import {
  MAX_PROOFREAD_DOCUMENT_CHARS as PROOFREAD_CHAR_LIMIT,
  MAX_PROOFREAD_INSTRUCTION_CHARS,
} from "../types";
import { buildProofreadMessages, buildSuggestionMessages } from "./prompts";
import { normalizeAndValidateProofreadFormatting } from "./markdownPreservation";
import {
  normalizeContinuation,
  normalizeProofreadDocument,
} from "./responseNormalization";

export interface SuggestOptions {
  maxTokens: number;
  temperature: number;
  abortSignal?: AbortSignal;
}

export async function generateSuggestion(
  llm: Wllama,
  req: SuggestRequest,
  options: SuggestOptions,
): Promise<SuggestResult> {
  const maxTokens = Math.max(4, Math.min(256, options.maxTokens));
  const startedAt = performance.now();
  const result = await llm.createChatCompletion({
    messages: buildSuggestionMessages(req.prefix, maxTokens),
    stream: false,
    max_tokens: maxTokens,
    temperature: Math.max(options.temperature, 0.35),
    top_k: 40,
    top_p: 0.92,
    min_p: 0.05,
    penalty_last_n: 64,
    penalty_repeat: 1.12,
    abortSignal: options.abortSignal,
  });
  const rawText = result.choices[0]?.message.content ?? "";
  console.debug("[textSuggest] generate", {
    maxTokens,
    rawText,
    timeMs: performance.now() - startedAt,
  });
  return {
    text: normalizeContinuation(rawText, req.prefix),
    msElapsed: performance.now() - startedAt,
  };
}

const PROTECTED_EMBED_RE =
  /<(encrypted-file|nostr-form)\b[^>]*>[\s\S]*?<\/\1>/gi;

function protectEmbeds(document: string): {
  document: string;
  restore: (candidate: string) => string;
} {
  const embeds: string[] = [];
  let marker = `FORMSTR_PROTECTED_EMBED_${crypto.randomUUID().replaceAll("-", "")}`;
  while (document.includes(marker)) marker += "_SAFE";
  const protectedDocument = document.replace(PROTECTED_EMBED_RE, (embed) => {
    const index = embeds.push(embed) - 1;
    return `${marker}_START_${index}_END`;
  });

  return {
    document: protectedDocument,
    restore(candidate: string) {
      let restored = candidate;
      const expected = embeds.map(
        (_, index) => `${marker}_START_${index}_END`,
      );
      if (
        expected.some((token) => candidate.split(token).length !== 2) ||
        candidate.includes(marker) &&
          expected.reduce((value, token) => value.replace(token, ""), candidate)
            .includes(marker)
      ) {
        throw new Error(
          "The model changed a protected file or form embed. No changes were applied.",
        );
      }
      embeds.forEach((embed, index) => {
        const placeholder = expected[index];
        restored = restored.replace(placeholder, embed);
      });
      return restored;
    },
  };
}

export async function generateProofread(
  llm: Wllama,
  req: ProofreadRequest,
  abortSignal?: AbortSignal,
): Promise<ProofreadResult> {
  if (req.document.length > PROOFREAD_CHAR_LIMIT) {
    throw new Error(
      `This document is too long for the local model context. Keep it under ${PROOFREAD_CHAR_LIMIT.toLocaleString()} characters for one proofreading pass.`,
    );
  }

  const instruction = req.instruction.trim();
  if (!instruction) throw new Error("Enter what you want the proofreader to do.");
  if (instruction.length > MAX_PROOFREAD_INSTRUCTION_CHARS) {
    throw new Error(
      `Keep the proofreading instruction under ${MAX_PROOFREAD_INSTRUCTION_CHARS} characters.`,
    );
  }

  const protectedInput = protectEmbeds(req.document);
  let boundary = `FORMSTR_BOUNDARY_${crypto.randomUUID().replaceAll("-", "")}`;
  while (
    protectedInput.document.includes(boundary) ||
    instruction.includes(boundary)
  ) {
    boundary += "_SAFE";
  }
  const messages = buildProofreadMessages(
    { document: protectedInput.document, instruction },
    boundary,
  );
  const byteLength = (value: string) => new TextEncoder().encode(value).length;
  const promptUpperBound = messages.reduce(
    (sum, message) => sum + byteLength(message.content),
    0,
  );
  const maxTokens = Math.max(
    256,
    Math.min(4096, Math.ceil(byteLength(protectedInput.document) * 1.05) + 64),
  );
  const contextSize = llm.getLoadedContextInfo().n_ctx;
  const contextMargin = 256;
  if (promptUpperBound + maxTokens + contextMargin > contextSize) {
    throw new Error(
      "This document and instruction are too long for the loaded model context. Shorten them and try again.",
    );
  }
  const startedAt = performance.now();
  const result = await llm.createChatCompletion({
    messages,
    stream: false,
    max_tokens: maxTokens,
    temperature: 0.1,
    top_k: 20,
    top_p: 0.9,
    penalty_repeat: 1,
    abortSignal,
  });
  if (result.choices[0]?.finish_reason === "length") {
    throw new Error(
      "The model ran out of context before finishing the document. No changes were applied.",
    );
  }
  const rawText = result.choices[0]?.message.content ?? "";
  const normalized = normalizeProofreadDocument(rawText);
  const restored = protectedInput.restore(normalized);
  const text = normalizeAndValidateProofreadFormatting(
    req.document,
    restored,
    instruction,
  );
  if (!text.trim() && req.document.trim()) {
    throw new Error("The model returned an empty document. No changes were applied.");
  }
  console.debug("[textSuggest] proofread", {
    inputChars: req.document.length,
    outputChars: text.length,
    maxTokens,
    timeMs: performance.now() - startedAt,
  });
  return { text, msElapsed: performance.now() - startedAt };
}
