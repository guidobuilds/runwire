import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { getSession, listSessions } from './read';
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
       started_at, turns, api_calls, tool_calls, compactions, cost_usd,
       uncached_input, cached_input, cache_write, output, reasoning_output,
       source_path, source_size, source_mtime
     ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      id,
      opts.harnessId ?? 'fake',
      opts.projectKey === undefined ? 'p1' : opts.projectKey,
      opts.parentId ?? null,
      opts.title ?? null,
      opts.modelPrimary == null ? null : modelId(db, opts.modelPrimary),
      opts.startedAt ?? null,
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
