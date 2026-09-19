import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { resolveActiveModel } from "../../lib/textSuggest/modelCatalog";
import { textSuggestService } from "../../lib/textSuggest/wllamaService";
import type {
  ProofreadResult,
  TextSuggestPrefs,
  TextSuggestState,
} from "../../lib/textSuggest/types";
import { isAbortError } from "./requestUtils";

interface Options {
  prefsRef: { current: TextSuggestPrefs | null };
  setState: Dispatch<SetStateAction<TextSuggestState>>;
  clearSuggestion: () => void;
}

export type ProofreadStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "error"; message: string };

export function useProofreadRequest({
  prefsRef,
  setState,
  clearSuggestion,
}: Options) {
  const [proofreadStatus, setProofreadStatus] = useState<ProofreadStatus>({
    kind: "idle",
  });
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const cancelProofread = useCallback(() => {
    requestIdRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setProofreadStatus({ kind: "idle" });
  }, []);

  const requestProofread = useCallback(
    async (document: string, instruction: string): Promise<ProofreadResult> => {
      const currentPrefs = prefsRef.current;
      const model = currentPrefs ? resolveActiveModel(currentPrefs) : null;
      if (!model) {
        const message = "Choose and load a GGUF model before proofreading.";
        setProofreadStatus({ kind: "error", message });
        throw new Error(message);
      }
      if (!textSuggestService.isModelLoaded(model.id)) {
        const message =
          "Model not loaded. Open Local AI settings and choose the GGUF file again.";
        setProofreadStatus({ kind: "error", message });
        throw new Error(message);
      }

      clearSuggestion();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;
      setProofreadStatus({ kind: "running" });

      try {
        const result = await textSuggestService.proofread(
          { document, instruction },
          { abortSignal: controller.signal },
        );
        if (requestId !== requestIdRef.current) {
          throw new DOMException("Proofreading superseded", "AbortError");
        }
        setProofreadStatus({ kind: "idle" });
        return result;
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          throw new DOMException("Proofreading cancelled", "AbortError");
        }
        if (isAbortError(error)) {
          setProofreadStatus({ kind: "idle" });
          throw new DOMException("Proofreading cancelled", "AbortError");
        }
        const message = error instanceof Error ? error.message : String(error);
        setProofreadStatus({ kind: "error", message });
        setState((state) =>
          state.kind === "thinking" ? { kind: "ready" } : state,
        );
        throw error;
      } finally {
        if (requestId === requestIdRef.current) abortRef.current = null;
      }
    },
    [clearSuggestion, prefsRef, setState],
  );

  useEffect(() => cancelProofread, [cancelProofread]);

  return { proofreadStatus, requestProofread, cancelProofread };
}
