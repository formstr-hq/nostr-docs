import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@formstr/polls': fileURLToPath(new URL('./packages/formstr-polls/src/index.ts', import.meta.url)),
    },
  },
  base: '/',
})
