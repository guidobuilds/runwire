import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readProfileModels } from './profile-models';
import { openStore } from './store';

function seed(db: Database): void {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['h', 'Harness', '1', '[]'],
  );
}

/** Idempotently upserts a raw model string and returns its `models.id`. */
function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}

function session(db: Database, id: string, parent: string | null = null): void {
  db.run('INSERT INTO sessions (id, harness_id, parent_id, source_path) VALUES (?, ?, ?, ?)', [
    id,
    'h',
    parent,
    `source:${id}`,
  ]);
}

/** A `kind='call'` step; a null model writes `model_id = NULL`. */
function call(
  db: Database,
  sessionId: string,
  seq: number,
  model: string | null,
  output: number | null,
): void {
  db.run('INSERT INTO steps (session_id, seq, kind, model_id, output) VALUES (?, ?, ?, ?, ?)', [
    sessionId,
    seq,
    'call',
    model === null ? null : modelId(db, model),
    output,
  ]);
}

describe('readProfileModels', () => {
  test('computes exact output-token shares for the own group', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    call(db, 'root', 0, 'model-a', 700);
    call(db, 'root', 1, 'model-b', 300);

    const res = readProfileModels(db, 'root');
    expect(res).not.toBeNull();
    expect(res!.sessionId).toBe('root');
    expect(res!.session.outputTokens).toBe(1000);
    expect(res!.session.models).toEqual([
      { model: 'model-a', outputTokens: 700, share: 0.7 },
      { model: 'model-b', outputTokens: 300, share: 0.3 },
    ]);
    // No descendants => the empty-group shape, not a group with an 'other'.
    expect(res!.descendants).toEqual({ outputTokens: 0, models: [] });

    db.close();
  });

  test('caps at top-7 named entries plus a single other bucket on a 9-model fixture', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    for (let i = 0; i < 9; i += 1) {
      // model-0 (90) .. model-8 (10): the two lowest outputs fold into 'other'.
      call(db, 'root', i, `model-${i}`, (9 - i) * 10);
    }

    const res = readProfileModels(db, 'root')!;
    expect(res.session.outputTokens).toBe(450);
    expect(res.session.models).toHaveLength(8);
    expect(res.session.models.map((m) => m.model)).toEqual([
      'model-0',
      'model-1',
      'model-2',
      'model-3',
      'model-4',
      'model-5',
      'model-6',
      'other',
    ]);
    // other sum = model-7 (20) + model-8 (10).
    expect(res.session.models.at(-1)).toEqual({
      model: 'other',
      outputTokens: 30,
      share: 30 / 450,
    });

    db.close();
  });

  test('descendants exclude the session own steps and reach grandchildren', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'root/child', 'root');
    session(db, 'root/child/grand', 'root/child');
    // root's own model-own must NOT leak into the descendants group.
    call(db, 'root', 0, 'model-own', 500);
    call(db, 'root/child', 0, 'model-own', 25);
    call(db, 'root/child', 1, 'model-child', 100);
    call(db, 'root/child/grand', 0, 'model-grand', 50);

    const res = readProfileModels(db, 'root')!;
    expect(res.session).toEqual({
      outputTokens: 500,
      models: [{ model: 'model-own', outputTokens: 500, share: 1 }],
    });
    // 25 + 100 + 50 = 175; if root's own 500 were included this would be 675.
    expect(res.descendants.outputTokens).toBe(175);
    expect(res.descendants.models).toEqual([
      { model: 'model-child', outputTokens: 100, share: 100 / 175 },
      { model: 'model-grand', outputTokens: 50, share: 50 / 175 },
      { model: 'model-own', outputTokens: 25, share: 25 / 175 },
    ]);

    db.close();
  });

  test('excludes NULL-model steps from numerator and denominator', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    call(db, 'root', 0, 'model-a', 100);
    call(db, 'root', 1, null, 999);

    const res = readProfileModels(db, 'root')!;
    expect(res.session.outputTokens).toBe(100);
    expect(res.session.models).toEqual([{ model: 'model-a', outputTokens: 100, share: 1 }]);

    db.close();
  });

  test('lists a 0-output named model within the top 7 with share 0', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    call(db, 'root', 0, 'model-a', 100);
    call(db, 'root', 1, 'model-b', 0);
    call(db, 'root', 2, 'model-c', null);

    const res = readProfileModels(db, 'root')!;
    expect(res.session.outputTokens).toBe(100);
    expect(res.session.models).toEqual([
      { model: 'model-a', outputTokens: 100, share: 1 },
      { model: 'model-b', outputTokens: 0, share: 0 },
      { model: 'model-c', outputTokens: 0, share: 0 },
    ]);

    db.close();
  });

  test("folds literal 'unknown'/'other' model names into a single other entry", () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    call(db, 'root', 0, 'model-a', 100);
    call(db, 'root', 1, 'unknown', 40);
    call(db, 'root', 2, 'other', 10);

    const res = readProfileModels(db, 'root')!;
    expect(res.session.outputTokens).toBe(150);
    expect(res.session.models).toEqual([
      { model: 'model-a', outputTokens: 100, share: 100 / 150 },
      { model: 'other', outputTokens: 50, share: 50 / 150 },
    ]);

    db.close();
  });

  test('returns null for a missing session', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    expect(readProfileModels(db, 'missing')).toBeNull();
    db.close();
  });
});
