import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The admin dashboard (admin.boredgames.io): its own small build in dist/admin, served by the
 * game server on the admin host only and never deployed to Vercel. `npm run build:admin`.
 */
export default defineConfig({
  root: 'admin',
  base: '/',
  plugins: [react()],
  publicDir: false,
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
    sourcemap: false,
  },
});
