import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { buildStamp } from './scripts/buildStamp';

const serverPort = process.env.PORT ?? '3001';

// The SSR pass (the prerender bundle, see scripts/prerender.ts) needs no copy of client/public.
export default defineConfig(({ isSsrBuild }) => ({
  root: 'client',
  plugins: [react(), buildStamp()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      '/api': { target: `http://localhost:${serverPort}`, changeOrigin: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: false,
    copyPublicDir: !isSsrBuild,
  },
}));
