import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The router plugin must run before the React plugin so the generated route
// tree and the code-split route modules exist before JSX is transformed.
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    // `scout serve` binds 127.0.0.1:7423 (apps/scout/src/commands/serve.ts DEFAULT_PORT).
    proxy: { '/api': 'http://127.0.0.1:7423' },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
