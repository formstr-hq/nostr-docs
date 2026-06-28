export type BuiltinModelId =
  | "tiny"
  | "base"
  | "small"
  | "tiny.en"
  | "base.en"
  | "small.en";

export type DictationModelId = BuiltinModelId | `custom:${string}`;

export type DictationLanguage = "auto" | string;

export interface ModelInfo {
  id: DictationModelId;
  label: string;
  englishOnly: boolean;
  sizeBytes: number;
  url: string;
  storageKey: string;
  custom?: boolean;
}

export interface CustomModelEntry {
  id: `custom:${string}`;
  label: string;
  url: string;
  sizeBytes: number;
  englishOnly: boolean;
}

export type WhisperRequest =
  | { type: "load"; modelUrl: string; modelKey: string }
  | { type: "transcribe"; audio: Float32Array; language?: DictationLanguage }
  | { type: "unload" };

export type WhisperResponse =
  | { type: "loadProgress"; bytes: number; total: number }
  | { type: "loaded"; modelKey: string }
  | {
      type: "transcript";
      text: string;
      segments?: { t0: number; t1: number; text: string }[];
      msElapsed: number;
      audioMs: number;
    }
  | { type: "error"; message: string };

export interface WhisperBackend {
  load(modelUrl: string, modelKey: string): Promise<void>;
  transcribe(
    audio: Float32Array,
    language?: DictationLanguage,
  ): Promise<{
    text: string;
    segments?: { t0: number; t1: number; text: string }[];
    msElapsed: number;
    audioMs: number;
  }>;
  unload(): Promise<void>;
}

export type DictationState =
  | { kind: "idle" }
  | { kind: "needs-permission" }
  | { kind: "needs-setup" }
  | { kind: "downloading"; bytes: number; total: number }
  | { kind: "loading" }
  | { kind: "recording"; startedAt: number; level: number }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

export interface DictationPrefs {
  modelId: DictationModelId;
  language: DictationLanguage;
  customModels: CustomModelEntry[];
  setupComplete: boolean;
}

export const DEFAULT_PREFS: DictationPrefs = {
  modelId: "tiny.en",
  language: "en",
  customModels: [],
  setupComplete: false,
};
