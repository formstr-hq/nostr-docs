/// <reference lib="webworker" />
import { wasmBackend } from "./wasmBackend";
import type { WhisperRequest, WhisperResponse } from "./types";

declare const self: DedicatedWorkerGlobalScope;

function post(msg: WhisperResponse, transfer?: Transferable[]) {
  if (transfer && transfer.length) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

self.onmessage = async (e: MessageEvent<WhisperRequest>) => {
  const req = e.data;
  try {
    if (req.type === "load") {
      await wasmBackend.load(req.modelUrl, req.modelKey);
      post({ type: "loaded", modelKey: req.modelKey });
    } else if (req.type === "transcribe") {
      const result = await wasmBackend.transcribe(req.audio, req.language);
      post({
        type: "transcript",
        text: result.text,
        segments: result.segments,
        msElapsed: result.msElapsed,
        audioMs: result.audioMs,
      });
    } else if (req.type === "unload") {
      await wasmBackend.unload();
    }
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
