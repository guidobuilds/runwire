import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { openStore } from '@runwire/core';
import { createServer } from './createServer';

function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}

function seed(db: Database): void {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['test', 'Test', '1.0.0', '[]'],
  );
  const session = (
    id: string,
    parentId: string | null,
    fields: {
      agentType?: string | null;
      startedAt?: string | null;
      durationMs?: number | null;
      costUsd?: number | null;
      model?: string | null;
    } = {},
  ) =>
    db.run(
      `INSERT INTO sessions (
         id, harness_id, parent_id, relation, source_path, title,
         agent_type, started_at, duration_ms, cost_usd, model_primary_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        'test',
        parentId,
        parentId === null ? null : 'subagent',
        `/private/${id}`,
        `SECRET ${id} TITLE`,
        fields.agentType ?? null,
        fields.startedAt ?? null,
        fields.durationMs ?? null,
        fields.costUsd ?? null,
        fields.model == null ? null : modelId(db, fields.model),
      ],
    );

  session('root', null, { model: 'model-root' });
  session('root/child', 'root', {
    agentType: 'worker',
    startedAt: '2024-01-01T00:00:05.000Z',
    durationMs: 60000,
    costUsd: 0.25,
    model: 'model-child',
  });
  session('root/child/grand', 'root/child', { startedAt: '2024-01-01T00:00:06.000Z' });
  session('outside', null);

  const step = (
    sessionId: string,
    seq: number,
    fields: { uncached?: number | null; cached?: number | null; cacheWrite?: number | null },
  ) =>
    db.run(
      `INSERT INTO steps (
         session_id, seq, kind, uncached_input, cached_input, cache_write
       ) VALUES (?, ?, 'call', ?, ?, ?)`,
      [sessionId, seq, fields.uncached ?? null, fields.cached ?? null, fields.cacheWrite ?? null],
    );

  step('root', 1, { uncached: 100, cached: 50, cacheWrite: 0 });
  step('root', 2, {});
  step('root/child', 1, { uncached: 40 });
  step('root/child/grand', 1, { uncached: 0, cached: 10, cacheWrite: 0 });
  step('outside', 1, { uncached: 9999 });
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const store = openStore(':memory:');
  seed(store.db);
  const server = createServer({ db: store.db, host: '127.0.0.1', port: 0 });
  try {
    await run(`http://127.0.0.1:${String(server.port)}`);
  } finally {
    server.stop();
    store.close();
  }
}

// biome-ignore lint/suspicious/noExplicitAny: test-only loose JSON shape, mirrors profile-v2.test.ts.
async function body(base: string, path: string): Promise<{ response: Response; json: any }> {
  const response = await fetch(`${base}${path}`);
  return { response, json: await response.json() };
}

describe('GET /api/sessions/{id}/profile/context', () => {
  test('happy path: own vs pooled tree metrics and own-only descendant rows', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/root/profile/context');
      expect(response.status).toBe(200);
      expect(json.view).toBe('context');
      expect(json.sessionId).toBe('root');

      expect(json.own).toEqual({
        observedCalls: 1,
        promptInput: 150,
        avgPromptInput: 150,
        p95PromptInput: 150,
        peakPromptInput: 150,
        cacheReadShare: 50 / 150,
      });
      expect(json.tree).toEqual({
        observedCalls: 3,
        promptInput: 200,
        avgPromptInput: 200 / 3,
        p95PromptInput: 150,
        peakPromptInput: 150,
        cacheReadShare: 60 / 200,
      });

      expect(json.descendants).toHaveLength(2);
      const [child, grand] = json.descendants;
      expect(child).toMatchObject({
        id: 'root/child',
        parentId: 'root',
        relativeDepth: 1,
        agentType: 'worker',
        startedAt: '2024-01-01T00:00:05.000Z',
        durationMs: 60000,
        modelPrimary: 'model-child',
        costUsd: 0.25,
        metrics: {
          observedCalls: 1,
          promptInput: 40,
          avgPromptInput: 40,
          p95PromptInput: 40,
          peakPromptInput: 40,
          cacheReadShare: 0,
        },
      });
      expect(grand).toMatchObject({
        id: 'root/child/grand',
        parentId: 'root/child',
        relativeDepth: 2,
        agentType: null,
        durationMs: null,
        modelPrimary: null,
        costUsd: null,
        metrics: { observedCalls: 1, promptInput: 10, cacheReadShare: 1 },
      });

      const text = JSON.stringify(json);
      for (const key of ['title', 'cwd', 'git', 'args', 'prompt']) {
        expect(text).not.toContain(`"${key}"`);
      }
      expect(text).not.toContain('SECRET');
      expect(text).not.toContain('/private/');
    });
  });

  test('a leaf session has an empty descendants list', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(
        base,
        '/api/sessions/root%2Fchild%2Fgrand/profile/context',
      );
      expect(response.status).toBe(200);
      expect(json.sessionId).toBe('root/child/grand');
      expect(json.descendants).toEqual([]);
      expect(json.own.observedCalls).toBe(1);
    });
  });

  test('slash ids resolve: both a literal slash and %2F keep the whole remainder', async () => {
    await withServer(async (base) => {
      const literal = await body(base, '/api/sessions/root/child/profile/context');
      const encoded = await body(base, '/api/sessions/root%2Fchild/profile/context');
      expect(literal.response.status).toBe(200);
      expect(encoded.response.status).toBe(200);
      expect(literal.json.sessionId).toBe('root/child');
      expect(encoded.json.sessionId).toBe('root/child');
      expect(literal.json.descendants.map((d: { id: string }) => d.id)).toEqual([
        'root/child/grand',
      ]);
    });
  });

  test('404 on a missing session', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/missing/profile/context');
      expect(response.status).toBe(404);
      expect(json).toEqual({ error: 'session not found' });
    });
  });

  test('strict empty param set: every query parameter is rejected', async () => {
    await withServer(async (base) => {
      const cases: Array<[string, string]> = [
        ['?scope=own', 'scope'],
        ['?scope=tree', 'scope'],
        ['?wat=1', 'wat'],
        ['?scope=own&scope=tree', 'scope'],
      ];
      for (const [query, parameter] of cases) {
        const { response, json } = await body(base, `/api/sessions/root/profile/context${query}`);
        expect(response.status, query).toBe(400);
        expect(json).toEqual({ error: 'invalid query parameter', parameter });
      }
    });
  });

  test('400 on a malformed percent-encoded id', async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/sessions/%E0%A4%A/profile/context`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid id' });
    });
  });

  test('405 for a non-GET request with Allow: GET', async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/sessions/root/profile/context`, {
        method: 'POST',
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(await response.json()).toEqual({ error: 'method not allowed' });
    });
  });
});
