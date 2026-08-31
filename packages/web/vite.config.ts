import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The router plugin must run before the React plugin so the generated route
// tree and the code-split route modules exist before JSX is transformed.
export default defineConfig({
  plugins: [
    // `routeFileIgnorePattern` keeps `src/routes/*.test.tsx` out of route
    // generation. Without it the plugin warns on every run that a test file
    // "does not export a Route"; the generated tree is the same either way.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.test\\.tsx?$',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    // `scout serve` binds 127.0.0.1:7423 (apps/scout/src/commands/serve.ts DEFAULT_PORT).
    proxy: { '/api': 'http://127.0.0.1:7423' },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
