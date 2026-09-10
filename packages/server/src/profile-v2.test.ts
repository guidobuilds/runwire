import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { openStore } from '@scout/core';
import { createServer } from './createServer';

/** Idempotently upserts a raw model string and returns its `models.id`. */
function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}

/**
 * A richer fixture than profile.test.ts's: a root + child tree with
 * compactions (auto/manual/unknown trigger), a model-change, an mcp call, a
 * skill call, a read tool call, an agent spawn (root -> child), and one
 * null-`at` call step (for excludedNullAtCount), plus an unrelated
 * `outside` session that must never leak into tree-scoped aggregates.
 */
function seed(db: Database): void {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['test', 'Test', '1.0.0', '[]'],
  );
  const session = (id: string, parentId: string | null, title: string) =>
    db.run(
      'INSERT INTO sessions (id, harness_id, parent_id, relation, source_path, title) VALUES (?, ?, ?, ?, ?, ?)',
      [id, 'test', parentId, parentId === null ? null : 'subagent', '/private/' + id, title],
    );
  session('root', null, 'SECRET ROOT TITLE');
  session('root/child', 'root', 'SECRET CHILD TITLE');
  db.run('UPDATE sessions SET spawn_call_id = ? WHERE id = ?', ['spawn-1', 'root/child']);
  session('outside', null, 'SECRET OUTSIDE TITLE');

  const step = (sessionId: string, seq: number, fields: Record<string, string | number | null>) => {
    db.run(
      'INSERT INTO steps (session_id, seq, kind, model_id, at, output, tool_category, tool_name, call_id, child_id, compaction_trigger, from_value, to_value, skill_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        sessionId,
        seq,
        fields.kind ?? null,
        typeof fields.model === 'string' ? modelId(db, fields.model) : null,
        fields.at ?? null,
        fields.output ?? null,
        fields.tool_category ?? null,
        fields.tool_name ?? null,
        fields.call_id ?? null,
        fields.child_id ?? null,
        fields.compaction_trigger ?? null,
        fields.from_value ?? null,
        fields.to_value ?? null,
        fields.skill_name ?? null,
      ],
    );
  };

  step('root', 1, { kind: 'call', model: 'model-a', at: '2024-01-01T00:00:00.000Z', output: 10 });
  step('root', 2, {
    kind: 'tool',
    tool_category: 'agent',
    tool_name: 'Task',
    call_id: 'spawn-1',
    child_id: 'root/child',
    at: '2024-01-01T00:00:02.000Z',
  });
  step('root', 3, {
    kind: 'compaction',
    compaction_trigger: 'auto',
    at: '2024-01-01T00:00:03.000Z',
  });
  step('root', 4, {
    kind: 'compaction',
    compaction_trigger: 'manual',
    at: '2024-01-01T00:00:04.000Z',
  });
  step('root', 5, { kind: 'compaction', compaction_trigger: null, at: '2024-01-01T00:00:05.000Z' });
  step('root', 6, {
    kind: 'model-change',
    from_value: 'model-a',
    to_value: 'model-b',
    at: '2024-01-01T00:00:06.000Z',
  });
  step('root', 7, {
    kind: 'tool',
    tool_category: 'mcp',
    tool_name: 'mcp__plugin_engram_engram__mem_save',
    at: '2024-01-01T00:00:07.000Z',
  });
  step('root', 8, {
    kind: 'tool',
    tool_category: 'skill',
    tool_name: 'Skill',
    skill_name: 'pdf-skill',
    at: '2024-01-01T00:00:08.000Z',
  });
  step('root', 9, {
    kind: 'tool',
    tool_category: 'read',
    tool_name: 'Read',
    at: '2024-01-01T00:00:09.000Z',
  });

  step('root/child', 1, {
    kind: 'call',
    model: 'model-b',
    at: '2024-01-01T00:00:01.000Z',
    output: 20,
  });
  step('root/child', 2, {
    kind: 'tool',
    tool_category: 'read',
    tool_name: 'Read',
    model: 'model-b',
    at: '2024-01-01T00:00:03.500Z',
  });
  step('root/child', 3, { kind: 'call', model: 'model-a', at: null, output: 5 });

  step('outside', 1, {
    kind: 'call',
    model: 'outside-model',
    at: '2024-01-01T00:00:00.000Z',
    output: 60,
  });
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

// biome-ignore lint/suspicious/noExplicitAny: test-only loose JSON shape, mirrors profile.test.ts's TestJson relaxation.
async function body(base: string, path: string): Promise<{ response: Response; json: any }> {
  const response = await fetch(`${base}${path}`);
  return { response, json: await response.json() };
}

// 'output' is deliberately excluded here: it is the legitimate TokenField key
// (a token *count*, e.g. `series[].totals.output`) that every usage/timeline
// response carries, not raw tool-call output content. Views whose `Event`
// items never declare an `output` field (merged/events) get the stricter
// check below instead.
const METADATA_KEYS = ['title', 'cwd', 'git', 'args', 'prompt'];

function assertMetadataOnly(json: unknown): void {
  const text = JSON.stringify(json);
  for (const key of METADATA_KEYS) {
    expect(text).not.toContain(`"${key}`);
  }
  expect(text).not.toContain('SECRET');
  expect(text).not.toContain('/private/');
}

/** Stricter check for Event-item views: no title/cwd/git/args/output/prompt
 * key anywhere, since `Event`'s kind-specific fields never include `output`. */
function assertEventsMetadataOnly(json: unknown): void {
  assertMetadataOnly(json);
  expect(JSON.stringify(json)).not.toContain('"output"');
}

describe('GET /api/sessions/{id}/profile/signals', () => {
  test('happy path: tree scope aggregates compactions/model-changes/mcp/skill', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/root/profile/signals');
      expect(response.status).toBe(200);
      expect(json.view).toBe('signals');
      expect(json.scope).toBe('tree');
      expect(json.sessionId).toBe('root');
      expect(json.compactions).toEqual({ auto: 1, manual: 1, unknown: 1 });
      expect(json.modelChanges).toBe(1);
      expect(json.toolCalls).toEqual({ total: 5, mcp: 1 });
      expect(json.mcpServers).toEqual(['plugin_engram_engram']);
      expect(json.skillCalls).toBe(1);
      expect(json.skillNames).toEqual(['pdf-skill']);
      assertMetadataOnly(json);
    });
  });

  test('own vs tree scope differ', async () => {
    await withServer(async (base) => {
      const own = await body(base, '/api/sessions/root/profile/signals?scope=own');
      expect(own.json.toolCalls).toEqual({ total: 4, mcp: 1 });
      const tree = await body(base, '/api/sessions/root/profile/signals?scope=tree');
      expect(tree.json.toolCalls).toEqual({ total: 5, mcp: 1 });
    });
  });

  test('404 on missing root', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/missing/profile/signals');
      expect(response.status).toBe(404);
      expect(json).toEqual({ error: 'session not found' });
    });
  });

  test('strict param rejection', async () => {
    await withServer(async (base) => {
      const cases: Array<[string, string]> = [
        ['?wat=1', 'wat'],
        ['?field=output', 'field'],
        ['?scope=own&scope=tree', 'scope'],
        ['?scope=', 'scope'],
        ['?scope=madeUp', 'scope'],
      ];
      for (const [query, parameter] of cases) {
        const { response, json } = await body(base, `/api/sessions/root/profile/signals${query}`);
        expect(response.status, query).toBe(400);
        expect(json).toEqual({ error: 'invalid query parameter', parameter });
      }
    });
  });
});

describe('GET /api/sessions/{id}/profile/timeline', () => {
  test('happy path: default field=output, tree-wide chronological series', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/root/profile/timeline');
      expect(response.status).toBe(200);
      expect(json.view).toBe('timeline');
      expect(json.scope).toBe('tree');
      expect(json.field).toBe('output');
      expect(json.sessionId).toBe('root');
      // 3 call steps in tree scope; 1 has at IS NULL.
      expect(json.excludedNullAtCount).toBe(1);
      expect(json.points).toHaveLength(2);
      expect(json.points.map((p: { at: string }) => p.at)).toEqual([
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:01.000Z',
      ]);
      expect(Array.isArray(json.series)).toBe(true);
      assertMetadataOnly(json);
    });
  });

  test('field selection changes totals', async () => {
    await withServer(async (base) => {
      const output = await body(base, '/api/sessions/root/profile/timeline?field=output');
      const uncached = await body(base, '/api/sessions/root/profile/timeline?field=uncachedInput');
      expect(output.json.points[0].totalDelta).toBe(10);
      expect(uncached.json.points[0].totalDelta).toBe(null);
    });
  });

  test('own vs tree scope differ', async () => {
    await withServer(async (base) => {
      const own = await body(base, '/api/sessions/root/profile/timeline?scope=own');
      expect(own.json.points).toHaveLength(1);
      const tree = await body(base, '/api/sessions/root/profile/timeline?scope=tree');
      expect(tree.json.points).toHaveLength(2);
    });
  });

  test('404 on missing root', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/missing/profile/timeline');
      expect(response.status).toBe(404);
      expect(json).toEqual({ error: 'session not found' });
    });
  });

  test('strict param rejection including out-of-range/bad enum field', async () => {
    await withServer(async (base) => {
      const cases: Array<[string, string]> = [
        ['?wat=1', 'wat'],
        ['?filter=all', 'filter'],
        ['?field=', 'field'],
        ['?field=madeUp', 'field'],
        ['?scope=', 'scope'],
        ['?scope=own&scope=tree', 'scope'],
      ];
      for (const [query, parameter] of cases) {
        const { response, json } = await body(base, `/api/sessions/root/profile/timeline${query}`);
        expect(response.status, query).toBe(400);
        expect(json).toEqual({ error: 'invalid query parameter', parameter });
      }
    });
  });

  test('accepts every TokenField', async () => {
    await withServer(async (base) => {
      for (const field of [
        'uncachedInput',
        'cachedInput',
        'cacheWrite',
        'output',
        'reasoningOutput',
      ]) {
        const { response } = await body(base, `/api/sessions/root/profile/timeline?field=${field}`);
        expect(response.status, field).toBe(200);
      }
    });
  });
});

describe('GET /api/sessions/{id}/profile/events', () => {
  test('happy path: signals is the default filter, chronological merge across sessions', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/root/profile/events');
      expect(response.status).toBe(200);
      expect(json.view).toBe('merged');
      expect(json.scope).toBe('tree');
      expect(json.filter).toBe('signals');
      expect(json.sessionId).toBe('root');
      expect(json.limit).toBe(50);
      expect(json.offset).toBe(0);
      // signals = error OR compaction OR model-change OR tool in (mcp, skill, agent):
      // root has 3 compactions + 1 model-change + agent + mcp + skill = 7 rows, all timed.
      expect(json.items).toHaveLength(7);
      expect(json.total).toBe(7);
      expect(json.excludedNullAtCount).toBe(0);
      const streamIds = json.items.map((item: { streamId: string }) => item.streamId);
      expect(streamIds).toEqual(['root', 'root', 'root', 'root', 'root', 'root', 'root']);
      // items ordered by `at` ASC
      const ats = json.items.map((item: { at: string }) => item.at);
      expect([...ats].sort()).toEqual(ats);
      assertEventsMetadataOnly(json);
    });
  });

  test('all filter merges chronologically across sessions with a null-at excluded and counted', async () => {
    await withServer(async (base) => {
      const { json } = await body(base, '/api/sessions/root/profile/events?filter=all');
      // root: 9 rows, root/child: 3 rows (1 with at IS NULL) => 11 timed + 1 excluded.
      expect(json.items).toHaveLength(11);
      expect(json.total).toBe(11);
      expect(json.excludedNullAtCount).toBe(1);
      const ats = json.items.map((item: { at: string }) => item.at);
      expect([...ats].sort()).toEqual(ats);
      // Confirm true cross-session interleaving: root/child's read at :03.5
      // sits between root's compaction(auto) at :03 and compaction(manual) at :04.
      const idxChildRead = json.items.findIndex(
        (item: { streamId: string; kind: string }) =>
          item.streamId === 'root/child' && item.kind === 'tool',
      );
      const idxAuto = json.items.findIndex(
        (item: { kind: string; trigger: string }) =>
          item.kind === 'compaction' && item.trigger === 'auto',
      );
      const idxManual = json.items.findIndex(
        (item: { kind: string; trigger: string }) =>
          item.kind === 'compaction' && item.trigger === 'manual',
      );
      expect(idxAuto).toBeLessThan(idxChildRead);
      expect(idxChildRead).toBeLessThan(idxManual);
    });
  });

  test('tool rows carry the source step model under filter=all (value and null)', async () => {
    await withServer(async (base) => {
      const { json } = await body(base, '/api/sessions/root/profile/events?filter=all');
      const tools = json.items.filter((item: { kind: string }) => item.kind === 'tool');
      const childRead = tools.find(
        (item: { streamId: string; toolName: string }) =>
          item.streamId === 'root/child' && item.toolName === 'Read',
      );
      const rootRead = tools.find(
        (item: { streamId: string; toolName: string }) =>
          item.streamId === 'root' && item.toolName === 'Read',
      );
      expect(childRead.model).toBe('model-b');
      expect(rootRead.model).toBe(null);
    });
  });

  test('pagination via limit/offset', async () => {
    await withServer(async (base) => {
      const page1 = await body(
        base,
        '/api/sessions/root/profile/events?filter=all&limit=5&offset=0',
      );
      expect(page1.json.items).toHaveLength(5);
      const page2 = await body(
        base,
        '/api/sessions/root/profile/events?filter=all&limit=5&offset=5',
      );
      expect(page2.json.items).toHaveLength(5);
      expect(page1.json.items[0].seq).not.toBe(page2.json.items[0].seq);
    });
  });

  test('404 on missing root', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/missing/profile/events');
      expect(response.status).toBe(404);
      expect(json).toEqual({ error: 'session not found' });
    });
  });

  test('strict param rejection: unknown/duplicate/empty/bad enum/out-of-range', async () => {
    await withServer(async (base) => {
      const cases: Array<[string, string]> = [
        ['?wat=1', 'wat'],
        ['?field=output', 'field'],
        ['?filter=', 'filter'],
        ['?filter=madeUp', 'filter'],
        ['?limit=limit&limit=1', 'limit'],
        ['?limit=0', 'limit'],
        ['?limit=201', 'limit'],
        ['?limit=1.5', 'limit'],
        ['?limit=-1', 'limit'],
        ['?offset=-1', 'offset'],
        ['?offset=9007199254740992', 'offset'],
        ['?offset=1.5', 'offset'],
      ];
      for (const [query, parameter] of cases) {
        const { response, json } = await body(base, `/api/sessions/root/profile/events${query}`);
        expect(response.status, query).toBe(400);
        expect(json).toEqual({ error: 'invalid query parameter', parameter });
      }
    });
  });

  test('accepts exact boundaries and every EventFilter enum', async () => {
    await withServer(async (base) => {
      for (const path of [
        '/api/sessions/root/profile/events?limit=1&offset=9007199254740991',
        '/api/sessions/root/profile/events?limit=200&offset=0',
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
        const { response } = await body(base, `/api/sessions/root/profile/events?filter=${filter}`);
        expect(response.status, filter).toBe(200);
      }
    });
  });
});

describe('GET /api/sessions/{id}/profile/models', () => {
  test('happy path: own vs descendant output-token shares', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/root/profile/models');
      expect(response.status).toBe(200);
      expect(json.view).toBe('models');
      expect(json.sessionId).toBe('root');
      // Own group: only root's kind='call' step (model-a, output 10).
      expect(json.session).toEqual({
        outputTokens: 10,
        models: [{ model: 'model-a', outputTokens: 10, share: 1 }],
      });
      // Descendants: root/child's two call steps only (model-b 20, model-a 5);
      // the tool step's model is ignored and the unrelated `outside` session
      // never leaks into the tree.
      expect(json.descendants).toEqual({
        outputTokens: 25,
        models: [
          { model: 'model-b', outputTokens: 20, share: 0.8 },
          { model: 'model-a', outputTokens: 5, share: 0.2 },
        ],
      });
      assertMetadataOnly(json);
    });
  });

  test('a leaf session has an empty descendants group', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/root%2Fchild/profile/models');
      expect(response.status).toBe(200);
      expect(json.sessionId).toBe('root/child');
      expect(json.session).toEqual({
        outputTokens: 25,
        models: [
          { model: 'model-b', outputTokens: 20, share: 0.8 },
          { model: 'model-a', outputTokens: 5, share: 0.2 },
        ],
      });
      expect(json.descendants).toEqual({ outputTokens: 0, models: [] });
    });
  });

  test('404 on missing root', async () => {
    await withServer(async (base) => {
      const { response, json } = await body(base, '/api/sessions/missing/profile/models');
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
        const { response, json } = await body(base, `/api/sessions/root/profile/models${query}`);
        expect(response.status, query).toBe(400);
        expect(json).toEqual({ error: 'invalid query parameter', parameter });
      }
    });
  });

  test('405 for a non-GET request with Allow: GET', async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/sessions/root/profile/models`, { method: 'POST' });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET');
      expect(await response.json()).toEqual({ error: 'method not allowed' });
    });
  });
});
