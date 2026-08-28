import { useCallback, useEffect, useRef, useState } from "react";
import { loadPrefs, savePrefs } from "../../../lib/textSuggest/prefs";
import { makeModelId } from "../../../lib/textSuggest/modelCatalog";
import { textSuggestService } from "../../../lib/textSuggest/wllamaService";
import type { LoadProgress } from "../../../lib/textSuggest/wllamaService";
import type {
  TextSuggestModelEntry,
  TextSuggestModelId,
  TextSuggestPrefs,
} from "../../../lib/textSuggest/types";

export function useTextSuggestSettings(
  open: boolean,
  onSaved?: () => void | Promise<void>,
) {
  const [prefs, setPrefs] = useState<TextSuggestPrefs | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] =
    useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRequestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    void loadPrefs().then((next) => {
      setError(null);
      setPrefs(next);
    });
  }, [open]);

  const persist = useCallback(
    async (next: TextSuggestPrefs) => {
      setPrefs(next);
      await savePrefs(next);
      await onSaved?.();
    },
    [onSaved],
  );

  const patchPrefs = useCallback(
    async (patch: Partial<TextSuggestPrefs>) => {
      if (prefs) await persist({ ...prefs, ...patch });
    },
    [persist, prefs],
  );

  const previewPrefs = useCallback((patch: Partial<TextSuggestPrefs>) => {
    setPrefs((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const addModelFromFile = useCallback(
    async (file: File) => {
      if (!prefs) return;
      const requestId = ++loadingRequestRef.current;
      setError(null);
      setLoading(true);
      setLoadingProgress({ bytes: 0, total: 100 });
      const objectUrl = URL.createObjectURL(file);
      const entry: TextSuggestModelEntry = {
        id: makeModelId(objectUrl),
        label: file.name,
        url: objectUrl,
      };

      try {
        await textSuggestService.ensureLoadedFromFile(
          file,
          entry,
          setLoadingProgress,
        );
        if (requestId !== loadingRequestRef.current) {
          await textSuggestService.unload();
          return;
        }
        await persist({
          ...prefs,
          models: [...prefs.models, entry],
          activeModelId: entry.id,
          enabled: prefs.enabled,
        });
      } catch (cause) {
        URL.revokeObjectURL(objectUrl);
        if (requestId === loadingRequestRef.current) {
          setError(
            cause instanceof Error ? cause.message : "Failed to add model",
          );
        }
      } finally {
        setLoading(false);
        setLoadingProgress(null);
      }
    },
    [persist, prefs],
  );

  const cancelLoading = useCallback(() => {
    if (!loading) return;
    loadingRequestRef.current++;
    setLoading(false);
    setLoadingProgress(null);
  }, [loading]);

  const selectModel = useCallback(
    async (id: TextSuggestModelId) => {
      if (prefs) await persist({ ...prefs, activeModelId: id });
    },
    [persist, prefs],
  );

  const removeModel = useCallback(
    async (id: TextSuggestModelId) => {
      if (!prefs) return;
      setBusyId(id);
      try {
        await textSuggestService.unload();
        const models = prefs.models.filter((model) => model.id !== id);
        await persist({
          ...prefs,
          models,
          activeModelId:
            prefs.activeModelId === id
              ? models[0]?.id ?? null
              : prefs.activeModelId,
        });
      } finally {
        setBusyId(null);
      }
    },
    [persist, prefs],
  );

  return {
    prefs,
    busyId,
    loading,
    loadingProgress,
    cancelLoading,
    error,
    patchPrefs,
    previewPrefs,
    addModelFromFile,
    selectModel,
    removeModel,
  };
}
