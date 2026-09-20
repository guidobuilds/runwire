import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readProfileSessionContext } from './profile-context';
import { openStore } from './store';

function seed(db: Database): void {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['h', 'Harness', '1', '[]'],
  );
}

/** Idempotently upserts a raw model string and returns its `models.id`. */
function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}

type SessionSeed = {
  parentId?: string | null;
  agentType?: string | null;
  startedAt?: string | null;
  durationMs?: number | null;
  costUsd?: number | null;
  modelPrimary?: string | null;
};

function session(db: Database, id: string, opts: SessionSeed = {}): void {
  db.run(
    `INSERT INTO sessions (
       id, harness_id, parent_id, agent_type, started_at, duration_ms, cost_usd,
       model_primary_id, source_path
     ) VALUES (?, 'h', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.parentId ?? null,
      opts.agentType ?? null,
      opts.startedAt ?? null,
      opts.durationMs ?? null,
      opts.costUsd ?? null,
      opts.modelPrimary == null ? null : modelId(db, opts.modelPrimary),
      `source:${id}`,
    ],
  );
}

type StepSeed = {
  kind?: string;
  uncached?: number | null;
  cached?: number | null;
  cacheWrite?: number | null;
};

function step(db: Database, sessionId: string, seq: number, opts: StepSeed = {}): void {
  db.run(
    `INSERT INTO steps (
       session_id, seq, kind, uncached_input, cached_input, cache_write
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      seq,
      opts.kind ?? 'call',
      opts.uncached ?? null,
      opts.cached ?? null,
      opts.cacheWrite ?? null,
    ],
  );
}

const NULL_METRICS = {
  observedCalls: 0,
  promptInput: null,
  avgPromptInput: null,
  p95PromptInput: null,
  peakPromptInput: null,
  cacheReadShare: null,
};

describe('readProfileSessionContext', () => {
  test('returns null for a missing session', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    expect(readProfileSessionContext(db, 'missing')).toBeNull();
    db.close();
  });

  test('observability: all-NULL categories exclude a call; missing categories count 0', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, { uncached: 100, cached: 0, cacheWrite: 0 });
    step(db, 'root', 1, { uncached: 100 }); // cached/cacheWrite absent -> 0
    step(db, 'root', 2, {}); // all NULL -> not observable
    step(db, 'root', 3, { uncached: 0, cached: 50 });
    step(db, 'root', 4, { uncached: null, cached: null, cacheWrite: null });

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own).toEqual({
      observedCalls: 3,
      promptInput: 250,
      avgPromptInput: 250 / 3,
      p95PromptInput: 100,
      peakPromptInput: 100,
      // weighted: (0 + 0 + 50) / 250
      cacheReadShare: 0.2,
    });
    expect(res.tree).toEqual(res.own);
    expect(res.descendants).toEqual([]);
    db.close();
  });

  test('non-call steps never contribute even when they carry input fields', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, { kind: 'tool', uncached: 999 });

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own).toEqual(NULL_METRICS);
    expect(res.tree).toEqual(NULL_METRICS);
    db.close();
  });

  test('all metrics are null with zero observable calls', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, {});
    step(db, 'root', 1, {});

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own).toEqual(NULL_METRICS);
    expect(res.tree).toEqual(NULL_METRICS);
    db.close();
  });

  test('cacheReadShare is null at a zero prompt-input denominator', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, { uncached: 0, cached: 0, cacheWrite: 0 });

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own).toEqual({
      observedCalls: 1,
      promptInput: 0,
      avgPromptInput: 0,
      p95PromptInput: 0,
      peakPromptInput: 0,
      cacheReadShare: null,
    });
    db.close();
  });

  test('p95 is nearest-rank: ceil(0.95 * N) over 20 ascending calls is the 19th value', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    for (let i = 1; i <= 20; i += 1) step(db, 'root', i, { uncached: i });

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own).toEqual({
      observedCalls: 20,
      promptInput: 210,
      avgPromptInput: 210 / 20,
      p95PromptInput: 19,
      peakPromptInput: 20,
      cacheReadShare: 0,
    });
    db.close();
  });

  test('p95 of a single observable call is that call', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, { uncached: 7 });

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own.p95PromptInput).toBe(7);
    expect(res.own.peakPromptInput).toBe(7);
    db.close();
  });

  test('own is own-only while tree pools the subtree; descendant rows are own-only', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'root/child', { parentId: 'root' });
    session(db, 'root/child/grand', { parentId: 'root/child' });
    step(db, 'root', 0, { uncached: 100 });
    step(db, 'root/child', 0, { uncached: 40 });
    step(db, 'root/child/grand', 0, { uncached: 10 });

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own.observedCalls).toBe(1);
    expect(res.own.promptInput).toBe(100);
    expect(res.tree.observedCalls).toBe(3);
    expect(res.tree.promptInput).toBe(150);
    expect(res.descendants.map((d) => [d.id, d.metrics.promptInput])).toEqual([
      ['root/child', 40],
      ['root/child/grand', 10],
    ]);
    db.close();
  });

  test('descendant order is depth-first pre-order with siblings startedAt ASC NULL first then id', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    // Insert later-starting and equal-starting siblings FIRST so insertion
    // (rowid) order cannot be what makes the assertions pass.
    session(db, 'root/late', { parentId: 'root', startedAt: '2026-02-01T00:00:00Z' });
    session(db, 'root/early', { parentId: 'root', startedAt: '2026-01-01T00:00:00Z' });
    session(db, 'root/nullfirst', { parentId: 'root', startedAt: null });
    session(db, 'root/early/grand', {
      parentId: 'root/early',
      startedAt: '2026-01-15T00:00:00Z',
    });
    session(db, 'root/tie-b', { parentId: 'root', startedAt: '2026-03-01T00:00:00Z' });
    session(db, 'root/tie-a', { parentId: 'root', startedAt: '2026-03-01T00:00:00Z' });

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.descendants.map((d) => d.id)).toEqual([
      'root/nullfirst',
      'root/early',
      'root/early/grand',
      'root/late',
      'root/tie-a',
      'root/tie-b',
    ]);
    expect(Object.fromEntries(res.descendants.map((d) => [d.id, d.relativeDepth]))).toEqual({
      'root/nullfirst': 1,
      'root/early': 1,
      'root/early/grand': 2,
      'root/late': 1,
      'root/tie-a': 1,
      'root/tie-b': 1,
    });
    db.close();
  });

  test('preserves absent descendant metadata as null (never fabricates)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'root/bare', { parentId: 'root', startedAt: '2026-01-01T00:00:00Z' });
    session(db, 'root/rich', {
      parentId: 'root',
      agentType: 'worker',
      startedAt: '2026-01-02T00:00:00Z',
      durationMs: 1234,
      costUsd: 0.5,
      modelPrimary: 'm1',
    });

    const res = readProfileSessionContext(db, 'root')!;
    const bare = res.descendants.find((d) => d.id === 'root/bare')!;
    expect(bare).toEqual({
      id: 'root/bare',
      parentId: 'root',
      relativeDepth: 1,
      agentType: null,
      startedAt: '2026-01-01T00:00:00Z',
      durationMs: null,
      modelPrimary: null,
      costUsd: null,
      metrics: NULL_METRICS,
    });
    const rich = res.descendants.find((d) => d.id === 'root/rich')!;
    expect(rich.agentType).toBe('worker');
    expect(rich.durationMs).toBe(1234);
    expect(rich.modelPrimary).toBe('m1');
    expect(rich.costUsd).toBe(0.5);
    db.close();
  });

  test('handles a wide tree (60 descendants x 20 calls) with pooled metrics', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    for (let i = 0; i < 60; i += 1) {
      session(db, `root/k${i}`, { parentId: 'root', startedAt: `2026-01-01T00:00:${i}Z` });
      for (let j = 0; j < 20; j += 1) {
        step(db, `root/k${i}`, j, { uncached: j + 1, cached: 0, cacheWrite: 0 });
      }
    }

    const res = readProfileSessionContext(db, 'root')!;
    expect(res.own).toEqual(NULL_METRICS);
    expect(res.descendants).toHaveLength(60);
    expect(res.descendants.every((d) => d.metrics.observedCalls === 20)).toBe(true);
    expect(res.descendants.every((d) => d.metrics.promptInput === 210)).toBe(true);
    expect(res.descendants.every((d) => d.metrics.p95PromptInput === 19)).toBe(true);
    expect(res.descendants.every((d) => d.metrics.peakPromptInput === 20)).toBe(true);
    expect(res.tree).toEqual({
      observedCalls: 1200,
      promptInput: 60 * 210,
      avgPromptInput: 210 / 20,
      p95PromptInput: 19,
      peakPromptInput: 20,
      cacheReadShare: 0,
    });
    db.close();
  });
});
