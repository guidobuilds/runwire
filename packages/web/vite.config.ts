import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Single `/api` proxy to the API-only server, preserving the `/api/...`
      // path exactly (no rewrite). The SPA (routes like `/sessions`, `/`) is
      // served by Vite itself; only `/api/*` reaches @scout/server.
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
