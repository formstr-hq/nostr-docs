const TARGET_SAMPLE_RATE = 16000;

export async function decodeAndResample(
  blob: Blob,
): Promise<{ pcm: Float32Array; durationMs: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const decodeCtx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    try {
      await decodeCtx.close();
    } catch {
      // ignore
    }
  }
  const mono = toMono(decoded);

  if (decoded.sampleRate === TARGET_SAMPLE_RATE) {
    return {
      pcm: mono,
      durationMs: (mono.length / TARGET_SAMPLE_RATE) * 1000,
    };
  }

  const targetLength = Math.ceil(
    (mono.length * TARGET_SAMPLE_RATE) / decoded.sampleRate,
  );
  const OAC: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (
      window as unknown as {
        webkitOfflineAudioContext: typeof OfflineAudioContext;
      }
    ).webkitOfflineAudioContext;
  const offline = new OAC(1, targetLength, TARGET_SAMPLE_RATE);
  const buffer = offline.createBuffer(1, mono.length, decoded.sampleRate);
  buffer.copyToChannel(mono as Float32Array<ArrayBuffer>, 0);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const out = new Float32Array(rendered.length);
  rendered.copyFromChannel(out, 0);
  return {
    pcm: out,
    durationMs: (out.length / TARGET_SAMPLE_RATE) * 1000,
  };
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    const out = new Float32Array(buffer.length);
    buffer.copyFromChannel(out, 0);
    return out;
  }
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  const tmp = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    buffer.copyFromChannel(tmp, c);
    for (let i = 0; i < length; i++) out[i] += tmp[i];
  }
  for (let i = 0; i < length; i++) out[i] /= channels;
  return out;
}
