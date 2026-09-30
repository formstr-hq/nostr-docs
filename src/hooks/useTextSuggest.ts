import { useCallback, useEffect, useRef, useState } from "react";
import { loadPrefs, savePrefs } from "../lib/textSuggest/prefs";
import { makeModelId, resolveActiveModel } from "../lib/textSuggest/modelCatalog";
import { textSuggestService } from "../lib/textSuggest/wllamaService";
import type {
  TextSuggestModelEntry,
  TextSuggestPrefs,
  TextSuggestState,
} from "../lib/textSuggest/types";
import { useSuggestionRequest } from "./textSuggest/useSuggestionRequest";
import { useProofreadRequest } from "./textSuggest/useProofreadRequest";
import type { UseTextSuggestReturn } from "./textSuggest/types";

export type {
  TextSuggestion,
} from "./textSuggest/types";

function stateForPrefs(prefs: TextSuggestPrefs): TextSuggestState {
  if (!prefs.enabled && !resolveActiveModel(prefs)) return { kind: "disabled" };
  return resolveActiveModel(prefs) ? { kind: "ready" } : { kind: "needs-setup" };
}

export function useTextSuggest(): UseTextSuggestReturn {
  const [state, setState] = useState<TextSuggestState>({ kind: "disabled" });
  const [prefs, setPrefs] = useState<TextSuggestPrefs | null>(null);
  const prefsRef = useRef<TextSuggestPrefs | null>(null);
  const suggestionRequest = useSuggestionRequest({ prefsRef, setState });
  const proofreadRequest = useProofreadRequest({
    prefsRef,
    setState,
    clearSuggestion: suggestionRequest.clearSuggestion,
  });

  const applyPrefs = useCallback((next: TextSuggestPrefs) => {
    prefsRef.current = next;
    setPrefs(next);
    setState(stateForPrefs(next));
  }, []);

  useEffect(() => {
    let alive = true;
    void loadPrefs().then((next) => {
      if (alive) applyPrefs(next);
    });
    return () => {
      alive = false;
    };
  }, [applyPrefs]);

  const reload = useCallback(async () => {
    applyPrefs(await loadPrefs());
  }, [applyPrefs]);

  const updatePrefs = useCallback(
    async (next: TextSuggestPrefs) => {
      applyPrefs(next);
      await savePrefs(next);
    },
    [applyPrefs],
  );

  const loadModelFromFile = useCallback(async (file: File) => {
    const currentPrefs = prefsRef.current ?? (await loadPrefs());
    const objectUrl = URL.createObjectURL(file);
    const model: TextSuggestModelEntry = {
      id: makeModelId(objectUrl),
      label: file.name,
      url: objectUrl,
    };
    const nextPrefs: TextSuggestPrefs = {
      ...currentPrefs,
      enabled: currentPrefs.enabled,
      models: [...currentPrefs.models, model],
      activeModelId: model.id,
    };

    setState({ kind: "loading" });
    try {
      await textSuggestService.ensureLoadedFromFile(file, model, (progress) => {
        setState({
          kind: "downloading",
          bytes: progress.bytes,
          total: progress.total,
        });
      });
      prefsRef.current = nextPrefs;
      setPrefs(nextPrefs);
      await savePrefs(nextPrefs);
      setState({ kind: "ready" });
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }, []);

  const removeActiveModel = useCallback(async () => {
    const currentPrefs = prefsRef.current ?? (await loadPrefs());
    if (!currentPrefs.activeModelId) {
      setState({ kind: "needs-setup" });
      return;
    }

    const models = currentPrefs.models.filter(
      (model) => model.id !== currentPrefs.activeModelId,
    );
    const nextPrefs: TextSuggestPrefs = {
      ...currentPrefs,
      enabled: currentPrefs.enabled && models.length > 0,
      models,
      activeModelId: models[0]?.id ?? null,
    };

    prefsRef.current = nextPrefs;
    setPrefs(nextPrefs);
    await savePrefs(nextPrefs);
    await textSuggestService.unload();
    setState(stateForPrefs(nextPrefs));
  }, []);

  return {
    state,
    prefs,
    ...suggestionRequest,
    ...proofreadRequest,
    reload,
    updatePrefs,
    loadModelFromFile,
    removeActiveModel,
  };
}

export type TextSuggestHook = ReturnType<typeof useTextSuggest>;
