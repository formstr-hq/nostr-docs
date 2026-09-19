import { Chip, Stack } from "@mui/material";
import {
  checkLocalAIEnvironment,
  isFirefoxRuntime,
  shouldUseWebGPUForLocalAI,
} from "../../lib/textSuggest/environment";

export function RuntimeCapabilities() {
  const environment = checkLocalAIEnvironment();
  const useWebGPU = shouldUseWebGPUForLocalAI();

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      sx={{ mb: 2 }}
    >
      <Chip
        size="small"
        color={environment.success ? "success" : "error"}
        label={
          environment.success ? "WebAssembly ready" : "Unsupported browser"
        }
        title={environment.error}
      />

      {environment.success && (
        <Chip
          size="small"
          color={useWebGPU ? "success" : "default"}
          label={
            useWebGPU
              ? "WebGPU available"
              : environment.hasWebGPU
                ? "WebGPU detected · WASM mode"
                : "WebAssembly only"
          }
          title={
            environment.hasWebGPU && !useWebGPU
              ? isFirefoxRuntime()
                ? "WebGPU is disabled in Firefox for inference compatibility."
                : "WebGPU is disabled on mobile for inference stability."
              : undefined
          }
        />
      )}

      {environment.success && (
        <Chip
          size="small"
          variant="outlined"
          label={
            environment.crossOriginIsolated
              ? "Threaded WASM ready"
              : "Single-thread WASM"
          }
          title="Cross-origin isolation only controls multithreaded WebAssembly; it does not control WebGPU."
        />
      )}
    </Stack>
  );
}
