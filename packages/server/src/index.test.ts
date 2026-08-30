import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createClaudeCodeAdapter } from '@scout/adapter-claude-code';
import type { AdapterContext } from '@scout/core';
import { createBunFs, ScoutStore } from '@scout/core';
import { createFakeAdapter } from '@scout/core/test-kit';
import { createApp } from './app';

// Fake-adapter route tests (f2-t9). Per .forge/lessons.md's
// fake-adapter-shared-fixture entry: fake-adapter.ts is a shared fixture that
// f1 (built in parallel) also adds scenarios to. Assertions below therefore
// pin specific ids/shapes ('fake:root', 'fake:child1') and documented edge
// behaviors, never exact session/child counts of the fixture.

function fakeContext(): AdapterContext {
  return {
    home: '/fake',
    platform: 'linux',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function scannedApp() {
  const ctx = fakeContext();
  const store = new ScoutStore([createFakeAdapter()], ctx, { projectIdentity: 'cwd' });
  await store.rescan();
  return { app: createApp(store, ctx), store, ctx };
}

describe('GET /api/status', () => {
  test('lists the registered adapter and null lastReport before any scan', async () => {
    const ctx = fakeContext();
    const store = new ScoutStore([createFakeAdapter()], ctx, { projectIdentity: 'cwd' });
    const app = createApp(store, ctx);

    const res = await app.request('/api/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      lastReport: unknown;
      adapters: Array<{ id: string; probe: { installed: boolean } }>;
    };
    expect(body.lastReport).toBeNull();
    const fake = body.adapters.find((a) => a.id === 'fake');
    expect(fake).toBeDefined();
    expect(fake?.probe.installed).toBe(true);
  });

  test('reflects the last report after a scan', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/status');
    const body = (await res.json()) as { lastReport: { perAdapter: Record<string, unknown> } };
    expect(body.lastReport?.perAdapter.fake).toBeDefined();
  });
});

describe('POST /api/rescan', () => {
  test('runs a scan and returns a ScanReport shape', async () => {
    const ctx = fakeContext();
    const store = new ScoutStore([createFakeAdapter()], ctx, { projectIdentity: 'cwd' });
    const app = createApp(store, ctx);

    const res = await app.request('/api/rescan', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      startedAt: string;
      perAdapter: Record<string, { discovered: number; failed: number }>;
      diagnostics: unknown[];
    };
    expect(typeof body.startedAt).toBe('string');
    expect(body.perAdapter.fake?.discovered).toBeGreaterThan(0);
    expect(body.perAdapter.fake?.failed).toBe(0);
    expect(Array.isArray(body.diagnostics)).toBe(true);
  });

  test('coalesces two concurrent calls into one scan (same report, not two overlapping scans)', async () => {
    const ctx = fakeContext();
    const store = new ScoutStore([createFakeAdapter()], ctx, { projectIdentity: 'cwd' });
    const app = createApp(store, ctx);

    // Both requests are issued before either is awaited: the handler sets its
    // in-flight promise synchronously (before its first await), so the
    // second call is guaranteed to observe it already set.
    const [res1, res2] = await Promise.all([
      app.request('/api/rescan', { method: 'POST' }),
      app.request('/api/rescan', { method: 'POST' }),
    ]);
    const [body1, body2] = (await Promise.all([res1.json(), res2.json()])) as [
      { startedAt: string },
      { startedAt: string },
    ];
    expect(body1.startedAt).toBe(body2.startedAt);
  });
});

describe('GET /api/projects and /api/projects/:key/sessions', () => {
  test('projects is a non-empty array of aggregates', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ project: { key: string }; sessionCount: number }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('a real project key returns its root summaries + rollups', async () => {
    const { app, store } = await scannedApp();
    const root = store.getSession('fake:root');
    if (!root) throw new Error("expected 'fake:root' to be present after a scan");

    const res = await app.request(`/api/projects/${encodeURIComponent(root.project.key)}/sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summaries: Array<{ id: string }>;
      rollups: Record<string, unknown>;
    };
    expect(body.summaries.length).toBeGreaterThan(0);
    expect(body.summaries.some((s) => s.id === 'fake:root')).toBe(true);
    expect(body.rollups['fake:root']).toBeDefined();
  });

  test('an unknown project key returns empty arrays, not 404', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/projects/no-such-project/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: unknown[]; rollups: Record<string, unknown> };
    expect(body.summaries).toEqual([]);
    expect(body.rollups).toEqual({});
  });
});

describe('GET /api/harnesses and /api/harnesses/:id/sessions', () => {
  test('harnesses is a non-empty array of aggregates including fake', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/harnesses');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ harness: string }>;
    expect(body.some((h) => h.harness === 'fake')).toBe(true);
  });

  test("harness 'fake' returns root summaries + rollups", async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/harnesses/fake/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: Array<{ id: string }> };
    expect(body.summaries.some((s) => s.id === 'fake:root')).toBe(true);
  });

  test('an unknown harness id returns empty arrays, not 404', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/harnesses/no-such-harness/sessions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: unknown[]; rollups: Record<string, unknown> };
    expect(body.summaries).toEqual([]);
    expect(body.rollups).toEqual({});
  });
});

describe('GET /api/sessions/:id', () => {
  test('known root id returns summary, rollup, subtree (root included) and diagnostics', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/sessions/fake:root');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { id: string };
      rollup: { id: string };
      subtree: { summaries: Array<{ id: string }>; rollups: Record<string, unknown> };
      diagnostics: unknown[];
    };
    expect(body.summary.id).toBe('fake:root');
    expect(body.rollup.id).toBe('fake:root');
    const subtreeIds = body.subtree.summaries.map((s) => s.id);
    expect(subtreeIds).toContain('fake:root');
    expect(subtreeIds).toContain('fake:child1'); // root itself is included, per getSubtree's documented behavior
    expect(Array.isArray(body.diagnostics)).toBe(true);
  });

  test('unknown id returns 404 with an error body', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/sessions/fake:does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'session not found' });
  });
});

describe('GET /api/sessions?ids=', () => {
  test('missing ids returns 400', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ids is required' });
  });

  test('known ids come back with rollups and a comparability matrix; unknown ids are dropped silently', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/sessions?ids=fake:root,fake:child1,fake:does-not-exist');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summaries: Array<{ id: string }>;
      rollups: Record<string, unknown>;
      comparability: { rows: unknown[] };
    };
    const ids = body.summaries.map((s) => s.id);
    expect(ids).toContain('fake:root');
    expect(ids).toContain('fake:child1');
    expect(ids).not.toContain('fake:does-not-exist');
    expect(body.rollups['fake:root']).toBeDefined();
    expect(Array.isArray(body.comparability.rows)).toBe(true);
    expect(body.comparability.rows.length).toBeGreaterThan(0);
  });
});

describe('GET /api/sessions/:id/trace', () => {
  test('known id returns a SessionTrace shape', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/sessions/fake:root/trace');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; steps: unknown[] };
    expect(body.id).toBe('fake:root');
    expect(Array.isArray(body.steps)).toBe(true);
  });

  test('unknown id returns 404', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/sessions/fake:does-not-exist/trace');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'trace not found' });
  });
});

describe('GET /api/traces?ids=', () => {
  test('missing ids returns 400', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/traces');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ids is required' });
  });

  test('known ids are keyed by id; unknown ids are dropped silently', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/traces?ids=fake:root,fake:child1,fake:does-not-exist');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { traces: Record<string, { id: string }> };
    expect(body.traces['fake:root']?.id).toBe('fake:root');
    expect(body.traces['fake:child1']?.id).toBe('fake:child1');
    expect(body.traces['fake:does-not-exist']).toBeUndefined();
  });
});

describe('GET /api/diagnostics', () => {
  test('returns an array', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/api/diagnostics');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('GET /* catch-all', () => {
  test('an unmatched path returns the 404 stub', async () => {
    const { app } = await scannedApp();
    const res = await app.request('/not-a-real-path');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

// Real Claude Code fixture route tests (f2-t10). Reuses the
// contextForFixture(name) pattern proven in
// packages/adapter-claude-code/src/index.test.ts.
const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'claude-code');
const SUBAGENTS_ROOT_ID = 'claude-code:5db79557-f2ad-489d-81ee-607606b3a6ef';
const CANARY_SESSION_ID = 'claude-code:canary-session';
const CANARY_SENTINEL = 'SCOUT_CANARY_';

function fixtureContext(name: string): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function fixtureApp(name: string) {
  const ctx = fixtureContext(name);
  const store = new ScoutStore([createClaudeCodeAdapter()], ctx);
  await store.rescan();
  return { app: createApp(store, ctx), store, ctx };
}

describe('real Claude Code fixtures', () => {
  test('subagents fixture: GET /api/projects returns non-empty aggregates', async () => {
    const { app } = await fixtureApp('subagents');
    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('subagents fixture: GET /api/sessions/:id returns the subtree with the subagent present', async () => {
    const { app } = await fixtureApp('subagents');
    const res = await app.request(`/api/sessions/${SUBAGENTS_ROOT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { id: string };
      rollup: { id: string; descendants: number };
      subtree: { summaries: Array<{ id: string; relation?: string }> };
    };
    expect(body.summary.id).toBe(SUBAGENTS_ROOT_ID);
    expect(body.rollup.descendants).toBeGreaterThan(0);
    expect(body.subtree.summaries.some((s) => s.relation === 'subagent')).toBe(true);
  });

  test('canary fixture: GET /api/sessions/:id/trace never leaks the canary sentinel', async () => {
    const { app } = await fixtureApp('canary');
    const res = await app.request(`/api/sessions/${CANARY_SESSION_ID}/trace`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(CANARY_SENTINEL);
  });
});
