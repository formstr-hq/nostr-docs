export type TextSuggestModelId = `custom:${string}`;

export interface TextSuggestModelEntry {
  /** Stable id, used as the wllama CacheManager key (derived from the URL). */
  id: TextSuggestModelId;
  /** Display label in settings. */
  label: string;
  /** Direct URL to a .gguf file (HF "resolve/main" links work great). */
  url: string;
  /** Best-effort size hint for the UI; not load-bearing. */
  sizeBytes?: number;
}

export interface TextSuggestPrefs {
  enabled: boolean;
  /** All models the user has configured. Empty until they add one. */
  models: TextSuggestModelEntry[];
  /** Which configured model is active. Null = none configured yet. */
  activeModelId: TextSuggestModelId | null;
  /** Debounce delay (ms) after the last keystroke before requesting a suggestion. */
  debounceMs: number;
  /** Max new tokens to generate per suggestion — keep small, this runs on every pause. */
  maxTokens: number;
  temperature: number;
  /** First-time setup acknowledged (skips the "set up" nag if no model is configured yet but user dismissed it). */
  setupDismissed: boolean;
}

/** Pause after typing before asking the model — avoids stacking GPU jobs. */
export const DEFAULT_DEBOUNCE_MS = 700;
/** Default suggestion budget; users can raise this in settings. */
export const DEFAULT_MAX_TOKENS = 48;
export const DEFAULT_TEMPERATURE = 0.35;

export const DEFAULT_PREFS: TextSuggestPrefs = {
  enabled: false,
  models: [],
  activeModelId: null,
  debounceMs: DEFAULT_DEBOUNCE_MS,
  maxTokens: DEFAULT_MAX_TOKENS,
  temperature: DEFAULT_TEMPERATURE,
  setupDismissed: false,
};

export type TextSuggestState =
  | { kind: "disabled" }
  | { kind: "needs-setup" }
  | { kind: "downloading"; bytes: number; total: number }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "thinking" }
  | { kind: "error"; message: string };

export interface SuggestRequest {
  /** Plain-text document content before the cursor (truncated to a context window). */
  prefix: string;
}

export interface SuggestResult {
  text: string;
  msElapsed: number;
}

export interface ProofreadRequest {
  /** The complete Markdown document. It is never silently truncated. */
  document: string;
  /** The user's requested revision, such as spelling-only correction. */
  instruction: string;
}

export interface ProofreadResult {
  /** The complete revised Markdown document. */
  text: string;
  msElapsed: number;
}

/**
 * A full rewrite needs room for both the source and an equally long response.
 * This is an initial UI guard; generation also checks the loaded 4k/8k context
 * using a conservative byte budget and never truncates the document.
 */
export const MAX_PROOFREAD_DOCUMENT_CHARS = 3_000;
export const MAX_PROOFREAD_INSTRUCTION_CHARS = 500;
