import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import type { ImportReport } from '@scout/core';
import { openStore, recomputeRollups } from '@scout/core';
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

async function startServer(opts: { scan?: () => Promise<ImportReport> } = {}) {
  const store = openStore(':memory:');
  seed(store.db);
  const server = createServer({ db: store.db, host: '127.0.0.1', port: 0, ...opts });
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
        endpoints: [
          '/api/sessions',
          '/api/sessions/stats',
          '/api/sessions/{id}',
          '/api/harnesses',
          '/api/scan',
        ],
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

describe('createServer /api/scan', () => {
  const report: ImportReport = {
    perAdapter: {
      fake: { discovered: 2, imported: 1, skipped: 1, removed: 0, failed: 0 },
    },
    durationMs: 7,
  };

  type ServeConfig = {
    hostname: string;
    port: number;
    idleTimeout?: number;
    fetch: (req: Request, server: Bun.Server<unknown>) => Response | Promise<Response>;
  };

  /**
   * Wraps `Bun.serve` for one test to observe the transport config
   * `createServer` passes (F1) while the real transport still serves requests.
   * The handler's per-request `server` argument is replaced with a recorder so
   * the `server.timeout(req, 0)` call is observable too.
   */
  function captureServeConfig() {
    const globalBun = Bun as unknown as {
      serve: (options: ServeConfig) => Bun.Server<unknown>;
    };
    const original = globalBun.serve;
    let idleTimeout: number | undefined;
    const timeoutSeconds: number[] = [];
    globalBun.serve = (options) => {
      idleTimeout = options.idleTimeout;
      const handler = options.fetch;
      return original({
        ...options,
        fetch: (req) =>
          handler(req, {
            timeout: (_req: Request, seconds: number) => {
              timeoutSeconds.push(seconds);
            },
          } as unknown as Bun.Server<unknown>),
      });
    };
    return {
      idleTimeout: () => idleTimeout,
      timeoutSeconds,
      restore: () => {
        globalBun.serve = original;
      },
    };
  }

  test('F1: disables Bun idleTimeout and opts the scan request out of it', async () => {
    const capture = captureServeConfig();
    try {
      const { store, server, base } = await startServer({ scan: async () => report });
      try {
        // The default 10s idle timeout would close a large scan mid-await.
        expect(capture.idleTimeout()).toBe(0);
        const res = await fetch(`${base}/api/scan`, { method: 'POST' });
        expect(res.status).toBe(200);
        // `server.timeout(req, 0)` runs before the import is awaited.
        expect(capture.timeoutSeconds).toEqual([0]);
      } finally {
        server.stop();
        store.close();
      }
    } finally {
      capture.restore();
    }
  });

  test('F1: a slow scan that has not written bytes completes instead of being reset', async () => {
    const scan = async (): Promise<ImportReport> => {
      await Bun.sleep(50);
      return report;
    };
    const { store, server, base } = await startServer({ scan });
    try {
      const res = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(report);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('POST /api/scan runs the injected scan callback and returns its ImportReport', async () => {
    let calls = 0;
    const scan = async (): Promise<ImportReport> => {
      calls += 1;
      return report;
    };
    const { store, server, base } = await startServer({ scan });
    try {
      const res = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual(report);
      expect(calls).toBe(1);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('F2: a concurrent POST while a scan is in flight returns 409 { error: scan in progress }', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    const scan = async (): Promise<ImportReport> => {
      calls += 1;
      entered();
      await gate;
      return report;
    };
    const { store, server, base } = await startServer({ scan });
    try {
      const first = fetch(`${base}/api/scan`, { method: 'POST' });
      // Wait until the first handler owns the lock before firing the second.
      await started;
      const second = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: 'scan in progress' });
      // The rejected POST never reached the scan callback.
      expect(calls).toBe(1);

      release();
      const firstRes = await first;
      expect(firstRes.status).toBe(200);
      expect(await firstRes.json()).toEqual(report);

      // The lock was released in `finally`: a fresh POST runs again.
      const third = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(third.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      release();
      server.stop();
      store.close();
    }
  });

  test('a report with an adapter error returns 500 with the report, not a false 200', async () => {
    const failedReport: ImportReport = {
      perAdapter: {
        fake: {
          discovered: 1,
          imported: 0,
          skipped: 0,
          removed: 0,
          failed: 0,
          error: 'probe failed',
        },
      },
      durationMs: 4,
    };
    const { store, server, base } = await startServer({ scan: async () => failedReport });
    try {
      const res = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'one or more imports failed',
        report: failedReport,
      });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('a report with failed bundles (failed > 0) returns 500, not a false 200', async () => {
    const failedReport: ImportReport = {
      perAdapter: {
        fake: { discovered: 2, imported: 1, skipped: 0, removed: 0, failed: 1 },
      },
      durationMs: 5,
    };
    const { store, server, base } = await startServer({ scan: async () => failedReport });
    try {
      const res = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'one or more imports failed',
        report: failedReport,
      });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('returns 503 { error: scan unavailable } when no scan callback was injected', async () => {
    const { store, server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'scan unavailable' });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('a non-POST on /api/scan returns 405 with an Allow: POST header', async () => {
    const scan = async (): Promise<ImportReport> => report;
    const { store, server, base } = await startServer({ scan });
    try {
      const res = await fetch(`${base}/api/scan`);
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(await res.json()).toEqual({ error: 'method not allowed' });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('F2: a throwing scan callback returns 500 and releases the lock for the next POST', async () => {
    let calls = 0;
    const scan = async (): Promise<ImportReport> => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return report;
    };
    const { store, server, base } = await startServer({ scan });
    try {
      const res = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'internal error' });

      // The throw path clears the lock too, so the next scan is not a 409.
      const retry = await fetch(`${base}/api/scan`, { method: 'POST' });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual(report);
      expect(calls).toBe(2);
    } finally {
      server.stop();
      store.close();
    }
  });
});

describe('createServer /api/sessions/stats', () => {
  type RootSeed = {
    startedAt: string | null;
    durationMs: number | null;
    costUsd: number | null;
    model: string;
    uncachedInput?: number;
    cachedInput?: number;
    cacheWrite?: number;
    output?: number;
    reasoningOutput?: number;
  };

  function insertRoot(db: Database, id: string, opts: RootSeed) {
    db.run(
      `INSERT INTO sessions (
         id, harness_id, project_key, parent_id, depth, title, model_primary_id, started_at,
         duration_ms, cost_usd, uncached_input, cached_input, cache_write, output,
         reasoning_output, source_path, source_size, source_mtime
       ) VALUES (?, 'fake', 'p1', NULL, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [
        id,
        modelId(db, opts.model),
        opts.startedAt,
        opts.durationMs,
        opts.costUsd,
        opts.uncachedInput ?? 0,
        opts.cachedInput ?? 0,
        opts.cacheWrite ?? 0,
        opts.output ?? 0,
        opts.reasoningOutput ?? 0,
        `/fake/${id}.jsonl`,
      ],
    );
  }

  /**
   * Three roots — r1 (tokens + a token-bearing child whose model r1 does not
   * use directly), r2, r3 (no started_at/duration/cost) — plus rollups.
   */
  async function startStatsServer() {
    const store = openStore(':memory:');
    // Harness + project only (unlike `seed`, no extra root session).
    store.db.run(
      'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
      ['fake', 'Fake', '1.0.0', '[]'],
    );
    store.db.run('INSERT INTO projects (key, name, identity) VALUES (?, ?, ?)', [
      'p1',
      'Project One',
      'cwd',
    ]);
    insertRoot(store.db, 'fake:r1', {
      startedAt: '2024-01-02T00:00:00Z',
      durationMs: 3_600_000,
      costUsd: 2.5,
      model: 'm1',
      uncachedInput: 100,
      cachedInput: 10,
      cacheWrite: 5,
      output: 1000,
      reasoningOutput: 50,
    });
    store.db.run(
      `INSERT INTO sessions (
         id, harness_id, project_key, parent_id, depth, title, model_primary_id,
         uncached_input, cached_input, cache_write, output, reasoning_output,
         source_path, source_size, source_mtime
       ) VALUES ('fake:r1/child', 'fake', 'p1', 'fake:r1', 0, NULL, ?,
                 20, 2, 1, 200, 10, '/fake/child.jsonl', 1, 1)`,
      [modelId(store.db, 'm-child')],
    );
    insertRoot(store.db, 'fake:r2', {
      startedAt: '2024-01-03T00:00:00Z',
      durationMs: 1_800_000,
      costUsd: 1,
      model: 'm2',
      uncachedInput: 10,
      output: 100,
    });
    insertRoot(store.db, 'fake:r3', {
      startedAt: null,
      durationMs: null,
      costUsd: null,
      model: 'm3',
    });
    recomputeRollups(store.db);
    const server = createServer({ db: store.db, host: '127.0.0.1', port: 0 });
    return { store, server, base: `http://127.0.0.1:${server.port}` };
  }

  test('returns full-filtered-set aggregates: totals, inclusive tokens, avg, series', async () => {
    const { store, server, base } = await startStatsServer();
    try {
      const res = await fetch(`${base}/api/sessions/stats`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({
        totalSessions: 3,
        totalCostUsd: 3.5,
        // r1 inclusive (own + child) 120/12/6/1200/60 = 1398, plus r2 110.
        totalTokens: 1508,
        avgDurationMs: 2_700_000,
        // r3 has no started_at, so only two day buckets (ascending).
        series: [
          { date: '2024-01-02', sessions: 1 },
          { date: '2024-01-03', sessions: 1 },
        ],
      });
    } finally {
      server.stop();
      store.close();
    }
  });

  test('aggregates ignore pagination: full totals even when the list page is 1 row', async () => {
    const { store, server, base } = await startStatsServer();
    try {
      const page = (await (await fetch(`${base}/api/sessions?limit=1`)).json()) as {
        items: unknown[];
        total: number;
      };
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(3);

      const stats = (await (await fetch(`${base}/api/sessions/stats`)).json()) as {
        totalSessions: number;
        totalCostUsd: number;
      };
      expect(stats.totalSessions).toBe(3);
      expect(stats.totalCostUsd).toBe(3.5);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('honors every filter param with the same semantics as the list', async () => {
    const { store, server, base } = await startStatsServer();
    try {
      const totals = async (query: string) =>
        (await (await fetch(`${base}/api/sessions/stats${query}`)).json()) as {
          totalSessions: number;
          totalCostUsd: number;
        };

      // durationMin is inclusive (r1 = 60m, r2 = 30m) and excludes NULL (r3).
      expect((await totals('?durationMin=30')).totalSessions).toBe(2);
      // costOnly excludes NULL/0 cost (r3), leaving r1 + r2.
      expect((await totals('?costOnly=true')).totalSessions).toBe(2);
      const costOnly = await totals('?costOnly=true');
      expect(costOnly.totalCostUsd).toBe(3.5);
      // startedAfter is exclusive; only r2 starts later (r3 NULL excluded).
      expect((await totals('?startedAfter=2024-01-02T12:00:00Z')).totalSessions).toBe(1);
      // harness exact (all roots are 'fake').
      expect((await totals('?harness=fake')).totalSessions).toBe(3);
      // model matches a descendant-only model, so r1 is included.
      expect((await totals('?model=m-child')).totalSessions).toBe(1);
      // q matches the project-name fallback (titles are NULL) -> all 3.
      expect((await totals('?q=Project')).totalSessions).toBe(3);
    } finally {
      server.stop();
      store.close();
    }
  });

  test('rejects limit/offset/sort (not filter params) and unknown/duplicate params', async () => {
    const { store, server, base } = await startStatsServer();
    try {
      const expect400 = async (query: string, parameter: string) => {
        const res = await fetch(`${base}/api/sessions/stats${query}`);
        expect(res.status, query).toBe(400);
        expect(await res.json(), query).toEqual({
          error: 'invalid query parameter',
          parameter,
        });
      };

      await expect400('?limit=10', 'limit');
      await expect400('?offset=0', 'offset');
      await expect400('?sort=name', 'sort');
      await expect400('?foo=1', 'foo');
      await expect400('?limit=1&limit=2', 'limit');
      await expect400('?harness=', 'harness');
      await expect400('?model=', 'model');
      await expect400('?q=%20', 'q');
      await expect400('?durationMin=0', 'durationMin');
      await expect400('?costOnly=bogus', 'costOnly');
      await expect400('?startedAfter=not-a-date', 'startedAfter');
    } finally {
      server.stop();
      store.close();
    }
  });

  test('a non-GET returns 405 with Allow: GET (not swallowed by the {id} route)', async () => {
    const { store, server, base } = await startStatsServer();
    try {
      const res = await fetch(`${base}/api/sessions/stats`, { method: 'POST' });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
      expect(await res.json()).toEqual({ error: 'method not allowed' });
    } finally {
      server.stop();
      store.close();
    }
  });
});
