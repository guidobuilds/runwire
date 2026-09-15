import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

// The dev server is API-only under `/api` (api-prefix). Vite must forward a
// single `/api` path to @runwire/server, preserving the `/api/...` path (no
// rewrite), while the SPA keeps owning `/` and its `/sessions*` pages.
describe('vite dev proxy (/api)', () => {
  it('forwards exactly one /api path to the API-only server', () => {
    const config = viteConfig as UserConfig;
    const proxy = config.server?.proxy;
    expect(proxy).toEqual({ '/api': 'http://127.0.0.1:8787' });
  });
});
