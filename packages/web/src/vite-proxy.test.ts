import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('vite dev proxy (/api)', () => {
  it('forwards exactly one /api path to the API-only server', () => {
    const config = viteConfig as UserConfig;
    const proxy = config.server?.proxy;
    expect(proxy).toEqual({ '/api': 'http://127.0.0.1:8787' });
  });
});
