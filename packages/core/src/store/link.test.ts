import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { linkSessions } from './link';
import { openStore } from './store';

function seed(db: Database) {
  db.run(
    'INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)',
    ['fake', 'Fake', '1.0.0', '[]'],
  );
  db.run('INSERT INTO projects (key, name, identity) VALUES (?, ?, ?)', ['k', 'k', 'cwd']);
}

function insertSession(
  db: Database,
  id: string,
  opts: { parentId?: string; spawnCallId?: string; depth?: number } = {},
) {
  db.run(
    `INSERT INTO sessions (id, harness_id, project_key, parent_id, spawn_call_id, depth, source_path, source_size, source_mtime)
     VALUES (?, 'fake', 'k', ?, ?, ?, ?, 1, 1)`,
    [id, opts.parentId ?? null, opts.spawnCallId ?? null, opts.depth ?? 0, `/fake/${id}.jsonl`],
  );
}

function insertAgentToolStep(db: Database, sessionId: string, seq: number, callId: string) {
  db.run(
    "INSERT INTO steps (session_id, seq, kind, tool_category, call_id) VALUES (?, ?, 'tool', 'agent', ?)",
    [sessionId, seq, callId],
  );
}

function childIdOf(db: Database, sessionId: string, seq: number): string | null {
  const row = db
    .query('SELECT child_id FROM steps WHERE session_id = ? AND seq = ?')
    .get(sessionId, seq) as {
    child_id: string | null;
  };
  return row.child_id;
}

describe('linkSessions - child_id by spawn_call_id', () => {
  test('exact match: a tool/agent step is filled with the child whose spawn_call_id equals its call_id', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertAgentToolStep(db, 'fake:root', 0, 'c1');
    insertSession(db, 'fake:child1', { parentId: 'fake:root', spawnCallId: 'c1' });

    linkSessions(db);
    expect(childIdOf(db, 'fake:root', 0)).toBe('fake:child1');
  });

  test('decoy: a call_id with no matching spawn_call_id stays NULL', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertAgentToolStep(db, 'fake:root', 0, 'c-decoy');
    insertSession(db, 'fake:child1', { parentId: 'fake:root', spawnCallId: 'c1' });

    linkSessions(db);
    expect(childIdOf(db, 'fake:root', 0)).toBeNull();
  });

  test('children inserted out of order still link correctly (order-independent set operation)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertAgentToolStep(db, 'fake:root', 0, 'c1');
    insertAgentToolStep(db, 'fake:root', 1, 'c2');
    insertSession(db, 'fake:child2', { parentId: 'fake:root', spawnCallId: 'c2' });
    insertSession(db, 'fake:child1', { parentId: 'fake:root', spawnCallId: 'c1' });

    linkSessions(db);
    expect(childIdOf(db, 'fake:root', 0)).toBe('fake:child1');
    expect(childIdOf(db, 'fake:root', 1)).toBe('fake:child2');
  });

  test('collision: two children share a spawn_call_id, MIN(child.id) wins deterministically regardless of insertion order', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertAgentToolStep(db, 'fake:root', 0, 'c2');
    insertSession(db, 'fake:child4', { parentId: 'fake:root', spawnCallId: 'c2' });
    insertSession(db, 'fake:child3', { parentId: 'fake:root', spawnCallId: 'c2' });

    linkSessions(db);
    expect(childIdOf(db, 'fake:root', 0)).toBe('fake:child3');
  });

  test('a stale child_id is cleared once the child row is deleted', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertAgentToolStep(db, 'fake:root', 0, 'c1');
    insertSession(db, 'fake:child1', { parentId: 'fake:root', spawnCallId: 'c1' });
    linkSessions(db);
    expect(childIdOf(db, 'fake:root', 0)).toBe('fake:child1');

    db.run('DELETE FROM sessions WHERE id = ?', ['fake:child1']);
    linkSessions(db);
    expect(childIdOf(db, 'fake:root', 0)).toBeNull();
  });
});

describe('linkSessions - causal parent recovery', () => {
  test('reparents a flattened depth-2 agent to the depth-1 agent that spawned it', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertSession(db, 'fake:worker', { parentId: 'fake:root', depth: 1 });
    insertAgentToolStep(db, 'fake:worker', 0, 'spawn-leaf');
    insertSession(db, 'fake:leaf', {
      parentId: 'fake:root',
      spawnCallId: 'spawn-leaf',
      depth: 2,
    });

    linkSessions(db);

    const leaf = db.query('SELECT parent_id FROM sessions WHERE id = ?').get('fake:leaf') as {
      parent_id: string;
    };
    expect(leaf.parent_id).toBe('fake:worker');
    expect(childIdOf(db, 'fake:worker', 0)).toBe('fake:leaf');
  });

  test('leaves a flattened relationship untouched when the causal parent is ambiguous', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertSession(db, 'fake:worker-a', { parentId: 'fake:root', depth: 1 });
    insertSession(db, 'fake:worker-b', { parentId: 'fake:root', depth: 1 });
    insertAgentToolStep(db, 'fake:worker-a', 0, 'shared-call');
    insertAgentToolStep(db, 'fake:worker-b', 0, 'shared-call');
    insertSession(db, 'fake:leaf', {
      parentId: 'fake:root',
      spawnCallId: 'shared-call',
      depth: 2,
    });

    linkSessions(db);

    const leaf = db.query('SELECT parent_id FROM sessions WHERE id = ?').get('fake:leaf') as {
      parent_id: string;
    };
    expect(leaf.parent_id).toBe('fake:root');
  });

  test('causal recovery is idempotent', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertSession(db, 'fake:worker', { parentId: 'fake:root', depth: 1 });
    insertAgentToolStep(db, 'fake:worker', 0, 'spawn-leaf');
    insertSession(db, 'fake:leaf', {
      parentId: 'fake:root',
      spawnCallId: 'spawn-leaf',
      depth: 2,
    });

    linkSessions(db);
    linkSessions(db);

    const leaf = db.query('SELECT parent_id FROM sessions WHERE id = ?').get('fake:leaf') as {
      parent_id: string;
    };
    expect(leaf.parent_id).toBe('fake:worker');
    expect(childIdOf(db, 'fake:worker', 0)).toBe('fake:leaf');
  });

  test('recovers multiple flattened generations in one pass', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertSession(db, 'fake:worker', { parentId: 'fake:root', depth: 1 });
    insertAgentToolStep(db, 'fake:worker', 0, 'spawn-leaf');
    insertSession(db, 'fake:leaf', {
      parentId: 'fake:root',
      spawnCallId: 'spawn-leaf',
      depth: 2,
    });
    insertAgentToolStep(db, 'fake:leaf', 0, 'spawn-reviewer');
    insertSession(db, 'fake:reviewer', {
      parentId: 'fake:root',
      spawnCallId: 'spawn-reviewer',
      depth: 3,
    });

    linkSessions(db);

    const rows = db
      .query(
        "SELECT id, parent_id FROM sessions WHERE id IN ('fake:leaf', 'fake:reviewer') ORDER BY depth",
      )
      .all() as { id: string; parent_id: string }[];
    expect(rows).toEqual([
      { id: 'fake:leaf', parent_id: 'fake:worker' },
      { id: 'fake:reviewer', parent_id: 'fake:leaf' },
    ]);
  });
});

describe('linkSessions - orphan-child', () => {
  test('a session whose parent_id does not resolve becomes a root with a warn diagnostic, depth/relation untouched', () => {
    const { db } = openStore(':memory:');
    seed(db);
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, parent_id, relation, depth, source_path, source_size, source_mtime)
       VALUES ('fake:orphan', 'fake', 'k', 'fake:ghost', 'subagent', 2, '/fake/orphan.jsonl', 1, 1)`,
    );

    linkSessions(db);

    const row = db
      .query('SELECT parent_id, relation, depth FROM sessions WHERE id = ?')
      .get('fake:orphan') as {
      parent_id: string | null;
      relation: string;
      depth: number;
    };
    expect(row.parent_id).toBeNull();
    expect(row.relation).toBe('subagent');
    expect(row.depth).toBe(2);

    const diags = db
      .query('SELECT level, code FROM diagnostics WHERE session_id = ?')
      .all('fake:orphan') as { level: string; code: string }[];
    expect(diags).toEqual([{ level: 'warn', code: 'orphan-child' }]);
  });

  test('a valid parent_id is left alone and gets no orphan-child diagnostic', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:root');
    insertSession(db, 'fake:child1', { parentId: 'fake:root' });

    linkSessions(db);

    const row = db.query('SELECT parent_id FROM sessions WHERE id = ?').get('fake:child1') as {
      parent_id: string | null;
    };
    expect(row.parent_id).toBe('fake:root');
    expect(
      db.query('SELECT * FROM diagnostics WHERE session_id = ?').all('fake:child1').length,
    ).toBe(0);
  });

  test('running linkSessions twice does not duplicate the orphan-child diagnostic', () => {
    const { db } = openStore(':memory:');
    seed(db);
    insertSession(db, 'fake:orphan', { parentId: 'fake:ghost' });

    linkSessions(db);
    linkSessions(db);

    expect(
      db.query('SELECT * FROM diagnostics WHERE session_id = ?').all('fake:orphan').length,
    ).toBe(1);
  });
});
