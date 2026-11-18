import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readProfileSpawns } from './profile-spawns';
import { openStore } from './store';

function setup(): Database {
  const { db } = openStore(':memory:');
  db.run(
    "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('h', 'H', '1', '[]')",
  );
  return db;
}
function session(
  db: Database,
  id: string,
  parentId: string | null = null,
  callId: string | null = null,
  relation: string | null = null,
): void {
  db.run(
    'INSERT INTO sessions (id, harness_id, parent_id, spawn_call_id, relation, source_path) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'h', parentId, callId, relation, `source:${id}`],
  );
}
function action(
  db: Database,
  parent: string,
  seq: number,
  callId: string | null,
  childId: string | null = null,
  name = 'Task',
  at: string | null = null,
): void {
  db.run(
    "INSERT INTO steps (session_id, seq, kind, tool_category, tool_name, call_id, child_id, at) VALUES (?, ?, 'tool', 'agent', ?, ?, ?, ?)",
    [parent, seq, name, callId, childId, at],
  );
}

describe('readProfileSpawns', () => {
  test('reports every causal status without trusting child_id as candidate identity', () => {
    const db = setup();
    session(db, 'root');
    session(db, 'linked', 'root', 'a');
    action(db, 'root', 1, 'a', 'linked');
    session(db, 'missing', 'root');
    session(db, 'not-found', 'root', 'b');
    session(db, 'amb-1', 'root', 'c');
    session(db, 'amb-2', 'root', 'c');
    action(db, 'root', 2, 'c', 'amb-1');
    session(db, 'inconsistent', 'root', 'd');
    action(db, 'root', 3, 'd', 'dangling');
    session(db, 'unresolved-child', 'root', 'e');
    action(db, 'root', 4, 'e');
    action(db, 'root', 5, 'no-child');
    action(db, 'root', 6, null);
    const result = readProfileSpawns(db, 'root')!;
    expect(result.items.map((x) => [x.child?.id ?? null, x.callId, x.causalStatus])).toEqual([
      ['amb-1', 'c', 'ambiguous'],
      ['amb-2', 'c', 'ambiguous'],
      ['inconsistent', 'd', 'inconsistent'],
      ['linked', 'a', 'linked'],
      ['missing', null, 'missing-call-id'],
      ['not-found', 'b', 'call-not-found'],
      ['unresolved-child', 'e', 'unresolved'],
      [null, 'no-child', 'unresolved'],
      [null, null, 'missing-call-id'],
    ]);
    expect(result.counts).toEqual({
      linked: 1,
      'missing-call-id': 2,
      'call-not-found': 1,
      ambiguous: 2,
      inconsistent: 1,
      unresolved: 2,
    });
    db.close();
  });

  test('threads callAt from the matched action, null when unmatched/ambiguous/missing-call-id', () => {
    const db = setup();
    session(db, 'root');
    session(db, 'linked', 'root', 'a');
    action(db, 'root', 1, 'a', 'linked', 'Task', '2025-01-01T00:00:00Z');
    session(db, 'missing', 'root');
    session(db, 'not-found', 'root', 'b');
    session(db, 'amb-1', 'root', 'c');
    session(db, 'amb-2', 'root', 'c');
    action(db, 'root', 2, 'c', 'amb-1', 'Task', '2025-01-02T00:00:00Z');
    session(db, 'no-at', 'root', 'f');
    action(db, 'root', 7, 'f', 'no-at', 'Task', null);
    action(db, 'root', 8, 'lone', null, 'Task', '2025-01-03T00:00:00Z');
    const result = readProfileSpawns(db, 'root')!;
    const byChild = new Map(result.items.map((x) => [x.child?.id ?? x.callId, x]));
    expect(byChild.get('linked')).toMatchObject({
      causalStatus: 'linked',
      callAt: '2025-01-01T00:00:00Z',
    });
    expect(byChild.get('missing')).toMatchObject({ causalStatus: 'missing-call-id', callAt: null });
    expect(byChild.get('not-found')).toMatchObject({
      causalStatus: 'call-not-found',
      callAt: null,
    });
    expect(byChild.get('amb-1')).toMatchObject({ causalStatus: 'ambiguous', callAt: null });
    expect(byChild.get('amb-2')).toMatchObject({ causalStatus: 'ambiguous', callAt: null });
    expect(byChild.get('no-at')).toMatchObject({ causalStatus: 'linked', callAt: null });
    expect(byChild.get('lone')).toMatchObject({
      child: null,
      causalStatus: 'unresolved',
      callAt: '2025-01-03T00:00:00Z',
    });
    db.close();
  });

  test('requires an agent tool on the same parent and treats duplicate calls as ambiguous', () => {
    const db = setup();
    session(db, 'root');
    session(db, 'child', 'root', 'x');
    session(db, 'other');
    action(db, 'other', 1, 'x', 'child');
    expect(readProfileSpawns(db, 'root')!.items[0]!.causalStatus).toBe('call-not-found');
    action(db, 'root', 1, 'x', 'child', 'SendMessage');
    action(db, 'root', 2, 'x', 'child', 'ListAgents');
    expect(readProfileSpawns(db, 'root')!.items[0]!.causalStatus).toBe('ambiguous');
    db.close();
  });

  test('keeps own children as out-of-scope context and tree children as members', () => {
    const db = setup();
    session(db, 'root');
    session(db, 'kid', 'root', 'x', 'teammate');
    action(db, 'root', 1, 'x', 'kid');
    session(db, 'fork', 'kid', 'y', 'fork');
    action(db, 'kid', 1, 'y', 'fork');
    const own = readProfileSpawns(db, 'root', { scope: 'own' })!;
    expect(own.nodes.map((n) => n.id)).toEqual(['root']);
    expect(own.items[0]!.childInScope).toBe(false);
    const tree = readProfileSpawns(db, 'root')!;
    expect(tree.items.map((x) => x.child?.relation)).toEqual(['teammate', 'fork']);
    expect(tree.items.every((x) => x.childInScope)).toBe(true);
    db.close();
  });

  test('counts scoped dangling parents with EXISTS, terminates cycles, and pages stable order', () => {
    const db = setup();
    session(db, 'root');
    session(db, 'z', 'root');
    session(db, 'a', 'root');
    session(db, 'orphan', 'gone');
    session(db, 'cycle-a', 'cycle-b');
    session(db, 'cycle-b', 'cycle-a');
    expect(readProfileSpawns(db, 'orphan')!.orphanSessionCount).toBe(1);
    expect(
      readProfileSpawns(db, 'root', { scope: 'own', limit: 1, offset: 1 })!.items.map(
        (x) => x.child?.id,
      ),
    ).toEqual(['z']);
    expect(readProfileSpawns(db, 'cycle-a')!.nodes.map((n) => n.id)).toEqual([
      'cycle-a',
      'cycle-b',
    ]);
    expect(readProfileSpawns(db, 'missing')).toBeNull();
    db.close();
  });
});
