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

function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}

type SessionSeed = {
  parentId?: string;
  relation?: 'subagent' | 'teammate' | 'fork' | null;
  projectKey?: string | null;
  title?: string | null;
  modelPrimary?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  harnessId?: string;
  sourceMtime?: number;
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
       id, harness_id, project_key, parent_id, depth, relation, title, model_primary_id,
       started_at, ended_at, duration_ms, turns, api_calls, tool_calls, compactions, cost_usd,
       uncached_input, cached_input, cache_write, output, reasoning_output,
       source_path, source_size, source_mtime
     ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      opts.harnessId ?? 'fake',
      opts.projectKey === undefined ? 'p1' : opts.projectKey,
      opts.parentId ?? null,
      opts.relation ?? null,
      opts.title ?? null,
      opts.modelPrimary == null ? null : modelId(db, opts.modelPrimary),
      opts.startedAt ?? null,
      opts.endedAt ?? null,
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
      opts.sourceMtime ?? 1,
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

function countQueries<T>(db: Database, run: (db: Database) => T): { result: T; queries: number } {
  let queries = 0;
  const original = db.query.bind(db);
  const patched = ((sql: string) => {
    queries += 1;
    return original(sql);
  }) as Database['query'];
  Object.assign(db, { query: patched });
  try {
    return { result: run(db), queries };
  } finally {
    Object.assign(db, { query: original });
  }
}

describe('listSessions', () => {
  test('returns roots only, sorted by started_at DESC id, with correct accounting', () => {
    const { db } = openStore(':memory:');
    seed(db);
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

    expect(items.map((s) => s.id)).toEqual(['fake:root1', 'fake:root2']);
    expect(total).toBe(2);

    const root1 = items[0]!;
    expect(root1.name).toBe('Project One');
    expect(root1.title).toBeNull();
    expect(root1.harness).toEqual({ id: 'fake', displayName: 'Fake', adapterVersion: '1.0.0' });
    expect(root1.project).toEqual({ key: 'p1', name: 'Project One' });
    expect(root1.parentId).toBeNull();
    expect(root1.childCount).toBe(1);
    expect(root1.descendantCount).toBe(2);
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
    expect('turnsInclusive' in root1).toBe(false);
    expect(root1.costUsd).toBe(1.25);

    const root2 = items[1]!;
    expect(root2.name).toBe('fake:root2');
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

    expect(listSessions(db, { harness: 'Fake' }).items).toEqual([]);
    db.close();
  });

  test('startedAfter is exclusive, NULL never matches, and a millis-less value is normalized', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:bound', { startedAt: '2024-01-01T00:00:00.000Z' });
    insertSession(db, 'fake:after', { startedAt: '2024-01-01T00:00:00.001Z' });
    insertSession(db, 'fake:null', { startedAt: null });
    recomputeRollups(db);

    const res = listSessions(db, { startedAfter: '2024-01-01T00:00:00Z' });
    expect(res.items.map((s) => s.id)).toEqual(['fake:after']);
    expect(res.total).toBe(1);
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
    expect(page1.items.find((s) => s.id === 'fake:r1')!.modelsDescendants).toEqual(['m1-child']);
    expect(page1.items.find((s) => s.id === 'fake:r2')!.modelsDescendants).toEqual(['m2-child']);
    expect(page1.items.find((s) => s.id === 'fake:r3')).toBeUndefined();
    db.close();
  });
});

describe('listSessions/getSession subagent counts (Direct / Full tree)', () => {
  function seedMixedTree(db: Database) {
    seed(db);
    insertSession(db, 'fake:root', { startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:sub', { parentId: 'fake:root', relation: 'subagent' });
    insertSession(db, 'fake:sub/subsub', { parentId: 'fake:sub', relation: 'subagent' });
    insertSession(db, 'fake:sub/subsub/leaf', {
      parentId: 'fake:sub/subsub',
      relation: 'subagent',
    });
    insertSession(db, 'fake:team', { parentId: 'fake:root', relation: 'teammate' });
    insertSession(db, 'fake:team/tchild', { parentId: 'fake:team', relation: 'subagent' });
    insertSession(db, 'fake:fork', { parentId: 'fake:root', relation: 'fork' });
    insertSession(db, 'fake:fork/fchild', { parentId: 'fake:fork', relation: 'subagent' });
    recomputeRollups(db);
  }

  test('Direct counts only immediate subagent children; Full tree walks mixed branches', () => {
    const { db } = openStore(':memory:');
    seedMixedTree(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    expect(root.subagentChildCount).toBe(1);
    expect(root.subagentDescendantCount).toBe(5);
    expect(root.childCount).toBe(3);
    expect(root.descendantCount).toBe(7);
    db.close();
  });

  test('list and detail agree, intermediate nodes count, and leaves report 0/0', () => {
    const { db } = openStore(':memory:');
    seedMixedTree(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    const detail = getSession(db, 'fake:root')!;
    expect(detail.subagentChildCount).toBe(root.subagentChildCount);
    expect(detail.subagentDescendantCount).toBe(root.subagentDescendantCount);

    const byId = new Map(detail.children.map((c) => [c.id, c]));
    expect(byId.get('fake:sub')!.subagentChildCount).toBe(1);
    expect(byId.get('fake:sub')!.subagentDescendantCount).toBe(2);
    expect(byId.get('fake:team')!.subagentChildCount).toBe(1);
    expect(byId.get('fake:team')!.subagentDescendantCount).toBe(1);
    expect(byId.get('fake:fork')!.subagentChildCount).toBe(1);
    expect(byId.get('fake:fork')!.subagentDescendantCount).toBe(1);

    const subsub = getSession(db, 'fake:sub/subsub')!;
    expect(subsub.subagentChildCount).toBe(1);
    expect(subsub.subagentDescendantCount).toBe(1);
    const leaf = getSession(db, 'fake:sub/subsub/leaf')!;
    expect(leaf.subagentChildCount).toBe(0);
    expect(leaf.subagentDescendantCount).toBe(0);
    expect(leaf.parent!.id).toBe('fake:sub/subsub');
    expect(leaf.parent!.subagentDescendantCount).toBe(1);
    db.close();
  });

  test('a subagent never counts itself (orphan self-exclusion)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:orphan', { relation: 'subagent', startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:orphan/kid', { parentId: 'fake:orphan', relation: 'subagent' });
    recomputeRollups(db);

    const orphan = listSessions(db).items.find((s) => s.id === 'fake:orphan')!;
    expect(orphan.subagentChildCount).toBe(1);
    expect(orphan.subagentDescendantCount).toBe(1);
    expect(orphan.childCount).toBe(1);
    expect(orphan.descendantCount).toBe(1);

    insertSession(db, 'fake:solo', {
      relation: 'subagent',
      startedAt: '2024-01-02T00:00:00Z',
    });
    recomputeRollups(db);
    const solo = listSessions(db).items.find((s) => s.id === 'fake:solo')!;
    expect(solo.subagentChildCount).toBe(0);
    expect(solo.subagentDescendantCount).toBe(0);
    db.close();
  });

  test('a hand-made parent cycle terminates without counting the seed as its own descendant', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:a', { parentId: 'fake:b', relation: 'subagent' });
    insertSession(db, 'fake:b', { parentId: 'fake:a', relation: 'subagent' });
    recomputeRollups(db);

    const a = getSession(db, 'fake:a')!;
    expect(a.subagentChildCount).toBe(1);
    expect(a.subagentDescendantCount).toBe(1);
    const b = getSession(db, 'fake:b')!;
    expect(b.subagentChildCount).toBe(1);
    expect(b.subagentDescendantCount).toBe(1);
    db.close();
  });

  test('comma-containing IDs: a substring-matching child is not mistaken for visited', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root', { startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:a,fake:b', { parentId: 'fake:root', relation: 'subagent' });
    insertSession(db, 'fake:b', { parentId: 'fake:a,fake:b', relation: 'subagent' });
    insertSession(db, 'fake:b/kid', { parentId: 'fake:b', relation: 'subagent' });
    recomputeRollups(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    expect(root.subagentChildCount).toBe(1);
    expect(root.subagentDescendantCount).toBe(3);
    expect(root.childCount).toBe(1);

    const ancestor = getSession(db, 'fake:a,fake:b')!;
    expect(ancestor.subagentChildCount).toBe(1);
    expect(ancestor.subagentDescendantCount).toBe(2);
    db.close();
  });

  test('comma-containing cycle terminates and traverses a mixed teammate branch', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'c,a', { parentId: 'c,a,b', relation: 'subagent' });
    insertSession(db, 'c,a,b', { parentId: 'c,a', relation: 'subagent' });
    insertSession(db, 'c,a,t', { parentId: 'c,a', relation: 'teammate' });
    insertSession(db, 'c,a,b,t', { parentId: 'c,a,t', relation: 'subagent' });
    recomputeRollups(db);

    const a = getSession(db, 'c,a')!;
    expect(a.subagentChildCount).toBe(1);
    expect(a.subagentDescendantCount).toBe(2);

    const b = getSession(db, 'c,a,b')!;
    expect(b.subagentChildCount).toBe(1);
    expect(b.subagentDescendantCount).toBe(2);
    db.close();
  });

  test('counts are computed for the whole page with a fixed number of queries (no N+1)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    for (let i = 0; i < 5; i++) {
      insertSession(db, `fake:r${i}`, { startedAt: `2024-01-0${i + 1}T00:00:00Z` });
      insertSession(db, `fake:r${i}/sub`, { parentId: `fake:r${i}`, relation: 'subagent' });
    }
    recomputeRollups(db);

    const one = countQueries(db, (d) => listSessions(d, { limit: 1 }));
    const five = countQueries(db, (d) => listSessions(d, { limit: 5 }));
    expect(five.queries).toBe(one.queries);
    expect(five.result.items).toHaveLength(5);

    const page1 = listSessions(db, { limit: 1, offset: 0 }).items;
    expect(page1.map((s) => s.id)).toEqual(['fake:r4']);
    expect(page1[0]!.subagentChildCount).toBe(1);
    expect(page1[0]!.subagentDescendantCount).toBe(1);
    expect(page1.find((s) => s.id === 'fake:r0')).toBeUndefined();
    db.close();
  });

  test('getSession query count is independent of the number of children', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root1', {});
    insertSession(db, 'fake:root1/c1', { parentId: 'fake:root1', relation: 'subagent' });
    recomputeRollups(db);
    const narrow = countQueries(db, (d) => getSession(d, 'fake:root1'));

    insertSession(db, 'fake:root1/c2', { parentId: 'fake:root1', relation: 'subagent' });
    insertSession(db, 'fake:root1/c3', { parentId: 'fake:root1', relation: 'subagent' });
    recomputeRollups(db);
    const wide = countQueries(db, (d) => getSession(d, 'fake:root1'));
    expect(wide.queries).toBe(narrow.queries);
    expect(wide.result!.children).toHaveLength(3);
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
    insertSession(db, 'fake:project', { title: null, startedAt: '2024-01-02T00:00:00Z' });
    insertSession(db, 'fake:id-only', {
      title: null,
      projectKey: null,
      startedAt: '2024-01-01T00:00:00Z',
    });
    recomputeRollups(db);

    expect(listSessions(db, { q: 'hello' }).items.map((s) => s.id)).toEqual(['fake:title']);
    expect(listSessions(db, { q: 'HELLO WORLD' }).items.map((s) => s.id)).toEqual(['fake:title']);
    expect(listSessions(db, { q: 'project one' }).items.map((s) => s.id)).toEqual(['fake:project']);
    expect(listSessions(db, { q: 'id-only' }).items.map((s) => s.id)).toEqual(['fake:id-only']);
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

    expect(listSessions(db, { q: '100%' }).items.map((s) => s.id)).toEqual(['fake:pct']);
    expect(listSessions(db, { q: 'ab_c' }).items.map((s) => s.id)).toEqual(['fake:under']);
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

    expect(listSessions(db, { harness: 'missing,opencode' }).items.map((s) => s.id)).toEqual([
      'oc:one',
    ]);
    expect(
      listSessions(db, { harness: ' opencode , fake , fake ' }).items.map((s) => s.id),
    ).toEqual(['fake:cc', 'oc:one']);
    expect(listSessions(db, { harness: 'OpenCode' }).items).toEqual([]);
    expect(listSessions(db, { harness: 'opencode' }).items.map((s) => s.id)).toEqual(['oc:one']);
    expect(listSessions(db, { harness: ' , ' }).items).toHaveLength(2);
    db.close();
  });
});

describe('listSessions sort whitelist', () => {
  test('name sorts case-insensitively by the name expression', () => {
    const { db } = openStore(':memory:');
    seed(db);
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
    insertSession(db, 'fake:early', { startedAt: '2024-01-01T00:00:00Z' });
    insertSession(db, 'fake:late', { startedAt: '2024-01-02T00:00:00Z' });
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

  test('tokens sorts by the sum of the prompt+output rollup fields (missing rollup -> 0)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:multi', {
      uncachedInput: 40,
      cachedInput: 30,
      cacheWrite: 20,
      output: 10,
      reasoningOutput: 0,
      startedAt: '2024-01-03T00:00:00Z',
    });
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

    insertSession(db, 'fake:norow', { uncachedInput: 999, startedAt: '2024-01-01T00:00:00Z' });
    expect(listSessions(db, { sort: 'tokens' }).items.map((s) => s.id)).toEqual([
      'fake:norow',
      'fake:single',
      'fake:multi',
    ]);
    db.close();
  });

  test('tokens sort excludes reasoning_output (reasoning must not re-enter the total)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:reasoning-heavy', {
      output: 100,
      reasoningOutput: 1000,
      startedAt: '2024-01-03T00:00:00Z',
    });
    insertSession(db, 'fake:output-heavy', {
      output: 150,
      reasoningOutput: 0,
      startedAt: '2024-01-02T00:00:00Z',
    });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'tokens' }).items.map((s) => s.id)).toEqual([
      'fake:reasoning-heavy',
      'fake:output-heavy',
    ]);
    expect(listSessions(db, { sort: '-tokens' }).items.map((s) => s.id)).toEqual([
      'fake:output-heavy',
      'fake:reasoning-heavy',
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

describe('lastActivity (tree-inclusive latest activity)', () => {
  test('reflects a later descendant ended_at and is tree-inclusive for every node', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root', {
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T00:10:00Z',
    });
    insertSession(db, 'fake:root/child', {
      parentId: 'fake:root',
      startedAt: '2024-01-04T00:00:00Z',
      endedAt: '2024-01-05T00:00:00Z',
    });
    insertSession(db, 'fake:root/child/grand', {
      parentId: 'fake:root/child',
      startedAt: '2024-01-03T00:00:00Z',
      endedAt: '2024-01-03T01:00:00Z',
    });
    recomputeRollups(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    expect(root.endedAt).toBe('2024-01-01T00:10:00Z');
    expect(root.lastActivity).toBe('2024-01-05T00:00:00Z');

    const child = getSession(db, 'fake:root/child')!;
    expect(child.lastActivity).toBe('2024-01-05T00:00:00Z');
    expect(child.children[0]!.lastActivity).toBe('2024-01-03T01:00:00Z');
    const grand = getSession(db, 'fake:root/child/grand')!;
    expect(grand.lastActivity).toBe('2024-01-03T01:00:00Z');
    db.close();
  });

  test('falls back to startedAt when neither the node nor its subtree has ended_at', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:noevents', { startedAt: '2024-02-02T00:00:00Z', endedAt: null });
    insertSession(db, 'fake:noevents/child', { parentId: 'fake:noevents' });
    insertSession(db, 'fake:neither', { startedAt: null, endedAt: null });
    recomputeRollups(db);

    const noevents = listSessions(db).items.find((s) => s.id === 'fake:noevents')!;
    expect(noevents.lastActivity).toBe('2024-02-02T00:00:00Z');
    const neither = listSessions(db).items.find((s) => s.id === 'fake:neither')!;
    expect(neither.lastActivity).toBeNull();
    db.close();
  });

  test('own/inclusive invariance: descendant activity wins over the root fallback', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root', { startedAt: '2024-01-01T00:00:00Z', endedAt: null });
    insertSession(db, 'fake:root/child', {
      parentId: 'fake:root',
      startedAt: '2024-01-02T00:00:00Z',
      endedAt: '2024-01-09T00:00:00Z',
    });
    recomputeRollups(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    expect(root.endedAt).toBeNull();
    expect(root.lastActivity).toBe('2024-01-09T00:00:00Z');
    db.close();
  });

  test('a later-started descendant with no ended_at does not override real event activity', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root', {
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T00:10:00Z',
    });
    insertSession(db, 'fake:root/child', {
      parentId: 'fake:root',
      startedAt: '2024-06-01T00:00:00Z',
      endedAt: null,
    });
    insertSession(db, 'fake:root/child/grand', {
      parentId: 'fake:root/child',
      startedAt: '2024-07-01T00:00:00Z',
      endedAt: null,
    });
    recomputeRollups(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    expect(root.lastActivity).toBe('2024-01-01T00:10:00Z');
    const child = getSession(db, 'fake:root/child')!;
    expect(child.lastActivity).toBe('2024-06-01T00:00:00Z');
    db.close();
  });

  test('subtree-wide fallback uses the seed startedAt, not a later descendant start', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root', { startedAt: '2024-02-02T00:00:00Z', endedAt: null });
    insertSession(db, 'fake:root/child', {
      parentId: 'fake:root',
      startedAt: '2024-07-07T00:00:00Z',
      endedAt: null,
    });
    recomputeRollups(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    expect(root.lastActivity).toBe('2024-02-02T00:00:00Z');
    db.close();
  });

  test('default order is lastActivity DESC (not started_at) with id ASC tie-break', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:late-start', { startedAt: '2024-06-01T00:00:00Z' });
    insertSession(db, 'fake:early-start', {
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-02T00:00:00Z',
    });
    insertSession(db, 'fake:early-start/child', {
      parentId: 'fake:early-start',
      startedAt: '2024-12-01T00:00:00Z',
      endedAt: '2024-12-01T01:00:00Z',
    });
    insertSession(db, 'fake:z-tie', {
      startedAt: '2024-03-01T00:00:00Z',
      endedAt: '2024-03-01T00:00:00Z',
    });
    insertSession(db, 'fake:a-tie', {
      startedAt: '2024-03-01T00:00:00Z',
      endedAt: '2024-03-01T00:00:00Z',
    });
    recomputeRollups(db);

    expect(listSessions(db).items.map((s) => s.id)).toEqual([
      'fake:early-start',
      'fake:late-start',
      'fake:a-tie',
      'fake:z-tie',
    ]);
    db.close();
  });

  test('explicit lastActivity sort: ascending and descending', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root', {
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-02T00:00:00Z',
    });
    insertSession(db, 'fake:root/child', {
      parentId: 'fake:root',
      startedAt: '2024-05-01T00:00:00Z',
      endedAt: '2024-05-01T00:00:00Z',
    });
    insertSession(db, 'fake:other', {
      startedAt: '2024-03-01T00:00:00Z',
      endedAt: '2024-03-01T00:00:00Z',
    });
    recomputeRollups(db);

    expect(listSessions(db, { sort: 'lastActivity' }).items.map((s) => s.id)).toEqual([
      'fake:other',
      'fake:root',
    ]);
    expect(listSessions(db, { sort: '-lastActivity' }).items.map((s) => s.id)).toEqual([
      'fake:root',
      'fake:other',
    ]);
    db.close();
  });

  test('source_mtime is never the activity source', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root', {
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T00:05:00Z',
      sourceMtime: 9_999_999_999_999,
    });
    recomputeRollups(db);

    const root = listSessions(db).items.find((s) => s.id === 'fake:root')!;
    expect(root.lastActivity).toBe('2024-01-01T00:05:00Z');
    db.close();
  });

  test('a hand-made parent cycle terminates with the seed excluded from its own walk', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:a', {
      parentId: 'fake:b',
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T00:00:00Z',
    });
    insertSession(db, 'fake:b', {
      parentId: 'fake:a',
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-02-02T00:00:00Z',
    });
    recomputeRollups(db);

    const a = getSession(db, 'fake:a')!;
    expect(a.lastActivity).toBe('2024-02-02T00:00:00Z');
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
    insertSession(db, 'childonly/kid', { harnessId: 'childonly', parentId: 'some-parent' });
    recomputeRollups(db);

    const harnesses = listHarnesses(db);
    expect(harnesses).toEqual([
      { id: 'fake', displayName: 'Fake' },
      { id: 'zzz', displayName: 'Zulu' },
      { id: 'aaa', displayName: 'alpha' },
    ]);
    db.close();
  });
});

describe('getSessionsStats', () => {
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

    expect(stats.totalSessions).toBe(3);
    expect(stats.totalCostUsd).toBeCloseTo(3.5);
    expect(stats.totalTokens).toBe(1338 + 110);
    expect(stats.avgDurationMs).toBe((3_600_000 + 1_800_000) / 2);
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

    const costOnly = getSessionsStats(db, { costOnly: true });
    expect(costOnly.totalSessions).toBe(2);
    expect(costOnly.totalCostUsd).toBeCloseTo(3.5);

    expect(getSessionsStats(db, { durationMin: 30 }).totalSessions).toBe(2);

    expect(getSessionsStats(db, { startedAfter: '2024-01-02T12:00:00Z' }).totalSessions).toBe(1);

    expect(getSessionsStats(db, { harness: 'fake' }).totalSessions).toBe(3);

    expect(getSessionsStats(db, { q: 'Project' }).totalSessions).toBe(3);

    db.close();
  });

  test('model filter matches a model used only by a descendant', () => {
    const { db } = openStore(':memory:');
    seedStatsFixture(db);

    const stats = getSessionsStats(db, { model: 'm-child' });
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalTokens).toBe(1338);

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

    const stats = getSessionsStats(db, { startedAfter: '2024-01-02T12:00:00Z' });
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalTokens).toBe(110);
    expect(stats.avgDurationMs).toBe(1_800_000);
    expect(stats.series).toEqual([{ date: '2024-01-03', sessions: 1 }]);

    db.close();
  });
});
