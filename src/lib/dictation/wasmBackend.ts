/**
 * Wrapper around the vendored whisper.cpp Emscripten build at /whisper/whisper.js.
 * The upstream build exposes a Module factory with:
 *   - Module.FS_createDataFile(parent, name, data, canRead, canWrite, canOwn)
 *   - Module.init(modelPath: string): number  // returns instance id
 *   - Module.full_default(instance, audio: Float32Array, lang: string, threads: number, translate: boolean): number
 *   - Module.free(instance): void
 *   - Module.print / Module.printErr — stdout/stderr hooks
 * If your vendored build exposes slightly different names, adjust the calls here.
 */
import type { DictationLanguage, WhisperBackend } from "./types";
import { getModelBytes } from "./modelStorage";

type WhisperModule = {
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn?: boolean,
  ): void;
  FS_unlink?(path: string): void;
  init(modelPath: string): number;
  full_default(
    instance: number,
    audio: Float32Array,
    lang: string,
    nthreads: number,
    translate: boolean,
  ): number;
  free?(instance: number): void;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
};

interface WhisperFactoryOpts {
  locateFile?: (path: string, prefix: string) => string;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
}

type WhisperFactory = (
  opts: WhisperFactoryOpts,
) => Promise<WhisperModule>;

declare const self: WorkerGlobalScope & typeof globalThis;

let mod: WhisperModule | null = null;
let instance = 0;
let loadedModelKey: string | null = null;
const transcriptBuffer: string[] = [];

const TIMESTAMP_LINE =
  /^\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*(.*)$/;
const NON_SPEECH_TOKEN =
  /^\[\s*[A-Z_][A-Z_ ]*\s*\]$|^\(\s*[a-z][a-z\s]*\s*\)$|^\*[^*]+\*$/;

function cleanTranscript(lines: string[]): string {
  const segments: string[] = [];
  for (const line of lines) {
    const match = line.match(TIMESTAMP_LINE);
    if (!match) continue;
    const text = match[1].trim();
    if (!text) continue;
    if (NON_SPEECH_TOKEN.test(text)) continue;
    segments.push(text);
  }
  return segments.join(" ").replace(/\s+/g, " ").trim();
}

async function getFactory(): Promise<WhisperFactory> {
  // Vendored Emscripten ESM build at /whisper/whisper.mjs.
  // Build flags: -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createWhisperModule
  // We load via fetch + Blob URL to bypass Vite's module-transform pipeline,
  // which otherwise tries to parse the emscripten output as a normal ES module
  // and fails (the file contains constructs Vite doesn't expect).
  try {
    const res = await fetch("/whisper/whisper.mjs");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    const blob = new Blob([text], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      const mod = (await import(
        /* @vite-ignore */ url
      )) as { default: WhisperFactory };
      return mod.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    throw new Error(
      `Failed to load /whisper/whisper.mjs — vendor whisper.cpp WASM build first. ${
        (err as Error).message
      }`,
    );
  }
}

async function ensureModule(): Promise<WhisperModule> {
  if (mod) return mod;
  const factory = await getFactory();
  transcriptBuffer.length = 0;
  mod = await factory({
    // The factory is loaded via a Blob URL, so import.meta.url inside it is
    // opaque. Tell emscripten to look for the wasm next to the original path.
    locateFile: (path: string) => `/whisper/${path}`,
    print: (s: string) => {
      transcriptBuffer.push(s);
    },
    printErr: (s: string) => {
      // whisper.cpp uses stderr verbosely; surface to console for debugging
      console.warn("[whisper]", s);
    },
  });
  return mod;
}

export const wasmBackend: WhisperBackend = {
  async load(modelUrl, modelKey) {
    const m = await ensureModule();
    if (loadedModelKey === modelKey && instance) return;
    if (instance && m.free) m.free(instance);
    instance = 0;
    const bytes = await getModelBytes(modelUrl, modelKey);
    const fname = `${modelKey}.bin`;
    try {
      m.FS_unlink?.(`/${fname}`);
    } catch {
      // not present
    }
    m.FS_createDataFile("/", fname, bytes, true, true, true);
    const id = m.init(fname);
    if (!id) throw new Error("whisper init failed");
    instance = id;
    loadedModelKey = modelKey;
  },

  async transcribe(audio: Float32Array, language?: DictationLanguage) {
    const m = await ensureModule();
    if (!instance) throw new Error("Model not loaded");
    transcriptBuffer.length = 0;
    const lang = !language || language === "auto" ? "auto" : language;
    const nthreads = Math.max(
      1,
      Math.min(8, (self.navigator?.hardwareConcurrency ?? 4) - 1),
    );
    const t0 = performance.now();
    const rc = m.full_default(instance, audio, lang, nthreads, false);
    const msElapsed = performance.now() - t0;
    if (rc !== 0) throw new Error(`whisper full_default returned ${rc}`);
    const text = cleanTranscript(transcriptBuffer);
    return {
      text,
      msElapsed,
      audioMs: (audio.length / 16000) * 1000,
    };
  },

  async unload() {
    if (mod && instance && mod.free) mod.free(instance);
    instance = 0;
    loadedModelKey = null;
  },
};
