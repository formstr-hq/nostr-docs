import type {
  ProofreadResult,
  TextSuggestPrefs,
  TextSuggestState,
} from "../../lib/textSuggest/types";
import type { ProofreadStatus } from "./useProofreadRequest";

/** Suggestion text plus the editor cursor position it was requested for. */
export interface TextSuggestion {
  text: string;
  pos: number;
  loading?: boolean;
}

export interface UseTextSuggestReturn {
  state: TextSuggestState;
  prefs: TextSuggestPrefs | null;
  suggestion: TextSuggestion | null;
  proofreadStatus: ProofreadStatus;
  requestSuggestion: (prefix: string, cursorPos: number) => void;
  clearSuggestion: () => void;
  requestProofread: (
    document: string,
    instruction: string,
  ) => Promise<ProofreadResult>;
  cancelProofread: () => void;
  notifyCursorPos: (cursorPos: number) => void;
  reload: () => Promise<void>;
  updatePrefs: (next: TextSuggestPrefs) => Promise<void>;
  loadModelFromFile: (file: File) => Promise<void>;
  removeActiveModel: () => Promise<void>;
}
