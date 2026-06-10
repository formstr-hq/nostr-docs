import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveModel,
  pickDefaultModel,
  BUILTIN_MODELS,
} from "../lib/dictation/modelCatalog";
import { hasCachedModel } from "../lib/dictation/modelStorage";
import { loadPrefs, savePrefs } from "../lib/dictation/prefs";
import { startRecording, type RecorderHandle } from "../lib/dictation/recorder";
import type {
  DictationPrefs,
  DictationState,
  WhisperRequest,
  WhisperResponse,
} from "../lib/dictation/types";

let sharedWorker: Worker | null = null;
let workerLoadedKey: string | null = null;

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL("../lib/dictation/whisperWorker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return sharedWorker;
}

interface UseDictationOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onNoSpeech?: () => void;
}

interface UseDictationReturn {
  state: DictationState;
  prefs: DictationPrefs | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
  reload: () => Promise<void>;
  updatePrefs: (next: DictationPrefs) => Promise<void>;
}

export function useDictation(opts: UseDictationOptions): UseDictationReturn {
  const [state, setState] = useState<DictationState>({ kind: "idle" });
  const [prefs, setPrefs] = useState<DictationPrefs | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const optsRef = useRef(opts);

  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    let alive = true;
    loadPrefs().then((p) => {
      if (alive) setPrefs(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const next = await loadPrefs();
    setPrefs(next);
  }, []);

  const updatePrefs = useCallback(async (next: DictationPrefs) => {
    setPrefs(next);
    await savePrefs(next);
    workerLoadedKey = null;
  }, []);

  const ensureModelLoaded = useCallback(
    async (currentPrefs: DictationPrefs): Promise<boolean> => {
      const model =
        resolveModel(currentPrefs.modelId, currentPrefs.customModels) ??
        BUILTIN_MODELS[pickDefaultModel()];
      const isCached = await hasCachedModel(model.url, model.storageKey);
      if (!isCached && !currentPrefs.setupComplete) {
        setState({ kind: "needs-setup" });
        return false;
      }
      if (workerLoadedKey === model.storageKey) return true;
      setState({ kind: "loading" });
      const worker = getWorker();
      return new Promise<boolean>((resolve) => {
        const handler = (ev: MessageEvent<WhisperResponse>) => {
          const msg = ev.data;
          if (msg.type === "loadProgress") {
            setState({
              kind: "downloading",
              bytes: msg.bytes,
              total: msg.total,
            });
          } else if (msg.type === "loaded") {
            workerLoadedKey = msg.modelKey;
            worker.removeEventListener("message", handler);
            resolve(true);
          } else if (msg.type === "error") {
            worker.removeEventListener("message", handler);
            setState({ kind: "error", message: msg.message });
            optsRef.current.onError?.(msg.message);
            resolve(false);
          }
        };
        worker.addEventListener("message", handler);
        const req: WhisperRequest = {
          type: "load",
          modelUrl: model.url,
          modelKey: model.storageKey,
        };
        worker.postMessage(req);
      });
    },
    [],
  );

  const start = useCallback(async () => {
    try {
      const currentPrefs = prefs ?? (await loadPrefs());
      if (!prefs) setPrefs(currentPrefs);
      const ok = await ensureModelLoaded(currentPrefs);
      if (!ok) return;
      const handle = await startRecording();
      recorderRef.current = handle;
      const startedAt = Date.now();
      setState({ kind: "recording", startedAt, level: 0 });
      handle.onLevel((level) => {
        setState((s) =>
          s.kind === "recording" ? { ...s, level } : s,
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "SecurityError")
      ) {
        setState({ kind: "needs-permission" });
        return;
      }
      setState({ kind: "error", message: msg });
      optsRef.current.onError?.(msg);
    }
  }, [prefs, ensureModelLoaded]);

  const stop = useCallback(async () => {
    const handle = recorderRef.current;
    if (!handle) return;
    recorderRef.current = null;
    setState({ kind: "transcribing" });
    try {
      const { pcm } = await handle.stop();
      const currentPrefs = prefs ?? (await loadPrefs());
      const lang = currentPrefs.language;
      const worker = getWorker();
      const result = await new Promise<string>((resolve, reject) => {
        const handler = (ev: MessageEvent<WhisperResponse>) => {
          const msg = ev.data;
          if (msg.type === "transcript") {
            worker.removeEventListener("message", handler);
            resolve(msg.text);
          } else if (msg.type === "error") {
            worker.removeEventListener("message", handler);
            reject(new Error(msg.message));
          }
        };
        worker.addEventListener("message", handler);
        const req: WhisperRequest = {
          type: "transcribe",
          audio: pcm,
          language: lang,
        };
        worker.postMessage(req, [pcm.buffer]);
      });
      setState({ kind: "idle" });
      if (result) {
        optsRef.current.onTranscript(result);
      } else {
        optsRef.current.onNoSpeech?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", message: msg });
      optsRef.current.onError?.(msg);
    }
  }, [prefs]);

  const cancel = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setState({ kind: "idle" });
  }, []);

  return { state, prefs, start, stop, cancel, reload, updatePrefs };
}
