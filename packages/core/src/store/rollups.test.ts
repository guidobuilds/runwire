import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { recomputeRollups } from './rollups';
import { openStore } from './store';

function seed(db: Database) {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['fake', 'Fake', '1.0.0', '[]'],
  );
  db.run('INSERT INTO projects (key, name, identity) VALUES (?, ?, ?)', ['k', 'k', 'cwd']);
}

type Fields = {
  uncachedInput?: number | null;
  cachedInput?: number | null;
  cacheWrite?: number | null;
  output?: number | null;
  reasoningOutput?: number | null;
  apiCalls?: number | null;
  toolCalls?: number | null;
  compactions?: number | null;
};

function insertSession(db: Database, id: string, opts: { parentId?: string } & Fields = {}) {
  db.run(
    `INSERT INTO sessions (
       id, harness_id, project_key, parent_id, depth, source_path, source_size, source_mtime,
       uncached_input, cached_input, cache_write, output, reasoning_output, api_calls, tool_calls, compactions
     ) VALUES (?, 'fake', 'k', ?, 0, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.parentId ?? null,
      `/fake/${id}.jsonl`,
      opts.uncachedInput ?? null,
      opts.cachedInput ?? null,
      opts.cacheWrite ?? null,
      opts.output ?? null,
      opts.reasoningOutput ?? null,
      opts.apiCalls ?? null,
      opts.toolCalls ?? null,
      opts.compactions ?? null,
    ],
  );
}

function rollupOf(db: Database, id: string) {
  return db.query('SELECT * FROM rollups WHERE session_id = ?').get(id) as {
    session_id: string;
    uncached_input: number | null;
    cached_input: number | null;
    cache_write: number | null;
    output: number | null;
    reasoning_output: number | null;
    api_calls: number | null;
    tool_calls: number | null;
    compactions: number | null;
    descendants: number;
  } | null;
}

describe('recomputeRollups', () => {
  test('a childless root has inclusive = exclusive and descendants = 0', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:solo', { uncachedInput: 5, output: 7, apiCalls: 1 });

    recomputeRollups(db);

    const r = rollupOf(db, 'fake:solo');
    expect(r).toEqual({
      session_id: 'fake:solo',
      uncached_input: 5,
      cached_input: null,
      cache_write: null,
      output: 7,
      reasoning_output: null,
      api_calls: 1,
      tool_calls: null,
      compactions: null,
      descendants: 0,
    });
  });

  test('a 3-level tree plus a sibling sums every level inclusively', () => {
    const { db } = openStore(':memory:');
    seed(db);
    // R -> A -> C (grandchild); R -> B (sibling of A). descendants(R) = {A, B, C} = 3.
    insertSession(db, 'fake:R', {
      uncachedInput: 10,
      cachedInput: 2,
      cacheWrite: 1,
      output: 100,
      reasoningOutput: 1,
      apiCalls: 2,
    });
    insertSession(db, 'fake:A', {
      parentId: 'fake:R',
      uncachedInput: 30,
      cachedInput: 4,
      cacheWrite: 2,
      output: 300,
      reasoningOutput: 2,
      apiCalls: 3,
    });
    insertSession(db, 'fake:B', {
      parentId: 'fake:R',
      uncachedInput: 40,
      cachedInput: 6,
      cacheWrite: 3,
      output: 400,
      reasoningOutput: 4,
      apiCalls: 4,
    });
    insertSession(db, 'fake:C', {
      parentId: 'fake:A',
      uncachedInput: 50,
      cachedInput: 8,
      cacheWrite: 3,
      output: 500,
      reasoningOutput: 5,
      apiCalls: 5,
    });

    recomputeRollups(db);

    const root = rollupOf(db, 'fake:R');
    expect(root?.uncached_input).toBe(130);
    expect(root?.cached_input).toBe(20);
    expect(root?.cache_write).toBe(9);
    expect(root?.output).toBe(1300);
    expect(root?.reasoning_output).toBe(12);
    expect(root?.api_calls).toBe(14);
    expect(root?.descendants).toBe(3);

    const a = rollupOf(db, 'fake:A');
    expect(a?.output).toBe(800); // A(300) + C(500)
    expect(a?.descendants).toBe(1);

    const b = rollupOf(db, 'fake:B');
    expect(b?.output).toBe(400);
    expect(b?.descendants).toBe(0);

    const c = rollupOf(db, 'fake:C');
    expect(c?.output).toBe(500);
    expect(c?.descendants).toBe(0);
  });

  test('SUM stays NULL when every contributor for a field is NULL', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:allnull');

    recomputeRollups(db);

    const r = rollupOf(db, 'fake:allnull');
    expect(r?.uncached_input).toBeNull();
    expect(r?.output).toBeNull();
    expect(r?.api_calls).toBeNull();
    expect(r?.descendants).toBe(0);
  });

  test('a hand-inserted parent cycle terminates, each member counted once', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:X', { parentId: 'fake:Y', output: 10 });
    insertSession(db, 'fake:Y', { parentId: 'fake:X', output: 20 });

    expect(() => recomputeRollups(db)).not.toThrow();

    const x = rollupOf(db, 'fake:X');
    const y = rollupOf(db, 'fake:Y');
    // Each node's own tree walk includes both cycle members exactly once.
    expect(x?.output).toBe(30);
    expect(x?.descendants).toBe(1);
    expect(y?.output).toBe(30);
    expect(y?.descendants).toBe(1);
  });

  test('recompute is idempotent', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:R', { output: 100 });
    insertSession(db, 'fake:A', { parentId: 'fake:R', output: 200 });

    recomputeRollups(db);
    const first = rollupOf(db, 'fake:R');
    recomputeRollups(db);
    const second = rollupOf(db, 'fake:R');

    expect(second).toEqual(first);
  });

  test('deleting a session cascades its rollup row', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:R', { output: 100 });
    recomputeRollups(db);
    expect(rollupOf(db, 'fake:R')).not.toBeNull();

    db.run('DELETE FROM sessions WHERE id = ?', ['fake:R']);
    expect(rollupOf(db, 'fake:R')).toBeNull();
  });
});
