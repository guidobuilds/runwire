import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readProfileTimeline } from './profile-timeline';
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
function session(
  db: Database,
  id: string,
  parent: string | null = null,
  callId: string | null = null,
): void {
  db.run(
    'INSERT INTO sessions (id, harness_id, parent_id, spawn_call_id, source_path) VALUES (?, ?, ?, ?, ?)',
    [id, 'h', parent, callId, `source:${id}`],
  );
}
function call(
  db: Database,
  id: string,
  seq: number,
  output: number | null,
  model: string | null = 'm',
  at: string | null = null,
): void {
  db.run(
    'INSERT INTO steps (session_id, seq, kind, model_id, at, output) VALUES (?, ?, ?, ?, ?, ?)',
    [id, seq, 'call', model == null ? null : modelId(db, model), at, output],
  );
}
function action(
  db: Database,
  parent: string,
  seq: number,
  callId: string | null,
  childId: string | null = null,
  at: string | null = null,
): void {
  db.run(
    "INSERT INTO steps (session_id, seq, kind, tool_category, tool_name, call_id, child_id, at) VALUES (?, ?, 'tool', 'agent', 'Task', ?, ?, ?)",
    [parent, seq, callId, childId, at],
  );
}

describe('readProfileTimeline', () => {
  test('orders calls chronologically across sessions by at (not session/seq) and excludes/counts null-at rows', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'child', 'root');
    call(db, 'child', 0, 5, 'm', '2025-01-01T00:00:02Z');
    call(db, 'root', 0, 1, 'm', '2025-01-01T00:00:03Z');
    call(db, 'child', 1, 2, 'm', '2025-01-01T00:00:00Z');
    call(db, 'root', 1, 9, 'm', null);
    const result = readProfileTimeline(db, 'root')!;
    expect(result.points.map((p) => p.at)).toEqual([
      '2025-01-01T00:00:00Z',
      '2025-01-01T00:00:02Z',
      '2025-01-01T00:00:03Z',
    ]);
    expect(result.points.map((p) => p.totalDelta)).toEqual([2, 5, 1]);
    expect(result.points.at(-1)!.totalCumulative).toBe(8);
    expect(result.excludedNullAtCount).toBe(1);
    expect(result.timeDomain).toEqual({
      start: '2025-01-01T00:00:00Z',
      end: '2025-01-01T00:00:03Z',
    });
    db.close();
  });

  test('reports timeDomain null/null when the scope has no timed calls at all', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    call(db, 'root', 0, 1, 'm', null);
    call(db, 'root', 1, 2, 'm', null);
    const result = readProfileTimeline(db, 'root')!;
    expect(result.points).toEqual([]);
    expect(result.excludedNullAtCount).toBe(2);
    expect(result.timeDomain).toEqual({ start: null, end: null });
    db.close();
  });

  test('applies the top-7 + unknown/other model legend to a 9-model fixture', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    for (let i = 0; i < 9; i += 1) {
      const id = `n${i}`;
      session(db, id, 'root');
      call(
        db,
        id,
        0,
        i + 1,
        i === 8 ? 'other' : `model-${i}`,
        `2025-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      );
    }
    call(db, 'n0', 1, 1, 'unknown', '2025-01-01T00:01:00Z');
    call(db, 'n8', 1, 0, 'unknown', '2025-01-01T00:01:30Z');
    call(db, 'root', 0, null, null, '2025-01-01T00:02:00Z');
    const timeline = readProfileTimeline(db, 'root')!;
    // 8 named models (model-0..model-7), top 7 by count/name stay visible;
    // model-7 plus the two literal 'unknown' calls and the literal 'other'
    // call collapse into the reserved 'other' bucket (4 calls); the single
    // null-model call is 'unknown' (1 call).
    expect(timeline.series.map((s) => s.model).sort()).toEqual(
      [
        'model-0',
        'model-1',
        'model-2',
        'model-3',
        'model-4',
        'model-5',
        'model-6',
        'other',
        'unknown',
      ].sort(),
    );
    expect(timeline.series.find((s) => s.model === 'other')!.callCount).toBe(4);
    expect(timeline.series.find((s) => s.model === 'unknown')!.callCount).toBe(1);
    db.close();
  });

  test('merges more than 400 timed calls into exactly 400 buckets and preserves the running total', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    for (let i = 0; i < 401; i += 1) call(db, 'root', i, 1, 'm', new Date(i * 1000).toISOString());
    const result = readProfileTimeline(db, 'root')!;
    expect(result.points).toHaveLength(400);
    expect(result.points.at(-1)!.totalCumulative).toBe(401);
    expect(result.points.reduce((sum, p) => sum + (p.totalDelta ?? 0), 0)).toBe(401);
    db.close();
  });

  test('single session with exactly 400 or fewer timed calls gets one point per call', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    for (let i = 0; i < 5; i += 1) call(db, 'root', i, 1, 'm', new Date(i * 1000).toISOString());
    const result = readProfileTimeline(db, 'root')!;
    expect(result.points).toHaveLength(5);
    db.close();
  });

  test('spawn markers come only from linked (unambiguous) spawn-call matches with a usable at', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'linked', 'root', 'a');
    action(db, 'root', 0, 'a', 'linked', '2025-01-01T00:00:00Z');
    session(db, 'amb-1', 'root', 'b');
    session(db, 'amb-2', 'root', 'b');
    action(db, 'root', 1, 'b', 'amb-1', '2025-01-01T00:00:01Z');
    session(db, 'no-at', 'root', 'c');
    action(db, 'root', 2, 'c', 'no-at', null);
    const result = readProfileTimeline(db, 'root')!;
    expect(result.spawns).toEqual([
      { at: '2025-01-01T00:00:00Z', parentId: 'root', childId: 'linked' },
    ]);
    db.close();
  });

  test('own scope excludes descendant calls; missing root returns null', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'child', 'root');
    call(db, 'root', 0, 1, 'm', '2025-01-01T00:00:00Z');
    call(db, 'child', 0, 2, 'm', '2025-01-01T00:00:01Z');
    const own = readProfileTimeline(db, 'root', { scope: 'own' })!;
    expect(own.points).toHaveLength(1);
    expect(own.points[0]!.totalCumulative).toBe(1);
    const tree = readProfileTimeline(db, 'root')!;
    expect(tree.points).toHaveLength(2);
    expect(readProfileTimeline(db, 'missing')).toBeNull();
    db.close();
  });
});
