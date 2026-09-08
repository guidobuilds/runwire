import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { openStore } from '@scout/core';
import { createServer } from './createServer';

function seed(db: Database): void {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['test', 'Test', '1.0.0', '[]'],
  );
  const session = (id: string, parentId: string | null, output: number, title: string) =>
    db.run(
      'INSERT INTO sessions (id, harness_id, parent_id, relation, source_path, output, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        'test',
        parentId,
        parentId === null ? null : 'subagent',
        '/private/' + id,
        output,
        title,
      ],
    );
  session('root', null, 10, 'SECRET ROOT TITLE');
  session('root/child', 'root', 20, 'SECRET CHILD TITLE');
  db.run('UPDATE sessions SET spawn_call_id = ? WHERE id = ?', ['spawn-1', 'root/child']);
  session('root%2Fchild', null, 30, 'SECRET PERCENT TITLE');
  session('%41', null, 40, 'SECRET PERCENT LETTER TITLE');
  session('A', null, 50, 'SECRET LETTER TITLE');
  session('outside', null, 60, 'SECRET OUTSIDE TITLE');

  db.run('INSERT INTO steps (session_id, seq, kind, model, at, output) VALUES (?, ?, ?, ?, ?, ?)', [
    'root',
    1,
    'call',
    'root-model',
    '2024-01-01T00:00:00Z',
    10,
  ]);
  db.run('INSERT INTO steps (session_id, seq, kind, model, at, output) VALUES (?, ?, ?, ?, ?, ?)', [
    'root/child',
    1,
    'call',
    'child-model',
    '2024-01-01T00:00:01Z',
    20,
  ]);
  db.run(
    "INSERT INTO steps (session_id, seq, kind, tool_category, tool_name, call_id, child_id, at) VALUES (?, ?, 'tool', 'agent', ?, ?, ?, ?)",
    ['root', 2, 'Task', 'spawn-1', 'root/child', '2024-01-01T00:00:02Z'],
  );
  db.run(
    "INSERT INTO steps (session_id, seq, kind, tool_category, tool_name, at) VALUES (?, ?, 'tool', 'read', ?, ?)",
    ['root/child', 2, 'Read', '2024-01-01T00:00:03Z'],
  );
  db.run('INSERT INTO steps (session_id, seq, kind, model, at, output) VALUES (?, ?, ?, ?, ?, ?)', [
    'outside',
    1,
    'call',
    'outside-model',
    '2024-01-01T00:00:00Z',
    60,
  ]);
}

async function withServer(run: (base: string, db: Database) => Promise<void>): Promise<void> {
  const store = openStore(':memory:');
  seed(store.db);
  const server = createServer({ db: store.db, host: '127.0.0.1', port: 0 });
  try {
    await run('http://127.0.0.1:' + String(server.port), store.db);
  } finally {
    server.stop();
    store.close();
  }
}

type TestJson = {
  [key: string]: unknown;
  view: string;
  scope: string;
  field: string;
  filter: string;
  sessionId: string;
  error: string;
  parameter: string;
  items: [
    { child: { id: string }; childInScope: boolean },
    ...Array<{ child: { id: string }; childInScope: boolean }>,
  ];
  nodes: Array<{ id: string }>;
  session: { id: string };
};

async function body(base: string, path: string): Promise<{ response: Response; json: TestJson }> {
  const response = await fetch(`${base}${path}`);
  return { response, json: (await response.json()) as TestJson };
}

function expectJson(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected);
}

describe('GET /api/sessions/{id}/profile/{projection}', () => {
  test('dispatches spawns/signals/timeline/merged, returning metadata-only allowlisted keys', async () => {
    await withServer(async (base) => {
      const spawns = await body(base, '/api/sessions/root/profile/spawns');
      expect(spawns.response.status).toBe(200);
      expect(spawns.response.headers.get('access-control-allow-origin')).toBeNull();
      expect(spawns.json.view).toBe('spawns');
      expect(spawns.json.items).toHaveLength(1);
      expect(spawns.json.items[0].child.id).toBe('root/child');
      expect(JSON.stringify(spawns.json)).not.toContain('SECRET');
      expect(JSON.stringify(spawns.json)).not.toContain('/private/');

      const signals = await body(base, '/api/sessions/root/profile/signals');
      expect(signals.response.status).toBe(200);
      expect(signals.json.view).toBe('signals');
      expect(signals.json.scope).toBe('tree');

      const timeline = await body(base, '/api/sessions/root/profile/timeline');
      expect(timeline.response.status).toBe(200);
      expect(timeline.json.view).toBe('timeline');
      expect(timeline.json.field).toBe('output');

      const merged = await body(base, '/api/sessions/root/profile/events');
      expect(merged.response.status).toBe(200);
      expect(merged.json.view).toBe('merged');
      expect(merged.json.filter).toBe('signals');
    });
  });

  test('dispatches distinct session-scoped profile endpoints without a view query', async () => {
    await withServer(async (base) => {
      const spawns = await body(base, '/api/sessions/root/profile/spawns');
      expect(spawns.response.status).toBe(200);
      expect(spawns.json.view).toBe('spawns');

      const signals = await body(base, '/api/sessions/root/profile/signals?scope=own');
      expect(signals.response.status).toBe(200);
      expect(signals.json.view).toBe('signals');
      expect(signals.json.scope).toBe('own');

      const timeline = await body(base, '/api/sessions/root/profile/timeline?field=cacheWrite');
      expect(timeline.response.status).toBe(200);
      expect(timeline.json.view).toBe('timeline');
      expect(timeline.json.field).toBe('cacheWrite');

      const events = await body(base, '/api/sessions/root/profile/events?filter=all&limit=5');
      expect(events.response.status).toBe(200);
      expect(events.json.view).toBe('merged');
      expect(events.json.filter).toBe('all');
      expect(events.json.limit).toBe(5);
    });
  });

  test('own scope excludes descendants without changing child spawn context', async () => {
    await withServer(async (base) => {
      const spawns = await body(base, '/api/sessions/root/profile/spawns?scope=own');
      expect(spawns.json.nodes.map((node: { id: string }) => node.id)).toEqual(['root']);
      expect(spawns.json.items[0].child.id).toBe('root/child');
      expect(spawns.json.items[0].childInScope).toBe(false);
    });
  });

  test('treats the whole remainder as the id and decodes it exactly once', async () => {
    await withServer(async (base) => {
      expect((await body(base, '/api/sessions/root%2Fchild/profile/spawns')).json.sessionId).toBe(
        'root/child',
      );
      expect((await body(base, '/api/sessions/root%252Fchild/profile/spawns')).json.sessionId).toBe(
        'root%2Fchild',
      );
      expect((await body(base, '/api/sessions/%41/profile/spawns')).json.sessionId).toBe('A');
      expect((await body(base, '/api/sessions/%2541/profile/spawns')).json.sessionId).toBe('%41');

      const suffix = await body(base, '/api/sessions/root/spawns/profile/spawns');
      expect(suffix.response.status).toBe(404);
      expectJson(suffix.json, { error: 'session not found' });
    });
  });

  test('returns exact errors for invalid ids, misses, methods and internal failures', async () => {
    await withServer(async (base, db) => {
      const malformed = await body(base, '/api/sessions/%E0%A4%A/profile/spawns');
      expect(malformed.response.status).toBe(400);
      expectJson(malformed.json, { error: 'invalid id' });
      const legacy = await body(base, '/api/session-profiles/root?view=spawns');
      expect(legacy.response.status).toBe(404);
      expectJson(legacy.json, { error: 'not found' });
      const missing = await body(base, '/api/sessions/missing/profile/spawns');
      expect(missing.response.status).toBe(404);
      expectJson(missing.json, { error: 'session not found' });

      const method = await fetch(`${base}/api/sessions/root/profile/spawns`, {
        method: 'POST',
      });
      expect(method.status).toBe(405);
      expect(method.headers.get('allow')).toBe('GET');
      expect(method.headers.get('access-control-allow-origin')).toBeNull();
      expect(await method.json()).toEqual({ error: 'method not allowed' });

      db.close();
      const failed = await body(base, '/api/sessions/root/profile/spawns');
      expect(failed.response.status).toBe(500);
      expectJson(failed.json, { error: 'internal error' });
      expect(Object.keys(failed.json)).toEqual(['error']);
    });
  });

  test('/api exposes both existing sessions endpoints', async () => {
    await withServer(async (base) => {
      expect((await body(base, '/api/sessions')).response.status).toBe(200);
      const child = await body(base, '/api/sessions/root/child?ignored=still-compatible');
      expect(child.response.status).toBe(200);
      expect(child.json.session.id).toBe('root/child');
      // The legacy un-prefixed path must not expose the API.
      expect((await body(base, '/sessions')).response.status).toBe(404);
    });
  });
});

describe('session profile query strictness', () => {
  test('rejects unknown, duplicate, empty, unsafe and out-of-range params', async () => {
    await withServer(async (base) => {
      const cases: Array<[string, string, string]> = [
        ['/profile/spawns', '?wat=1', 'wat'],
        ['/profile/spawns', '?scope=tree&scope=own', 'scope'],
        ['/profile/spawns', '?view=spawns', 'view'],
        ['/profile/spawns', '?scope=', 'scope'],
        ['/profile/spawns', '?laneId=root', 'laneId'],
        ['/profile/spawns', '?streamId=root', 'streamId'],
        ['/profile/spawns', '?limit=0', 'limit'],
        ['/profile/spawns', '?limit=201', 'limit'],
        ['/profile/spawns', '?limit=1.5', 'limit'],
        ['/profile/spawns', '?offset=-2', 'offset'],
        ['/profile/signals', '?field=output', 'field'],
        ['/profile/timeline', '?filter=all', 'filter'],
        ['/profile/timeline', '?field=', 'field'],
        ['/profile/timeline', '?field=madeUp', 'field'],
        ['/profile/events', '?field=output', 'field'],
        ['/profile/events', '?filter=', 'filter'],
        ['/profile/events', '?filter=madeUp', 'filter'],
        ['/profile/events', '?limit=0', 'limit'],
        ['/profile/events', '?limit=201', 'limit'],
      ];
      for (const [endpoint, query, parameter] of cases) {
        const result = await body(base, `/api/sessions/root${endpoint}${query}`);
        expect(result.response.status, `${endpoint}${query}`).toBe(400);
        expectJson(result.json, { error: 'invalid query parameter', parameter });
      }
    });
  });

  test('accepts exact boundaries and every view-specific enum', async () => {
    await withServer(async (base) => {
      for (const path of [
        '/api/sessions/root/profile/spawns?limit=1&offset=9007199254740991',
        '/api/sessions/root/profile/spawns?limit=200&offset=0',
        '/api/sessions/root/profile/timeline?field=reasoningOutput',
        '/api/sessions/root/profile/events?filter=all&limit=200',
      ]) {
        expect((await body(base, path)).response.status, path).toBe(200);
      }
      for (const filter of [
        'relevant',
        'signals',
        'all',
        'mcp',
        'skill',
        'hook',
        'read',
        'write',
        'exec',
        'agent',
        'error',
      ]) {
        expect(
          (await body(base, `/api/sessions/root/profile/events?filter=${filter}`)).response.status,
        ).toBe(200);
      }
    });
  });
});
