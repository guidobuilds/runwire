import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { getSession, getSessionsStats, listHarnesses, listSessions } from './read';
import { recomputeRollups } from './rollups';
import { openStore } from './store';

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
}

/** Idempotently upserts a raw model string and returns its `models.id`. */
function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}

type SessionSeed = {
  parentId?: string;
  projectKey?: string | null;
  title?: string | null;
  modelPrimary?: string | null;
  startedAt?: string | null;
  durationMs?: number | null;
  harnessId?: string;
  turns?: number | null;
  apiCalls?: number | null;
  toolCalls?: number | null;
  compactions?: number | null;
  costUsd?: number | null;
  uncachedInput?: number | null;
  cachedInput?: number | null;
  cacheWrite?: number | null;
  output?: number | null;
  reasoningOutput?: number | null;
};

function insertSession(db: Database, id: string, opts: SessionSeed = {}) {
  db.run(
    `INSERT INTO sessions (
       id, harness_id, project_key, parent_id, depth, title, model_primary_id,
       started_at, duration_ms, turns, api_calls, tool_calls, compactions, cost_usd,
       uncached_input, cached_input, cache_write, output, reasoning_output,
       source_path, source_size, source_mtime
     ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      id,
      opts.harnessId ?? 'fake',
      opts.projectKey === undefined ? 'p1' : opts.projectKey,
      opts.parentId ?? null,
      opts.title ?? null,
      opts.modelPrimary == null ? null : modelId(db, opts.modelPrimary),
      opts.startedAt ?? null,
      opts.durationMs ?? null,
      opts.turns ?? null,
      opts.apiCalls ?? null,
      opts.toolCalls ?? null,
      opts.compactions ?? null,
      opts.costUsd ?? null,
      opts.uncachedInput ?? null,
      opts.cachedInput ?? null,
      opts.cacheWrite ?? null,
      opts.output ?? null,
      opts.reasoningOutput ?? null,
      `/fake/${id}.jsonl`,
    ],
  );
}

function insertCallStep(db: Database, sessionId: string, seq: number, model: string) {
  db.run('INSERT INTO steps (session_id, seq, kind, model_id) VALUES (?, ?, ?, ?)', [
    sessionId,
    seq,
    'call',
    modelId(db, model),
  ]);
}

describe('listSessions', () => {
  test('returns roots only, sorted by started_at DESC id, with correct accounting', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // root1 (later start) + root2 (earlier start) are roots; child1 and grandchild are descendants.
    insertSession(db, 'fake:root1', {
      modelPrimary: 'root-model',
      startedAt: '2024-01-02T00:00:00Z',
      turns: 4,
      apiCalls: 3,
      toolCalls: 2,
      compactions: 1,
      costUsd: 1.25,
      uncachedInput: 100,
      cachedInput: 10,
      cacheWrite: 5,
      output: 1000,
      reasoningOutput: 50,
    });
    insertSession(db, 'fake:root2', {
      projectKey: null,
      modelPrimary: 'root2-model',
      startedAt: '2024-01-01T00:00:00Z',
    });
    insertSession(db, 'fake:root1/child', {
      parentId: 'fake:root1',
      modelPrimary: 'child-model',
      turns: 2,
      apiCalls: 2,
      toolCalls: 1,
      compactions: 0,
      uncachedInput: 20,
      cachedInput: 2,
      cacheWrite: 1,
      output: 200,
      reasoningOutput: 10,
    });
    insertSession(db, 'fake:root1/child/grand', {
      parentId: 'fake:root1/child',
      modelPrimary: 'grand-model',
      turns: 1,
      apiCalls: 1,
      toolCalls: 1,
      compactions: 0,
      uncachedInput: 5,
      cachedInput: 1,
      cacheWrite: 0,
      output: 50,
      reasoningOutput: 5,
    });
    insertCallStep(db, 'fake:root1', 0, 'root-model');
    insertCallStep(db, 'fake:root1', 1, 'root-model2');
    insertCallStep(db, 'fake:root1/child', 0, 'child-model');
    insertCallStep(db, 'fake:root1/child/grand', 0, 'grand-model');
    recomputeRollups(db);

    const { items, total } = listSessions(db);

    // Roots only, sorted by started_at DESC.
    expect(items.map((s) => s.id)).toEqual(['fake:root1', 'fake:root2']);
    // total is the pre-pagination COUNT of the filtered root set.
    expect(total).toBe(2);

    const root1 = items[0]!;
    expect(root1.name).toBe('Project One'); // title NULL -> project.name
    expect(root1.title).toBeNull();
    expect(root1.harness).toEqual({ id: 'fake', displayName: 'Fake', adapterVersion: '1.0.0' });
    expect(root1.project).toEqual({ key: 'p1', name: 'Project One' });
    expect(root1.parentId).toBeNull();
    expect(root1.childCount).toBe(1); // child1
    expect(root1.descendantCount).toBe(2); // child1 + grandchild
    // own models = root's own steps + model_primary; descendants = descendant models.
    expect(root1.modelsOwn).toEqual(['root-model', 'root-model2']);
    expect(root1.modelsDescendants).toEqual(['child-model', 'grand-model']);
    expect(root1.tokensOwn).toEqual({
      uncachedInput: 100,
      cachedInput: 10,
      cacheWrite: 5,
      output: 1000,
      reasoningOutput: 50,
    });
    expect(root1.tokensInclusive).toEqual({
      uncachedInput: 125,
      cachedInput: 13,
      cacheWrite: 6,
      output: 1250,
      reasoningOutput: 65,
    });
    expect(root1.apiCallsOwn).toBe(3);
    expect(root1.apiCallsInclusive).toBe(6);
    expect(root1.toolCallsOwn).toBe(2);
    expect(root1.toolCallsInclusive).toBe(4);
    expect(root1.compactionsOwn).toBe(1);
    expect(root1.compactionsInclusive).toBe(1);
    expect(root1.turnsOwn).toBe(4);
    // There is no inclusive turns field (rollups has no turns column).
    expect('turnsInclusive' in root1).toBe(false);
    expect(root1.costUsd).toBe(1.25);

    const root2 = items[1]!;
    expect(root2.name).toBe('fake:root2'); // title NULL, no project -> id
    expect(root2.project).toBeNull();
    expect(root2.childCount).toBe(0);
    expect(root2.descendantCount).toBe(0);
    expect(root2.modelsOwn).toEqual(['root2-model']);
    expect(root2.modelsDescendants).toEqual([]);
    expect(root2.tokensOwn).toEqual({
      uncachedInput: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      reasoningOutput: 0,
    });

    db.close();
  });
});

describe('listSessions sort order (started_at DESC, id)', () => {
  // Regression for the confirmed defect (verify-009): ITEM_SQL had no ORDER BY,
  // so listSessions returned roots in SQLite insertion (rowid) order. These
  // cases deliberately INVERT the insertion order vs. the original fixture so
  // that a correct sort is the only thing that can make them pass.
  test('inverted insertion order: earlier-starting root inserted first must sort LAST (DESC)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:earlier', { startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:later', { startedAt: '2024-01-02T00:00:00Z' });
    recomputeRollups(db);

    const { items } = listSessions(db);
    expect(items.map((s) => s.id)).toEqual(['fake:later', 'fake:earlier']);
    db.close();
  });

  test('tie on started_at falls back to id ASC', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:zid', { startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:aid', { startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    expect(listSessions(db).items.map((s) => s.id)).toEqual(['fake:aid', 'fake:zid']);
    db.close();
  });

  test('both started_at NULL falls back to id ASC', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:bbb', { startedAt: null });
    insertSession(db, 'fake:aaa', { startedAt: null });
    recomputeRollups(db);

    expect(listSessions(db).items.map((s) => s.id)).toEqual(['fake:aaa', 'fake:bbb']);
    db.close();
  });
});

describe('listSessions filters (harness / startedAfter / model)', () => {
  test('harness filter is exact and case-sensitive on harness_id', () => {
    const { db } = openStore(':memory:');
    seed(db);
    db.run(
      'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
      ['opencode', 'OpenCode', '1.0.0', '[]'],
    );
    insertSession(db, 'fake:cc', { harnessId: 'fake', startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:oc', { harnessId: 'opencode', startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    const { items, total } = listSessions(db, { harness: 'fake' });
    expect(total).toBe(1);
    expect(items.map((s) => s.id)).toEqual(['fake:cc']);

    // Case mismatch (display name, wrong case) => no match.
    expect(listSessions(db, { harness: 'Fake' }).items).toEqual([]);
    db.close();
  });

  test('startedAfter is exclusive, NULL never matches, and a millis-less value is normalized', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // Canonical `.sssZ` stored values (design D-4 invariant).
    insertSession(db, 'fake:bound', { startedAt: '2024-01-01T00:00:00.000Z' });
    insertSession(db, 'fake:after', { startedAt: '2024-01-01T00:00:00.001Z' });
    insertSession(db, 'fake:null', { startedAt: null });
    recomputeRollups(db);

    // Exclusive: the exact-instant session is excluded; the 1-ms-later is included.
    const res = listSessions(db, { startedAfter: '2024-01-01T00:00:00Z' });
    expect(res.items.map((s) => s.id)).toEqual(['fake:after']);
    // A millis-less bound must compare correctly against canonical stored values.
    expect(res.total).toBe(1);
    // NULL started_at never matches even when it is the only other row.
    expect(
      listSessions(db, { startedAfter: '2024-01-01T00:00:00.000Z' }).items.map((s) => s.id),
    ).toEqual(['fake:after']);
    db.close();
  });

  test('model filter matches root own models (model_primary + call steps)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root1', {
      modelPrimary: 'claude-opus-5',
      startedAt: '2024-01-02T00:00:00Z',
    });
    insertSession(db, 'fake:root2', {
      modelPrimary: 'gpt-5.6-sol',
      startedAt: '2024-01-01T00:00:00Z',
    });
    recomputeRollups(db);

    const { items } = listSessions(db, { model: 'claude-opus-5' });
    expect(items.map((s) => s.id)).toEqual(['fake:root1']);
    db.close();
  });

  test('model filter matches a descendant-only model (root OR descendant)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root1', {
      modelPrimary: 'root-model',
      startedAt: '2024-01-02T00:00:00Z',
    });
    insertSession(db, 'fake:root1/child', {
      parentId: 'fake:root1',
      modelPrimary: 'child-model',
      startedAt: '2024-01-02T00:00:01Z',
    });
    insertSession(db, 'fake:root2', {
      modelPrimary: 'other-model',
      startedAt: '2024-01-01T00:00:00Z',
    });
    insertCallStep(db, 'fake:root1/child', 0, 'deep-model');
    recomputeRollups(db);

    // `deep-model` is used only by root1's descendant; root1 must match.
    const { items } = listSessions(db, { model: 'deep-model' });
    expect(items.map((s) => s.id)).toEqual(['fake:root1']);
    db.close();
  });

  test('model filter is exact and case-sensitive (mismatch => no match)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root1', {
      modelPrimary: 'claude-opus-5',
      startedAt: '2024-01-01T00:00:00Z',
    });
    recomputeRollups(db);

    expect(listSessions(db, { model: 'CLAUDE-OPUS-5' }).items).toEqual([]);
    expect(listSessions(db, { model: 'claude-opus-5' }).items.map((s) => s.id)).toEqual([
      'fake:root1',
    ]);
    db.close();
  });
});

describe('listSessions pagination (limit / offset / total-before-pagination)', () => {
  test('limit/offset select a page; total is the pre-pagination count', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // Insert in DESC start order (latest first) so page order is deterministic.
    insertSession(db, 'fake:a', { startedAt: '2024-01-04T00:00:00Z' });
    insertSession(db, 'fake:b', { startedAt: '2024-01-03T00:00:00Z' });
    insertSession(db, 'fake:c', { startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:d', { startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    const page2 = listSessions(db, { limit: 2, offset: 2 });
    expect(page2.total).toBe(4);
    expect(page2.items.map((s) => s.id)).toEqual(['fake:c', 'fake:d']);
    expect(page2.limit).toBe(2);
    expect(page2.offset).toBe(2);
    db.close();
  });

  test('defaults: limit 50, offset 0', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:a', { startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);
    const res = listSessions(db);
    expect(res.limit).toBe(50);
    expect(res.offset).toBe(0);
    db.close();
  });

  test('offset beyond the end yields empty items but the real total', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:a', { startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);
    const res = listSessions(db, { limit: 10, offset: 5 });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(1);
    db.close();
  });

  test('models/childCounts are computed only for the paginated slice', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // Seed > limit roots, each with a distinct subtree model. Page 1 (limit 2)
    // should compute models only for the two roots on that page.
    insertSession(db, 'fake:r1', { modelPrimary: 'm1', startedAt: '2024-01-04T00:00:00Z' });
    insertSession(db, 'fake:r1/c1', { parentId: 'fake:r1', modelPrimary: 'm1-child' });
    insertSession(db, 'fake:r2', { modelPrimary: 'm2', startedAt: '2024-01-03T00:00:00Z' });
    insertSession(db, 'fake:r2/c2', { parentId: 'fake:r2', modelPrimary: 'm2-child' });
    insertSession(db, 'fake:r3', { modelPrimary: 'm3', startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:r3/c3', { parentId: 'fake:r3', modelPrimary: 'm3-child' });
    recomputeRollups(db);

    const page1 = listSessions(db, { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.items.map((s) => s.id)).toEqual(['fake:r1', 'fake:r2']);
    // Page-1 roots carry their own subtree models.
    expect(page1.items.find((s) => s.id === 'fake:r1')!.modelsDescendants).toEqual(['m1-child']);
    expect(page1.items.find((s) => s.id === 'fake:r2')!.modelsDescendants).toEqual(['m2-child']);
    // Page-2 root (r3) is NOT in the response; its subtree model is not computed.
    expect(page1.items.find((s) => s.id === 'fake:r3')).toBeUndefined();
    db.close();
  });
});

describe('getSession', () => {
  test('returns detail for a /-containing subagent id with parent + children', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root1', {
      modelPrimary: 'root-model',
      startedAt: '2024-01-02T00:00:00Z',
      apiCalls: 3,
      uncachedInput: 100,
    });
    insertSession(db, 'fake:root1/child', {
      parentId: 'fake:root1',
      modelPrimary: 'child-model',
      apiCalls: 2,
      uncachedInput: 20,
    });
    insertSession(db, 'fake:root1/child/grand', {
      parentId: 'fake:root1/child',
      modelPrimary: 'grand-model',
      apiCalls: 1,
      uncachedInput: 5,
    });
    insertCallStep(db, 'fake:root1', 0, 'root-model');
    insertCallStep(db, 'fake:root1/child', 0, 'child-model');
    insertCallStep(db, 'fake:root1/child/grand', 0, 'grand-model');
    recomputeRollups(db);

    // A subagent id containing a literal '/' must resolve, not 404.
    const detail = getSession(db, 'fake:root1/child');
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('fake:root1/child');
    expect(detail!.parent?.id).toBe('fake:root1');
    expect(detail!.children.map((c) => c.id)).toEqual(['fake:root1/child/grand']);
    expect(detail!.childCount).toBe(1);
    expect(detail!.descendantCount).toBe(1);
    expect(detail!.modelsOwn).toEqual(['child-model']);
    expect(detail!.modelsDescendants).toEqual(['grand-model']);

    db.close();
  });

  test('returns null for a miss', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root1', { modelPrimary: 'root-model' });
    expect(getSession(db, 'fake:missing')).toBeNull();
    db.close();
  });

  test('a root detail has parent null and children[] as full summaries', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root1', { modelPrimary: 'root-model', uncachedInput: 100 });
    insertSession(db, 'fake:root1/child', {
      parentId: 'fake:root1',
      modelPrimary: 'child-model',
      uncachedInput: 20,
    });
    insertCallStep(db, 'fake:root1', 0, 'root-model');
    insertCallStep(db, 'fake:root1/child', 0, 'child-model');
    recomputeRollups(db);

    const detail = getSession(db, 'fake:root1');
    expect(detail).not.toBeNull();
    expect(detail!.parent).toBeNull();
    expect(detail!.children).toHaveLength(1);
    expect(detail!.children[0]!.id).toBe('fake:root1/child');
    expect(detail!.children[0]!.childCount).toBe(0);
    expect(detail!.children[0]!.modelsOwn).toEqual(['child-model']);

    db.close();
  });
});

/** Adds a harness row; `seed` already inserts `fake`/`Fake`. */
function insertHarness(db: Database, id: string, displayName: string) {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    [id, displayName, '1.0.0', '[]'],
  );
}

describe('listSessions q filter (title / project / id, LIKE escaping)', () => {
  test('q is case-insensitive and matches title, project name, or id', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:title', { title: 'Hello World', startedAt: '2024-01-03T00:00:00Z' });
    // title NULL -> project.name ("Project One")
    insertSession(db, 'fake:project', { title: null, startedAt: '2024-01-02T00:00:00Z' });
    // title NULL + project NULL -> id
    insertSession(db, 'fake:id-only', {
      title: null,
      projectKey: null,
      startedAt: '2024-01-01T00:00:00Z',
    });
    recomputeRollups(db);

    expect(listSessions(db, { q: 'hello' }).items.map((s) => s.id)).toEqual(['fake:title']);
    expect(listSessions(db, { q: 'HELLO WORLD' }).items.map((s) => s.id)).toEqual(['fake:title']);
    // title-null session falls back to project.name
    expect(listSessions(db, { q: 'project one' }).items.map((s) => s.id)).toEqual(['fake:project']);
    // title-null + project-null session falls back to id
    expect(listSessions(db, { q: 'id-only' }).items.map((s) => s.id)).toEqual(['fake:id-only']);
    // total is the real pre-pagination count
    expect(listSessions(db, { q: 'hello' }).total).toBe(1);
    db.close();
  });

  test('q escapes % and _ so they match literally (ESCAPE)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:pct', { title: '100% done', startedAt: '2024-01-03T00:00:00Z' });
    insertSession(db, 'fake:under', { title: 'ab_cd', startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:plain', { title: 'abcX', startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    // '%' is literal: only the title containing '%' matches.
    expect(listSessions(db, { q: '100%' }).items.map((s) => s.id)).toEqual(['fake:pct']);
    // '_' is literal: 'ab_cd' matches, 'abcX' must NOT (an unescaped _ would match it).
    expect(listSessions(db, { q: 'ab_c' }).items.map((s) => s.id)).toEqual(['fake:under']);
    // a literal backslash in the query neither throws nor over-matches
    expect(listSessions(db, { q: '\\' }).items).toEqual([]);
    db.close();
  });

  test('q with offset beyond the filtered total returns empty items without error', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:title', { title: 'Hello World', startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    const res = listSessions(db, { q: 'hello', limit: 10, offset: 5 });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(1);
    expect(res.limit).toBe(10);
    expect(res.offset).toBe(5);
    db.close();
  });
});

describe('listSessions durationMin filter', () => {
  test('durationMin is inclusive, measured in minutes, and excludes NULL duration', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:at', { durationMs: 300000, startedAt: '2024-01-03T00:00:00Z' });
    insertSession(db, 'fake:below', { durationMs: 299999, startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:null', { durationMs: null, startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    const res = listSessions(db, { durationMin: 5 });
    expect(res.items.map((s) => s.id)).toEqual(['fake:at']);
    expect(res.total).toBe(1);
    db.close();
  });
});

describe('listSessions costOnly filter', () => {
  test('costOnly keeps only cost > 0 and excludes 0 and NULL', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:paid', { costUsd: 0.01, startedAt: '2024-01-03T00:00:00Z' });
    insertSession(db, 'fake:zero', { costUsd: 0, startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:null', { costUsd: null, startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    const res = listSessions(db, { costOnly: true });
    expect(res.items.map((s) => s.id)).toEqual(['fake:paid']);
    expect(res.total).toBe(1);
    // false applies no filter at all
    expect(listSessions(db, { costOnly: false }).items).toHaveLength(3);
    db.close();
  });
});

describe('listSessions harness comma-list filter', () => {
  test('single id stays exact/case-sensitive; multiple ids become IN; trims and dedupes', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertHarness(db, 'opencode', 'OpenCode');
    insertSession(db, 'fake:cc', { harnessId: 'fake', startedAt: '2024-01-03T00:00:00Z' });
    insertSession(db, 'oc:one', { harnessId: 'opencode', startedAt: '2024-01-02T00:00:00Z' });
    recomputeRollups(db);

    // unknown + known -> known (the row from the unknown id is simply absent)
    expect(listSessions(db, { harness: 'missing,opencode' }).items.map((s) => s.id)).toEqual([
      'oc:one',
    ]);
    // whitespace trimmed, duplicates removed, order irrelevant
    expect(
      listSessions(db, { harness: ' opencode , fake , fake ' }).items.map((s) => s.id),
    ).toEqual(['fake:cc', 'oc:one']);
    // a single id remains exact and case-sensitive
    expect(listSessions(db, { harness: 'OpenCode' }).items).toEqual([]);
    expect(listSessions(db, { harness: 'opencode' }).items.map((s) => s.id)).toEqual(['oc:one']);
    // an all-empty list applies no filter (safe default; server rejects it)
    expect(listSessions(db, { harness: ' , ' }).items).toHaveLength(2);
    db.close();
  });
});

describe('listSessions sort whitelist', () => {
  test('name sorts case-insensitively by the name expression', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // Inverted insertion vs. LOWER(order): default (id ASC) puts `one` first.
    insertSession(db, 'fake:one', { title: 'Zebra' });
    insertSession(db, 'fake:two', { title: 'apple' });
    recomputeRollups(db);

    expect(listSessions(db).items.map((s) => s.id)).toEqual(['fake:one', 'fake:two']);
    expect(listSessions(db, { sort: 'name' }).items.map((s) => s.id)).toEqual([
      'fake:two',
      'fake:one',
    ]);
    expect(listSessions(db, { sort: '-name' }).items.map((s) => s.id)).toEqual([
      'fake:one',
      'fake:two',
    ]);
    db.close();
  });

  test('harness sorts case-insensitively by display name', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertHarness(db, 'zzz', 'Zulu');
    insertHarness(db, 'aaa', 'alpha');
    // Inverted insertion vs. LOWER(display_name): alpha, Fake, Zulu.
    insertSession(db, 'zzz:root', { harnessId: 'zzz' });
    insertSession(db, 'fake:root', { harnessId: 'fake' });
    insertSession(db, 'aaa:root', { harnessId: 'aaa' });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'harness' }).items.map((s) => s.id)).toEqual([
      'aaa:root',
      'fake:root',
      'zzz:root',
    ]);
    db.close();
  });

  test('startedAt sorts ascending/descending and ties fall back to id ASC', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // Inverted insertion: earlier first, later second (default DESC differs).
    insertSession(db, 'fake:early', { startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:late', { startedAt: '2024-01-02T00:00:00Z' });
    // A tie on started_at must break by id ASC regardless of direction.
    insertSession(db, 'fake:zid', { startedAt: '2024-06-01T00:00:00Z' });
    insertSession(db, 'fake:aid', { startedAt: '2024-06-01T00:00:00Z' });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'startedAt' }).items.map((s) => s.id)).toEqual([
      'fake:early',
      'fake:late',
      'fake:aid',
      'fake:zid',
    ]);
    expect(listSessions(db, { sort: '-startedAt' }).items.map((s) => s.id)).toEqual([
      'fake:aid',
      'fake:zid',
      'fake:late',
      'fake:early',
    ]);
    db.close();
  });

  test('duration sorts numerically ascending/descending', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:long', { durationMs: 600000, startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:short', { durationMs: 60000, startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'duration' }).items.map((s) => s.id)).toEqual([
      'fake:short',
      'fake:long',
    ]);
    expect(listSessions(db, { sort: '-duration' }).items.map((s) => s.id)).toEqual([
      'fake:long',
      'fake:short',
    ]);
    db.close();
  });

  test('tokens sorts by the sum of every rollup token field (missing rollup -> 0)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // 40+30+20+10+0 = 100, spread across every summed field.
    insertSession(db, 'fake:multi', {
      uncachedInput: 40,
      cachedInput: 30,
      cacheWrite: 20,
      output: 10,
      reasoningOutput: 0,
      startedAt: '2024-01-03T00:00:00Z',
    });
    // 99 via a single field: any comparator that drops a summed field changes the order.
    insertSession(db, 'fake:single', { output: 99, startedAt: '2024-01-02T00:00:00Z' });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'tokens' }).items.map((s) => s.id)).toEqual([
      'fake:single',
      'fake:multi',
    ]);
    expect(listSessions(db, { sort: '-tokens' }).items.map((s) => s.id)).toEqual([
      'fake:multi',
      'fake:single',
    ]);

    // A session inserted after the rollup pass has no rollups row -> counts as 0.
    insertSession(db, 'fake:norow', { uncachedInput: 999, startedAt: '2024-01-01T00:00:00Z' });
    expect(listSessions(db, { sort: 'tokens' }).items.map((s) => s.id)).toEqual([
      'fake:norow',
      'fake:single',
      'fake:multi',
    ]);
    db.close();
  });

  test('cost sorts numerically; NULL costs are placed by SQLite (first ASC / last DESC)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:exp', { costUsd: 5, startedAt: '2024-01-03T00:00:00Z' });
    insertSession(db, 'fake:cheap', { costUsd: 1, startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:free', { costUsd: null, startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'cost' }).items.map((s) => s.id)).toEqual([
      'fake:free',
      'fake:cheap',
      'fake:exp',
    ]);
    expect(listSessions(db, { sort: '-cost' }).items.map((s) => s.id)).toEqual([
      'fake:exp',
      'fake:cheap',
      'fake:free',
    ]);
    db.close();
  });

  test('a DESC sort still ends with the id ASC tie-break', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // Equal names, but distinct start times so the default order is NOT id ASC.
    insertSession(db, 'fake:z', { title: 'Same', startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:a', { title: 'Same', startedAt: '2024-01-01T00:00:00Z' });
    recomputeRollups(db);

    expect(listSessions(db).items.map((s) => s.id)).toEqual(['fake:z', 'fake:a']);
    expect(listSessions(db, { sort: '-name' }).items.map((s) => s.id)).toEqual([
      'fake:a',
      'fake:z',
    ]);
    db.close();
  });

  test('an unknown sort field falls back to the default order', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:early', { startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:late', { startedAt: '2024-01-02T00:00:00Z' });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'bogus' }).items.map((s) => s.id)).toEqual([
      'fake:late',
      'fake:early',
    ]);
    db.close();
  });
});

describe('listHarnesses', () => {
  test('returns harnesses with at least one root session, ordered by display name', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertHarness(db, 'zzz', 'Zulu');
    insertHarness(db, 'aaa', 'alpha');
    insertHarness(db, 'childonly', 'ChildOnly');
    insertHarness(db, 'empty', 'Empty');
    insertSession(db, 'fake:root', { harnessId: 'fake' });
    insertSession(db, 'zzz:root', { harnessId: 'zzz' });
    insertSession(db, 'aaa:root', { harnessId: 'aaa' });
    // childonly has only a descendant row (non-null parent_id) -> excluded.
    insertSession(db, 'childonly/kid', { harnessId: 'childonly', parentId: 'some-parent' });
    recomputeRollups(db);

    const harnesses = listHarnesses(db);
    // ORDER BY h.display_name is SQLite's default BINARY collation, so uppercase
    // sorts before lowercase (Fake, Zulu, alpha). Only harnesses with a root row
    // are present: `empty` has none and `childonly` has only a descendant.
    expect(harnesses).toEqual([
      { id: 'fake', displayName: 'Fake' },
      { id: 'zzz', displayName: 'Zulu' },
      { id: 'aaa', displayName: 'alpha' },
    ]);
    db.close();
  });
});

describe('getSessionsStats', () => {
  /**
   * root1 (tokens + a token-bearing child + a model used only by the child),
   * root2, and root3 (no started_at/duration/cost). All three are roots; the
   * child must never be counted in the totals.
   */
  function seedStatsFixture(db: Database) {
    seed(db);
    insertSession(db, 'fake:root1', {
      modelPrimary: 'm1',
      startedAt: '2024-01-02T00:00:00Z',
      durationMs: 3_600_000,
      costUsd: 2.5,
      uncachedInput: 100,
      cachedInput: 10,
      cacheWrite: 5,
      output: 1000,
      reasoningOutput: 50,
    });
    insertSession(db, 'fake:root1/child', {
      parentId: 'fake:root1',
      modelPrimary: 'm-child',
      uncachedInput: 20,
      cachedInput: 2,
      cacheWrite: 1,
      output: 200,
      reasoningOutput: 10,
    });
    insertSession(db, 'fake:root2', {
      modelPrimary: 'm2',
      startedAt: '2024-01-03T00:00:00Z',
      durationMs: 1_800_000,
      costUsd: 1,
      uncachedInput: 10,
      output: 100,
    });
    insertSession(db, 'fake:root3', { modelPrimary: 'm3', startedAt: null });
    recomputeRollups(db);
  }

  test('aggregates the full root set: totals, inclusive tokens, avg duration, series', () => {
    const { db } = openStore(':memory:');
    seedStatsFixture(db);

    const stats = getSessionsStats(db);

    // root1 + root2 + root3; the child is NOT a root.
    expect(stats.totalSessions).toBe(3);
    expect(stats.totalCostUsd).toBeCloseTo(3.5);
    // root1 inclusive (own + child) = 120/12/6/1200/60 = 1398; root2 = 110;
    // root3 = 0.
    expect(stats.totalTokens).toBe(1398 + 110);
    // NULL duration (root3) excluded from the mean.
    expect(stats.avgDurationMs).toBe((3_600_000 + 1_800_000) / 2);
    // Day buckets, ascending; root3 has no started_at and is excluded.
    expect(stats.series).toEqual([
      { date: '2024-01-02', sessions: 1 },
      { date: '2024-01-03', sessions: 1 },
    ]);

    db.close();
  });

  test('limit/offset are ignored: stats always cover the whole filtered set', () => {
    const { db } = openStore(':memory:');
    seedStatsFixture(db);

    const paged = listSessions(db, { limit: 1, offset: 0 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);

    const stats = getSessionsStats(db, { limit: 1, offset: 0 });
    expect(stats.totalSessions).toBe(3);
    expect(stats.totalCostUsd).toBeCloseTo(3.5);

    db.close();
  });

  test('applies each filter with the same semantics as listSessions', () => {
    const { db } = openStore(':memory:');
    seedStatsFixture(db);

    // costOnly excludes NULL/0 cost rows.
    const costOnly = getSessionsStats(db, { costOnly: true });
    expect(costOnly.totalSessions).toBe(2);
    expect(costOnly.totalCostUsd).toBeCloseTo(3.5);

    // durationMin is inclusive and excludes NULL durations.
    expect(getSessionsStats(db, { durationMin: 30 }).totalSessions).toBe(2);

    // startedAfter is exclusive and excludes NULL started_at.
    expect(getSessionsStats(db, { startedAfter: '2024-01-02T12:00:00Z' }).totalSessions).toBe(1);

    // harness is exact.
    expect(getSessionsStats(db, { harness: 'fake' }).totalSessions).toBe(3);

    // q matches the project-name fallback (title NULL).
    expect(getSessionsStats(db, { q: 'Project' }).totalSessions).toBe(3);

    db.close();
  });

  test('model filter matches a model used only by a descendant', () => {
    const { db } = openStore(':memory:');
    seedStatsFixture(db);

    const stats = getSessionsStats(db, { model: 'm-child' });
    expect(stats.totalSessions).toBe(1);
    // root1's inclusive tokens, proving the descendant-scoped match.
    expect(stats.totalTokens).toBe(1398);

    db.close();
  });

  test('an empty filtered set yields zeros and an empty series', () => {
    const { db } = openStore(':memory:');
    seedStatsFixture(db);

    const stats = getSessionsStats(db, { q: 'no-such-session' });
    expect(stats).toEqual({
      totalSessions: 0,
      totalCostUsd: 0,
      totalTokens: 0,
      avgDurationMs: 0,
      series: [],
    });

    db.close();
  });

  test('a single-session set has that session as its own aggregate', () => {
    const { db } = openStore(':memory:');
    seedStatsFixture(db);

    // Only root2 starts after this bound (root3 has NULL started_at).
    const stats = getSessionsStats(db, { startedAfter: '2024-01-02T12:00:00Z' });
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalTokens).toBe(110);
    expect(stats.avgDurationMs).toBe(1_800_000);
    expect(stats.series).toEqual([{ date: '2024-01-03', sessions: 1 }]);

    db.close();
  });
});
