import type {
  BuiltinModelId,
  CustomModelEntry,
  DictationModelId,
  ModelInfo,
} from "./types";

const HF_BASE =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export const BUILTIN_MODELS: Record<BuiltinModelId, ModelInfo> = {
  "tiny.en": {
    id: "tiny.en",
    label: "Tiny (English)",
    englishOnly: true,
    sizeBytes: 31_500_000,
    url: `${HF_BASE}/ggml-tiny.en-q5_1.bin`,
    storageKey: "ggml-tiny.en-q5_1",
  },
  "base.en": {
    id: "base.en",
    label: "Base (English)",
    englishOnly: true,
    sizeBytes: 57_700_000,
    url: `${HF_BASE}/ggml-base.en-q5_1.bin`,
    storageKey: "ggml-base.en-q5_1",
  },
  "small.en": {
    id: "small.en",
    label: "Small (English)",
    englishOnly: true,
    sizeBytes: 181_500_000,
    url: `${HF_BASE}/ggml-small.en-q5_1.bin`,
    storageKey: "ggml-small.en-q5_1",
  },
  tiny: {
    id: "tiny",
    label: "Tiny (multilingual)",
    englishOnly: false,
    sizeBytes: 31_700_000,
    url: `${HF_BASE}/ggml-tiny-q5_1.bin`,
    storageKey: "ggml-tiny-q5_1",
  },
  base: {
    id: "base",
    label: "Base (multilingual)",
    englishOnly: false,
    sizeBytes: 57_700_000,
    url: `${HF_BASE}/ggml-base-q5_1.bin`,
    storageKey: "ggml-base-q5_1",
  },
  small: {
    id: "small",
    label: "Small (multilingual)",
    englishOnly: false,
    sizeBytes: 181_500_000,
    url: `${HF_BASE}/ggml-small-q5_1.bin`,
    storageKey: "ggml-small-q5_1",
  },
};

export function customToModelInfo(entry: CustomModelEntry): ModelInfo {
  return {
    id: entry.id,
    label: entry.label,
    englishOnly: entry.englishOnly,
    sizeBytes: entry.sizeBytes,
    url: entry.url,
    storageKey: `custom-${entry.id.slice("custom:".length)}`,
    custom: true,
  };
}

export function resolveModel(
  modelId: DictationModelId,
  customModels: CustomModelEntry[],
): ModelInfo | null {
  if (modelId.startsWith("custom:")) {
    const entry = customModels.find((m) => m.id === modelId);
    return entry ? customToModelInfo(entry) : null;
  }
  return BUILTIN_MODELS[modelId as BuiltinModelId] ?? null;
}

export function pickDefaultModel(): BuiltinModelId {
  return "tiny.en";
}

export const SUPPORTED_LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "hi", label: "Hindi" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ar", label: "Arabic" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "uk", label: "Ukrainian" },
  { code: "he", label: "Hebrew" },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
