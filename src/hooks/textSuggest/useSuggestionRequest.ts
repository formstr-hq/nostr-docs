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
  TextSuggestPrefs,
  TextSuggestState,
} from "../../lib/textSuggest/types";
import type { TextSuggestion } from "./types";
import { isAbortError } from "./requestUtils";

interface Options {
  prefsRef: { current: TextSuggestPrefs | null };
  setState: Dispatch<SetStateAction<TextSuggestState>>;
}

export function useSuggestionRequest({ prefsRef, setState }: Options) {
  const [suggestion, setSuggestion] = useState<TextSuggestion | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const pendingPosRef = useRef<number | null>(null);
  const suggestionRef = useRef<TextSuggestion | null>(null);
  suggestionRef.current = suggestion;

  const clearSuggestion = useCallback(() => {
    setSuggestion(null);
    pendingPosRef.current = null;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current++;
    setState((state) =>
      state.kind === "thinking" ? { kind: "ready" } : state,
    );
  }, [setState]);

  const notifyCursorPos = useCallback(
    (cursorPos: number) => {
      if (pendingPosRef.current === cursorPos) return;
      if (suggestionRef.current?.pos === cursorPos) return;
      if (pendingPosRef.current !== null || suggestionRef.current !== null) {
        clearSuggestion();
      }
    },
    [clearSuggestion],
  );

  const requestSuggestion = useCallback(
    (prefix: string, cursorPos: number) => {
      const currentPrefs = prefsRef.current;
      if (!currentPrefs?.enabled) return;
      const model = resolveActiveModel(currentPrefs);
      if (!model) return;

      if (!prefix.trim()) {
        clearSuggestion();
        return;
      }

      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
      abortRef.current = null;
      setSuggestion(null);

      const requestId = ++requestIdRef.current;
      const requestPos = cursorPos;
      pendingPosRef.current = requestPos;
      console.debug("[textSuggest] request", {
        requestId,
        cursorPos: requestPos,
        prefixLength: prefix.length,
        enabled: currentPrefs.enabled,
        activeModelId: currentPrefs.activeModelId,
        modelLabel: model.label,
      });

      debounceTimer.current = setTimeout(async () => {
        if (
          requestId !== requestIdRef.current ||
          pendingPosRef.current !== requestPos
        ) {
          return;
        }

        const latestPrefs = prefsRef.current;
        if (!latestPrefs?.enabled) return;
        const latestModel = resolveActiveModel(latestPrefs);
        if (!latestModel) return;

        const controller = new AbortController();
        abortRef.current = controller;
        try {
          if (!textSuggestService.isModelLoaded(latestModel.id)) {
            setState({
              kind: "error",
              message:
                "Model not loaded. Open Local AI settings and load a GGUF file.",
            });
            return;
          }
          if (
            requestId !== requestIdRef.current ||
            controller.signal.aborted ||
            pendingPosRef.current !== requestPos
          ) {
            return;
          }

          setState((state) =>
            state.kind === "error" ||
            state.kind === "ready" ||
            state.kind === "thinking"
              ? { kind: "thinking" }
              : state,
          );
              setSuggestion({ text: "", pos: requestPos, loading: true });
          const result = await textSuggestService.suggest(
            { prefix },
            {
              maxTokens: latestPrefs.maxTokens,
              temperature: latestPrefs.temperature,
              abortSignal: controller.signal,
            },
          );
          if (
            requestId !== requestIdRef.current ||
            pendingPosRef.current !== requestPos
          ) {
            return;
          }

          const cleaned = result.text.replace(/\s+$/, "");
          console.debug("[textSuggest] response", {
            requestId,
            cursorPos: requestPos,
            rawText: result.text,
            cleanedText: cleaned,
            msElapsed: result.msElapsed,
          });
          if (cleaned.trim()) setSuggestion({ text: cleaned, pos: requestPos });
          setState((state) =>
            state.kind === "thinking" ? { kind: "ready" } : state,
          );
        } catch (error) {
          if (requestId !== requestIdRef.current) return;
          if (isAbortError(error)) {
            setState((state) =>
              state.kind === "thinking" ? { kind: "ready" } : state,
            );
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          console.error("[textSuggest] error", { requestId, error, message });
          setState({ kind: "error", message });
        }
      }, currentPrefs.debounceMs);
    },
    [clearSuggestion, prefsRef, setState],
  );

  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
    },
    [],
  );

  return {
    suggestion,
    requestSuggestion,
    clearSuggestion,
    notifyCursorPos,
  };
}
