import type { Wllama } from "@wllama/wllama/esm/index.js";
import type {
  ProofreadRequest,
  ProofreadResult,
  SuggestRequest,
  SuggestResult,
  TextSuggestModelEntry,
} from "./types";
import {
  generateProofread,
  generateSuggestion,
  type SuggestOptions,
} from "./wllama/generation";
import {
  exitWllama,
  loadWllamaModel,
  type LoadProgress,
} from "./wllama/modelRuntime";
import { SerialGenerationQueue } from "./wllama/SerialGenerationQueue";

export type { LoadProgress } from "./wllama/modelRuntime";

class TextSuggestService {
  private llm: Wllama | null = null;
  private loadedModelId: string | null = null;
  private loadingPromise: Promise<void> | null = null;
  private queue = new SerialGenerationQueue();
  private suggestSeq = 0;
  private proofreadSeq = 0;

  isModelLoaded(modelId: string): boolean {
    return (
      this.loadedModelId === modelId && this.llm?.isModelLoaded() === true
    );
  }

  async ensureLoadedFromFile(
    file: File,
    model: Pick<TextSuggestModelEntry, "id" | "label">,
    onProgress?: (progress: LoadProgress) => void,
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
    onProgress?: (progress: LoadProgress) => void,
  ): Promise<void> {
    await this.unload();
    const llm = await loadWllamaModel(file, model.label, onProgress);
    this.llm = llm;
    this.loadedModelId = model.id;
  }

  async suggest(
    req: SuggestRequest,
    options: SuggestOptions,
  ): Promise<SuggestResult> {
    const llm = this.requireLoadedModel();
    const sequence = ++this.suggestSeq;
    return this.queue.run(async () => {
      this.assertActive(sequence === this.suggestSeq, options.abortSignal, "Suggestion");
      const result = await generateSuggestion(llm, req, options);
      this.assertActive(sequence === this.suggestSeq, options.abortSignal, "Suggestion");
      return result;
    });
  }

  async proofread(
    req: ProofreadRequest,
    options: { abortSignal?: AbortSignal } = {},
  ): Promise<ProofreadResult> {
    const llm = this.requireLoadedModel();
    const sequence = ++this.proofreadSeq;
    return this.queue.run(async () => {
      this.assertActive(
        sequence === this.proofreadSeq,
        options.abortSignal,
        "Proofreading",
      );
      const result = await generateProofread(llm, req, options.abortSignal);
      this.assertActive(
        sequence === this.proofreadSeq,
        options.abortSignal,
        "Proofreading",
      );
      return result;
    });
  }

  async unload(): Promise<void> {
    this.suggestSeq++;
    this.proofreadSeq++;
    const llm = this.llm;
    this.llm = null;
    this.loadedModelId = null;
    await this.queue.idle();
    await exitWllama(llm);
  }

  private requireLoadedModel(): Wllama {
    if (!this.llm?.isModelLoaded()) throw new Error("Model not loaded");
    return this.llm;
  }

  private assertActive(
    current: boolean,
    signal: AbortSignal | undefined,
    label: "Suggestion" | "Proofreading",
  ): void {
    if (!current || signal?.aborted) {
      throw new DOMException(`${label} superseded`, "AbortError");
    }
  }
}

export const textSuggestService = new TextSuggestService();
