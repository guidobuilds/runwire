import { expect, test } from 'bun:test';
import type { AdapterContext } from '@scout/core';
import { createBunFs, ScoutStore } from '@scout/core';
import { createFakeAdapter } from '@scout/core/test-kit';
import { createApp } from './app';
import { startServer } from './serve';

// Persistent runtime guard (user decision (b), 2026-08-30): a real Bun.serve
// binding, not just app.request(...), so a future edit that drops the
// explicit hostname argument fails this test instead of only being caught by
// a one-off adversary review.
test('startServer binds to 127.0.0.1 explicitly and answers a real request', async () => {
  const ctx: AdapterContext = {
    home: '/fake',
    platform: 'linux',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
  const store = new ScoutStore([createFakeAdapter()], ctx, { projectIdentity: 'cwd' });
  const { server, url, stop } = startServer({
    app: createApp(store, ctx),
    port: 0, // let Bun pick a free port
    hostname: '127.0.0.1',
  });

  try {
    expect(server.hostname).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
    expect(url.startsWith('http://127.0.0.1:')).toBe(true);

    const res = await fetch(new URL('/api/status', url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adapters: unknown[] };
    expect(Array.isArray(body.adapters)).toBe(true);
  } finally {
    stop();
  }
});
