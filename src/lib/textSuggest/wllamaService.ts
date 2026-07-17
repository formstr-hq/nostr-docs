// src/lib/textSuggest/wllamaService.ts
import { WllamaService } from "wllama-service";
import type {
  SuggestRequest,
  SuggestResult,
  TextSuggestModelEntry,
} from "./types";

export type LoadProgress = { bytes: number; total: number };

const llm = new WllamaService({
  wasmPath: `/wllama/wllama.wasm`,
  nCtx: 2048,
  // Prefer WebGPU. Concurrent completions crash WebGPU — see suggest() queue.
  nGpuLayers: 999,
});

class TextSuggestService {
  private loadedModelId: string | null = null;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Serial generation lock. wllama/WebGPU cannot safely run two completions
   * at once — overlapping requests show up as RuntimeError: unreachable in
   * ggml_backend_webgpu_*.
   */
  private generationTail: Promise<void> = Promise.resolve();
  private suggestSeq = 0;

  isModelLoaded(modelId: string): boolean {
    return this.loadedModelId === modelId && !!llm.currentModel;
  }

  async ensureLoadedFromFile(
    file: File,
    model: Pick<TextSuggestModelEntry, "id" | "label">,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<void> {
    if (this.isModelLoaded(model.id)) return;
    if (this.loadingPromise) await this.loadingPromise;
    if (this.isModelLoaded(model.id)) return;

    this.loadingPromise = this.loadFile(file, model, onProgress);
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async loadFile(
    file: File,
    model: Pick<TextSuggestModelEntry, "id" | "label">,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<void> {
    const result = await llm.loadModel(file, (pct: number) =>
      onProgress?.({ bytes: pct, total: 100 }),
    );
    if (!result.success) {
      throw new Error(result.error ?? "Failed to load model");
    }
    this.loadedModelId = model.id;
  }

  private buildSystemPrompt(maxTokens: number): string {
    const approxWords = Math.max(4, Math.round(maxTokens * 0.7));
    return [
      "You are autocomplete for a document editor.",
      "Continue the document from the exact end of the given text.",
      `Write about ${approxWords} words of natural continuation (target length matters).`,
      "You may write more than one clause if that fits the target length.",
      "If the document ends mid-sentence, continue mid-sentence — do NOT add a period, question mark, or exclamation mark at the end.",
      "Only use sentence-ending punctuation when finishing a sentence that clearly completes.",
      "Do not answer questions, explain, summarize, or chat.",
      "Do not put the continuation in quotes.",
      "Do not repeat text that is already in the document.",
      "Output ONLY the continuation text.",
    ].join(" ");
  }

  private buildUserPrompt(prefix: string, maxTokens: number): string {
    const tail = prefix.slice(-800);
    const approxWords = Math.max(4, Math.round(maxTokens * 0.7));
    return (
      `Document text up to the cursor:\n` +
      `---\n${tail}\n---\n` +
      `Continue from the end with ~${approxWords} words. Continuation only:`
    );
  }

  private normalizeContinuation(text: string, prefix: string): string {
    let out = text
      .replace(/\r/g, "")
      .replace(/^[\s]*["'`]+/, "")
      .replace(/["'`]+[\s]*$/, "")
      .replace(
        /^\s*(?:Sure[.,]?|Okay[.,]?|Alright[.,]?|Here(?:'s| is)?(?: the)?(?: continuation| next words| text)?(?:[:\-])?\s*)/i,
        "",
      )
      .replace(
        /^\s*(?:Certainly[.,]?|Of course[.,]?|I'd be happy to[^.\n]*[.!]?\s*)/i,
        "",
      )
      .replace(/^\s*(?:Continuation|Next words)\s*[:\-]\s*/i, "");

    const echo = prefix.slice(-40).trim();
    if (echo && out.toLowerCase().startsWith(echo.toLowerCase())) {
      out = out.slice(echo.length);
    }

    // Ghost text can span one paragraph; stop at a blank line.
    const blank = out.search(/\n\s*\n/);
    if (blank !== -1) out = out.slice(0, blank);
    out = out.replace(/\n+/g, " ").replace(/\s+$/, "");

    // If the user is mid-sentence, strip a trailing sentence ender the model
    // often adds out of habit.
    const trimmedPrefix = prefix.replace(/\s+$/, "");
    const midSentence =
      trimmedPrefix.length > 0 && !/[.!?…]"?$/.test(trimmedPrefix);
    if (midSentence) {
      out = out.replace(/[.!?]+["']?\s*$/, "");
    }

    if (out && prefix.length > 0 && !/\s$/.test(prefix) && !/^\s/.test(out)) {
      out = ` ${out}`;
    }

    return out;
  }

  /**
   * Queue a suggestion so only one generation runs at a time.
   * Phi-3 / other instruct GGUFs need the chat template (`generate`), not
   * raw `generateCompletion` — raw prompts often finish immediately with "".
   */
  async suggest(
    req: SuggestRequest,
    opts: {
      maxTokens: number;
      temperature: number;
      abortSignal?: AbortSignal;
    },
  ): Promise<SuggestResult> {
    if (!llm.currentModel) {
      throw new Error("Model not loaded");
    }

    const mySeq = ++this.suggestSeq;
    const maxTokens = Math.max(4, Math.min(256, opts.maxTokens));

    const run = async (): Promise<SuggestResult> => {
      if (mySeq !== this.suggestSeq || opts.abortSignal?.aborted) {
        throw new DOMException("Suggestion superseded", "AbortError");
      }

      const t0 = performance.now();
      const result = await llm.generate({
        system: this.buildSystemPrompt(maxTokens),
        prompt: this.buildUserPrompt(req.prefix, maxTokens),
        maxTokens,
        temperature: Math.max(opts.temperature, 0.35),
        topP: 0.92,
        abortSignal: opts.abortSignal,
      });

      if (mySeq !== this.suggestSeq || opts.abortSignal?.aborted) {
        throw new DOMException("Suggestion superseded", "AbortError");
      }

      if (!result.success) {
        throw new Error(result.error ?? "Generation failed");
      }

      console.debug("[textSuggest] generate", {
        maxTokens,
        rawText: result.text,
        timeMs: result.timeMs,
      });

      const text = this.normalizeContinuation(result.text ?? "", req.prefix);
      return { text, msElapsed: performance.now() - t0 };
    };

    const previous = this.generationTail;
    let release!: () => void;
    this.generationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await previous;
      return await run();
    } finally {
      release();
    }
  }

  async unload(): Promise<void> {
    this.suggestSeq++;
    await this.generationTail;
    await llm.unload();
    this.loadedModelId = null;
  }
}

export const textSuggestService = new TextSuggestService();
