import { decodeAndResample } from "./resample";

export interface RecorderHandle {
  stop(): Promise<{ pcm: Float32Array; durationMs: number }>;
  cancel(): void;
  onLevel(cb: (level: number) => void): void;
}

export type PermissionResult = "granted" | "denied" | "prompt";

export async function requestMicPermission(): Promise<PermissionResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "NotAllowedError" || err.name === "SecurityError")
    ) {
      return "denied";
    }
    return "prompt";
  }
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ac = new AC();
  const source = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let levelCb: ((l: number) => void) | undefined;
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    levelCb?.(Math.min(1, rms * 3));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    try {
      ac.close();
    } catch {
      // ignore
    }
  };

  return {
    async stop() {
      if (recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }
      cleanup();
      const blob = new Blob(chunks, {
        type: mimeType || chunks[0]?.type || "audio/webm",
      });
      return decodeAndResample(blob);
    },
    cancel() {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // ignore
      }
      cleanup();
    },
    onLevel(cb) {
      levelCb = cb;
    },
  };
}
