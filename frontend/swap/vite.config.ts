import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * Vite config for Minotaur Swap.
 *
 * - Alias `@/` → `src/` matches the legacy minotaur-mainapp convention and
 *   the design tree's tsconfig, so lifted modules port cleanly.
 * - `/api` proxy targets the public Minotaur aggregator by default.
 *   Override with VITE_API_URL for local validator dev.
 * - Dev server on 5173 (Vite default). Design tree uses 4324 — keep them
 *   non-conflicting so visual regression can run both in parallel.
 */
const PUBLIC_MINOTAUR_API = 'https://api.minotaursubnet.com'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || PUBLIC_MINOTAUR_API,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
