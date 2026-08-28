export interface LocalAIEnvironment {
  success: boolean;
  hasWebGPU?: boolean;
  crossOriginIsolated?: boolean;
  error?: string;
}

/** Check browser capabilities without loading WASM or a model. */
export function checkLocalAIEnvironment(): LocalAIEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      success: false,
      error: "Local AI can only run in a browser.",
    };
  }

  if (typeof WebAssembly === "undefined") {
    return {
      success: false,
      error: "WebAssembly is not supported in this browser.",
    };
  }

  return {
    success: true,
    hasWebGPU: "gpu" in navigator,
    crossOriginIsolated: window.crossOriginIsolated,
  };
}

/** Confirm that the exposed WebGPU API can return a hardware adapter. */
export async function hasWorkingWebGPU(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;

  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<unknown | null> };
    }
  ).gpu;
  if (!gpu) return false;

  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

export function isMobileLocalAIRuntime(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  return (
    "Capacitor" in window ||
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
  );
}

export function isFirefoxRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Firefox\//i.test(navigator.userAgent);
}

/**
 * Select the inference backend. Mobile intentionally stays on WASM/CPU even
 * when navigator.gpu exists because some mobile WebGPU/model combinations
 * return corrupt repeated tokens.
 */
export function shouldUseWebGPUForLocalAI(): boolean {
  const environment = checkLocalAIEnvironment();
  return Boolean(
    environment.success &&
      environment.hasWebGPU &&
      !isMobileLocalAIRuntime() &&
      !isFirefoxRuntime(),
  );
}
