import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { openStore } from '@scout/core';
import { createServer } from './createServer';

/** Idempotently upserts a raw model string and returns its `models.id`. */
function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}

function seed(db: Database) {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['fake', 'Fake', '1.0.0', '[]'],
  );
  db.run('INSERT INTO projects (key, name, identity) VALUES (?, ?, ?)', [
    'p1',
    'Project One',
    'cwd',
  ]);
  db.run(
    `INSERT INTO sessions (
       id, harness_id, project_key, parent_id, depth, title, model_primary_id, started_at,
       duration_ms, cost_usd, uncached_input, api_calls, source_path, source_size, source_mtime
     ) VALUES (?, 'fake', 'p1', ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      'fake:root1',
      null,
      modelId(db, 'root-model'),
      '2024-01-02T00:00:00Z',
      3_600_000,
      2.5,
      100,
      3,
      '/fake/root1.jsonl',
    ],
  );
  // A subagent whose id contains a literal '/'.
  db.run(
    `INSERT INTO sessions (
       id, harness_id, project_key, parent_id, depth, title, model_primary_id,
       uncached_input, api_calls, source_path, source_size, source_mtime
     ) VALUES (?, 'fake', 'p1', ?, 0, NULL, ?, ?, ?, ?, 1, 1)`,
    [
      'fake:root1/child',
      'fake:root1',
      modelId(db, 'child-model'),
      20,
      2,
      '/fake/root1-child.jsonl',
    ],
  );
}

async function startServer() {
  const store = openStore(':memory:');
  seed(store.db);
  const server = createServer({ db: store.db, host: '127.0.0.1', port: 0 });
  // fetch needs a concrete origin; use the server's bound port.
  const base = `http://127.0.0.1:${server.port}`;
  return { store, server, base };
}

describe('createServer', () => {
  test('GET /api returns service info', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        service: 'scout',
        endpoints: ['/api/sessions', '/api/sessions/{id}', '/api/harnesses'],
      });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('GET /api/sessions returns { items, total, limit, offset } with root sessions only', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/sessions`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as {
        items: { id: string }[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(body.total).toBe(1);
      expect(body.items.map((s) => s.id)).toEqual(['fake:root1']);
      // Effective (defaulted) limit/offset are echoed.
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('valid filters and pagination round-trip through HTTP', async () => {
    const { store, server, base } = await startServer();
    try {
      // harness filter (exact), model filter, startedAfter, limit/offset.
      const res = await fetch(
        `${base}/api/sessions?harness=fake&model=root-model&startedAfter=2024-01-01T00:00:00Z&limit=10&offset=0`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { id: string }[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(body.total).toBe(1);
      expect(body.items.map((s) => s.id)).toEqual(['fake:root1']);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(0);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('data-layer params round-trip: q/durationMin/costOnly/sort/harness reach listSessions', async () => {
    const { store, server, base } = await startServer();
    try {
      const insertRoot = (
        id: string,
        title: string | null,
        projectKey: string | null,
        durationMs: number,
        costUsd: number,
        startedAt: string,
        model: string,
      ) => {
        store.db.run(
          `INSERT INTO sessions (
             id, harness_id, project_key, parent_id, depth, title, model_primary_id, started_at,
             duration_ms, cost_usd, uncached_input, api_calls, source_path, source_size, source_mtime
           ) VALUES (?, 'fake', ?, NULL, 0, ?, ?, ?, ?, ?, 0, 0, ?, 1, 1)`,
          [
            id,
            projectKey,
            title,
            modelId(store.db, model),
            startedAt,
            durationMs,
            costUsd,
            `/fake/${id}.jsonl`,
          ],
        );
      };
      // A matching second root whose later started_at means the DEFAULT order
      // would put it first; `sort=-duration` must reverse that.
      insertRoot('fake:root2', null, 'p1', 1_800_000, 1, '2024-01-03T00:00:00Z', 'm2');
      // Each of these fails exactly one new filter:
      insertRoot('fake:other-q', 'Other', null, 3_600_000, 1, '2024-01-01T00:00:00Z', 'm3');
      insertRoot('fake:other-duration', null, 'p1', 0, 1, '2024-01-01T00:00:00Z', 'm4');
      insertRoot('fake:other-cost', null, 'p1', 3_600_000, 0, '2024-01-01T00:00:00Z', 'm5');

      const res = await fetch(
        `${base}/api/sessions?durationMin=30&costOnly=true&q=project&sort=-duration&harness=fake`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { id: string }[];
        total: number;
      };
      // `durationMin=30` is inclusive (root2 is exactly 30m) and `q=project`
      // matches root1/root2 via the project name; the other three roots fail.
      expect(body.total).toBe(2);
      expect(body.items.map((s) => s.id)).toEqual(['fake:root1', 'fake:root2']);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('costOnly=false is accepted and applies no cost filter', async () => {
    const { store, server, base } = await startServer();
    try {
      // A zero-cost root would be excluded by costOnly=true but not by false.
      store.db.run(
        `INSERT INTO sessions (
           id, harness_id, project_key, parent_id, depth, title, started_at,
           duration_ms, cost_usd, uncached_input, api_calls, source_path, source_size, source_mtime
         ) VALUES ('fake:free', 'fake', NULL, NULL, 0, 'Free', '2024-01-01T00:00:00Z', 0, 0, 0, 0, '/fake/free.jsonl', 1, 1)`,
      );
      const res = await fetch(`${base}/api/sessions?costOnly=false`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { id: string }[] };
      expect(body.items.map((s) => s.id).sort()).toEqual(['fake:free', 'fake:root1']);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('GET /api/sessions/{id} returns { session } for a root', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/sessions/fake:root1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: { id: string; childCount: number } };
      expect(body.session.id).toBe('fake:root1');
      expect(body.session.childCount).toBe(1);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('GET /api/sessions/{id} serves a /-containing subagent id (whole remainder)', async () => {
    const { store, server, base } = await startServer();
    try {
      // The raw path has a literal '/' inside the id; it must resolve, not 404.
      const res = await fetch(`${base}/api/sessions/fake:root1/child`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: { id: string; parent: { id: string } | null } };
      expect(body.session.id).toBe('fake:root1/child');
      expect(body.session.parent?.id).toBe('fake:root1');
    } finally {
      server.stop();
      store.close();
    }
  });

  test('GET /api/sessions/{id} returns 404 for a miss', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/sessions/fake:missing`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: 'session not found' });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('GET /api/sessions/{id} returns 400 for an undecodable id', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/sessions/%E0%A4%A`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: 'invalid id' });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('a non-GET on a known path returns 405 with an Allow: GET header and no CORS', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/sessions`, { method: 'POST' });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      const body = await res.json();
      expect(body).toEqual({ error: 'method not allowed' });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('the legacy root and un-prefixed session paths are not exposed (404)', async () => {
    const { store, server, base } = await startServer();
    try {
      for (const legacy of [
        '/',
        '/sessions',
        '/sessions/',
        '/sessions/fake:root1',
        '/session-profiles',
        '/session-profiles/',
        '/session-profiles/fake:root1',
        '/nope',
        '/api/nope',
      ]) {
        const res = await fetch(`${base}${legacy}`);
        expect(res.status, legacy).toBe(404);
        const body = await res.json();
        expect(body, legacy).toEqual({ error: 'not found' });
      }
      // Neither prefix nor slug: /api alone is service info, /api/sessions is list.
      expect((await fetch(`${base}/api/sessions`)).status).toBe(200);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('no CORS header is emitted on any response', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api`);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      server.stop();
      store.close();
    }
  });
});

describe('createServer /api/sessions query-param strictness', () => {
  async function expect400(query: string, parameter: string) {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/sessions${query}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; parameter: string };
      expect(body).toEqual({ error: 'invalid query parameter', parameter });
    } finally {
      server.stop();
      store.close();
    }
  }

  test('an unknown query param returns 400', async () => {
    await expect400('?foo=1', 'foo');
  });

  test('a duplicate query param returns 400', async () => {
    await expect400('?limit=10&limit=20', 'limit');
  });

  test('limit out of range or non-integer returns 400', async () => {
    await expect400('?limit=0', 'limit');
    await expect400('?limit=201', 'limit');
    await expect400('?limit=abc', 'limit');
    await expect400('?limit=', 'limit');
    await expect400('?limit=10.5', 'limit');
  });

  test('offset negative or non-integer returns 400', async () => {
    await expect400('?offset=-1', 'offset');
    await expect400('?offset=abc', 'offset');
    await expect400('?offset=', 'offset');
  });

  test('an invalid startedAfter returns 400, not 500', async () => {
    await expect400('?startedAfter=not-a-date', 'startedAfter');
  });

  test('an empty harness or model returns 400', async () => {
    await expect400('?harness=', 'harness');
    await expect400('?model=', 'model');
  });

  test('q empty or whitespace-only returns 400', async () => {
    await expect400('?q=', 'q');
    await expect400('?q=%20', 'q');
  });

  test('durationMin 0, negative or non-integer returns 400', async () => {
    await expect400('?durationMin=0', 'durationMin');
    await expect400('?durationMin=-1', 'durationMin');
    await expect400('?durationMin=abc', 'durationMin');
  });

  test('costOnly other than true/false returns 400', async () => {
    await expect400('?costOnly=bogus', 'costOnly');
    await expect400('?costOnly=1', 'costOnly');
    await expect400('?costOnly=', 'costOnly');
  });

  test('sort outside the whitelist (or wrong case) returns 400', async () => {
    await expect400('?sort=bogus', 'sort');
    await expect400('?sort=startedat', 'sort');
    await expect400('?sort=', 'sort');
  });

  test('a harness comma list with an empty segment returns 400', async () => {
    await expect400('?harness=a,,b', 'harness');
  });

  test('a valid sort field is accepted (200)', async () => {
    const { store, server, base } = await startServer();
    try {
      for (const sort of ['name', '-harness', 'startedAt', 'duration', '-tokens', 'cost']) {
        const res = await fetch(`${base}/api/sessions?sort=${sort}`);
        expect(res.status, sort).toBe(200);
      }
    } finally {
      server.stop();
      store.close();
    }
  });

  test('GET /api/sessions/{id} with a query string still returns 200 (unchanged)', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/sessions/fake:root1?foo=1&bar=baz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { session: { id: string } };
      expect(body.session.id).toBe('fake:root1');
    } finally {
      server.stop();
      store.close();
    }
  });
});

describe('createServer /api/harnesses', () => {
  test('GET /api/harnesses returns harnesses that have root sessions', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/harnesses`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual([{ id: 'fake', displayName: 'Fake' }]);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('any query param on /api/harnesses returns 400', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/harnesses?foo=1`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid query parameter', parameter: 'foo' });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('a non-GET on /api/harnesses returns 405 with an Allow: GET header', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/harnesses`, { method: 'POST' });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
      expect(await res.json()).toEqual({ error: 'method not allowed' });
    } finally {
      server.stop();
      store.close();
    }
  });
});
