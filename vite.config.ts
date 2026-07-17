/**
 * vite.config.ts  — REPLACE the existing file with this
 *
 * Adds Cross-Origin headers required by wllama for SharedArrayBuffer
 * (needed when multi-thread mode is available in the browser).
 * Single-thread mode works without these headers, but adding them
 * enables the faster multi-thread path automatically.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  worker: {
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Also set headers for the preview build
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});