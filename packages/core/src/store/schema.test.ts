import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrate } from './schema';

function columns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function hasIndex(db: Database, name: string): boolean {
  return (
    db.query(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name) !== null
  );
}

describe('migrate(): source_id/source_locator columns, backfill and UNIQUE index', () => {
  test('a fresh DB gets the source_id/source_locator columns and the UNIQUE index', () => {
    const db = new Database(':memory:');
    migrate(db);
    const cols = columns(db, 'sessions');
    expect(cols).toContain('source_id');
    expect(cols).toContain('source_locator');
    expect(hasIndex(db, 'idx_sessions_source_id')).toBe(true);
  });

  test('a pre-populated DB (rows with source_path, no source_id) is backfilled', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES ('fake:s1', 'fake', NULL, 0, '/fake/s1.jsonl', 10, 1)`,
    );
    // Simulate a pre-migration row by NULLing the new columns.
    db.run('UPDATE sessions SET source_id = NULL, source_locator = NULL');

    migrate(db);

    const row = db
      .query('SELECT source_id, source_locator FROM sessions WHERE id = ?')
      .get('fake:s1') as { source_id: string | null; source_locator: string | null };
    expect(row.source_id).toBe('/fake/s1.jsonl');
    expect(row.source_locator).toBe('/fake/s1.jsonl');
  });

  test('running migrate() twice is a no-op (idempotent)', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES ('fake:s1', 'fake', NULL, 0, '/fake/s1.jsonl', 10, 1)`,
    );
    migrate(db);
    migrate(db);
    const cols = columns(db, 'sessions');
    expect(cols).toContain('source_id');
    expect(hasIndex(db, 'idx_sessions_source_id')).toBe(true);
    const row = db
      .query('SELECT source_id, source_locator FROM sessions WHERE id = ?')
      .get('fake:s1') as { source_id: string | null; source_locator: string | null };
    expect(row.source_id).toBe('/fake/s1.jsonl');
  });

  test('a row that already has a distinct source_id is NOT overwritten by the backfill', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_id, source_locator, source_size, source_mtime)
       VALUES ('fake:s1', 'fake', NULL, 0, '/fake/s1.jsonl', 'opencode:current:ses_1', '/db/opencode.db', 10, 1)`,
    );
    migrate(db);
    const row = db
      .query('SELECT source_id, source_locator FROM sessions WHERE id = ?')
      .get('fake:s1') as { source_id: string | null; source_locator: string | null };
    expect(row.source_id).toBe('opencode:current:ses_1');
    expect(row.source_locator).toBe('/db/opencode.db');
  });
});

// The pre-normalization shape: `sessions.model_primary` and `steps.model` are
// raw text, `models` does not exist, and the source-identity columns are
// absent (they were added by ensureColumn, so the rebuild must re-add them).
const LEGACY_MODEL_DDL = `
CREATE TABLE harnesses (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  capabilities TEXT NOT NULL
);
CREATE TABLE projects (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_root TEXT,
  worktree TEXT,
  identity TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  harness_id TEXT NOT NULL,
  project_key TEXT,
  parent_id TEXT,
  relation TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  agent_type TEXT,
  spawn_call_id TEXT,
  title TEXT,
  cwd TEXT,
  git_branch TEXT,
  git_commit TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  model_primary TEXT,
  model_changes INTEGER,
  mode_primary TEXT,
  mode_changes INTEGER,
  effort TEXT,
  uncached_input INTEGER,
  cached_input INTEGER,
  cache_write INTEGER,
  output INTEGER,
  reasoning_output INTEGER,
  turns INTEGER,
  api_calls INTEGER,
  tool_calls INTEGER,
  compactions INTEGER,
  cost_usd REAL,
  initiator_kind TEXT,
  initiator_surface TEXT,
  initiator_automation TEXT,
  resumed INTEGER,
  forked_from TEXT,
  harness_version_first TEXT,
  harness_version_last TEXT,
  source_path TEXT NOT NULL UNIQUE,
  source_size INTEGER,
  source_mtime REAL
);
CREATE TABLE steps (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at TEXT,
  kind TEXT NOT NULL,
  model TEXT,
  tool_category TEXT,
  tool_name TEXT,
  skill_name TEXT,
  call_id TEXT,
  child_id TEXT,
  duration_ms INTEGER,
  error INTEGER,
  uncached_input INTEGER,
  cached_input INTEGER,
  cache_write INTEGER,
  output INTEGER,
  reasoning_output INTEGER,
  compaction_trigger TEXT,
  pre_tokens INTEGER,
  post_tokens INTEGER,
  from_value TEXT,
  to_value TEXT,
  PRIMARY KEY (session_id, seq)
);
`;

/** A legacy-shaped DB with model text columns (and NULL-model rows) pre-seeded. */
function seedLegacyModelDb(): Database {
  const db = new Database(':memory:');
  db.exec(LEGACY_MODEL_DDL);
  db.run("INSERT INTO harnesses VALUES ('fake', 'Fake', '1.0.0', '[]')");
  db.run("INSERT INTO projects VALUES ('k', 'K', '/repo', '/wt', 'cwd')");
  const insertSession = db.query(
    `INSERT INTO sessions (id, harness_id, project_key, parent_id, started_at, output, model_primary, source_path, source_size, source_mtime)
     VALUES (?, 'fake', 'k', ?, ?, ?, ?, ?, 1, 1)`,
  );
  insertSession.run('s1', null, '2026-01-01T00:00:00Z', 100, 'claude-sonnet-4', '/a.jsonl');
  insertSession.run('s2', null, '2026-01-02T00:00:00Z', 200, 'gpt-5', '/b.jsonl');
  insertSession.run('s3', null, '2026-01-03T00:00:00Z', 300, null, '/c.jsonl');
  insertSession.run('s1c', 's1', '2026-01-04T00:00:00Z', 50, 'gpt-5', '/d.jsonl');
  const insertStep = db.query(
    'INSERT INTO steps (session_id, seq, kind, model, output) VALUES (?, ?, ?, ?, ?)',
  );
  insertStep.run('s1', 0, 'call', 'claude-sonnet-4', 10);
  insertStep.run('s1', 1, 'call', 'gpt-5', 5);
  insertStep.run('s1', 2, 'call', null, 3);
  insertStep.run('s1', 3, 'tool', null, null);
  insertStep.run('s2', 0, 'call', 'gpt-5', 20);
  insertStep.run('s3', 0, 'call', 'unknown', 1);
  insertStep.run('s3', 1, 'call', 'other', 1);
  insertStep.run('s1c', 0, 'call', 'gpt-5', 7);
  return db;
}

function indexNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA index_list(${table})`).all() as { name: string }[]).map((r) => r.name);
}

function snapshot(db: Database): string {
  return JSON.stringify({
    sessionColumns: columns(db, 'sessions'),
    stepColumns: columns(db, 'steps'),
    models: db.query('SELECT id, name FROM models ORDER BY name').all(),
    sessions: db.query('SELECT * FROM sessions ORDER BY id').all(),
    steps: db.query('SELECT * FROM steps ORDER BY session_id, seq').all(),
  });
}

describe('migrate(): models table + model-identity rebuild', () => {
  test('a fresh DB has model_id/model_primary_id and neither text model column', () => {
    const db = new Database(':memory:');
    migrate(db);
    expect(columns(db, 'steps')).toContain('model_id');
    expect(columns(db, 'steps')).not.toContain('model');
    expect(columns(db, 'sessions')).toContain('model_primary_id');
    expect(columns(db, 'sessions')).not.toContain('model_primary');
    expect(columns(db, 'models')).toEqual(['id', 'name']);
    expect(
      (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
        .map((r) => r.name)
        .includes('models'),
    ).toBe(true);
    // `name` is UNIQUE and `id` auto-assigns.
    db.run("INSERT INTO models (name) VALUES ('x')");
    expect(() => db.run("INSERT INTO models (name) VALUES ('x')")).toThrow();
    const row = db.query("INSERT INTO models (name) VALUES ('y') RETURNING id").get() as {
      id: number;
    };
    expect(Number.isInteger(row.id)).toBe(true);
    db.close();
  });

  test('a legacy DB rebuilds losslessly: rows preserved, ids resolved, NULLs kept, models deduped', () => {
    const db = seedLegacyModelDb();
    migrate(db);

    expect(columns(db, 'steps')).toContain('model_id');
    expect(columns(db, 'steps')).not.toContain('model');
    expect(columns(db, 'sessions')).toContain('model_primary_id');
    expect(columns(db, 'sessions')).not.toContain('model_primary');

    // Every pre-existing row survives row-for-row.
    expect((db.query('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(4);
    expect((db.query('SELECT COUNT(*) AS n FROM steps').get() as { n: number }).n).toBe(8);

    // Each distinct raw string lands in `models` exactly once, written as-is
    // (including the reserved 'unknown'/'other' literals).
    expect(
      (db.query('SELECT name FROM models ORDER BY name').all() as { name: string }[]).map(
        (r) => r.name,
      ),
    ).toEqual(['claude-sonnet-4', 'gpt-5', 'other', 'unknown']);

    // Ids resolve by exact string match; NULL stays NULL.
    expect(
      db
        .query(
          `SELECT s.id AS id, mp.name AS model
           FROM sessions s LEFT JOIN models mp ON mp.id = s.model_primary_id
           ORDER BY s.id`,
        )
        .all(),
    ).toEqual([
      { id: 's1', model: 'claude-sonnet-4' },
      { id: 's1c', model: 'gpt-5' },
      { id: 's2', model: 'gpt-5' },
      { id: 's3', model: null },
    ]);

    expect(
      db
        .query(
          `SELECT st.session_id AS sid, st.seq AS seq, st.kind AS kind, m.name AS model, st.output AS output
           FROM steps st LEFT JOIN models m ON m.id = st.model_id
           ORDER BY st.session_id, st.seq`,
        )
        .all(),
    ).toEqual([
      { sid: 's1', seq: 0, kind: 'call', model: 'claude-sonnet-4', output: 10 },
      { sid: 's1', seq: 1, kind: 'call', model: 'gpt-5', output: 5 },
      { sid: 's1', seq: 2, kind: 'call', model: null, output: 3 },
      { sid: 's1', seq: 3, kind: 'tool', model: null, output: null },
      { sid: 's1c', seq: 0, kind: 'call', model: 'gpt-5', output: 7 },
      { sid: 's2', seq: 0, kind: 'call', model: 'gpt-5', output: 20 },
      { sid: 's3', seq: 0, kind: 'call', model: 'unknown', output: 1 },
      { sid: 's3', seq: 1, kind: 'call', model: 'other', output: 1 },
    ]);

    // Non-model columns copy verbatim (and the source identity is preserved
    // through the ensureColumn backfill before the rebuild).
    expect(db.query('SELECT * FROM sessions WHERE id = ?').get('s1')).toMatchObject({
      started_at: '2026-01-01T00:00:00Z',
      output: 100,
      parent_id: null,
      source_path: '/a.jsonl',
      source_id: '/a.jsonl',
    });
    expect(db.query('SELECT parent_id FROM sessions WHERE id = ?').get('s1c')).toEqual({
      parent_id: 's1',
    });
    db.close();
  });

  test('a sessions-only rebuild (already-canonical steps) resolves names and leaves steps untouched', () => {
    const db = new Database(':memory:');
    migrate(db);
    // Simulate the intermediate shape: `steps` already normalized, `sessions`
    // still text-keyed.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DROP TABLE sessions');
    db.exec(
      `CREATE TABLE sessions (
         id TEXT PRIMARY KEY,
         harness_id TEXT NOT NULL,
         depth INTEGER NOT NULL DEFAULT 0,
         model_primary TEXT,
         source_path TEXT NOT NULL UNIQUE,
         source_size INTEGER,
         source_mtime REAL
       )`,
    );
    db.exec('PRAGMA foreign_keys = ON');
    db.run("INSERT INTO harnesses VALUES ('fake', 'Fake', '1.0.0', '[]')");
    db.run(
      `INSERT INTO sessions (id, harness_id, model_primary, source_path, source_size, source_mtime)
       VALUES ('s1', 'fake', 'claude-sonnet-4', '/a', 1, 1), ('s2', 'fake', NULL, '/b', 1, 1)`,
    );
    db.run("INSERT INTO steps (session_id, seq, kind, model_id) VALUES ('s1', 0, 'call', NULL)");

    migrate(db);

    expect(columns(db, 'sessions')).toContain('model_primary_id');
    expect(columns(db, 'sessions')).not.toContain('model_primary');
    expect(columns(db, 'steps')).toContain('model_id');
    expect(
      db
        .query(
          `SELECT s.id AS id, mp.name AS model
           FROM sessions s LEFT JOIN models mp ON mp.id = s.model_primary_id
           ORDER BY s.id`,
        )
        .all(),
    ).toEqual([
      { id: 's1', model: 'claude-sonnet-4' },
      { id: 's2', model: null },
    ]);
    expect(db.query('SELECT session_id, seq, kind, model_id FROM steps').all()).toEqual([
      { session_id: 's1', seq: 0, kind: 'call', model_id: null },
    ]);
    db.close();
  });

  test('an ancient DB lacking steps.model rebuilds with NULL ids', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE harnesses (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, adapter_version TEXT NOT NULL, capabilities TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, harness_id TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0, source_path TEXT NOT NULL UNIQUE, model_primary TEXT);
      CREATE TABLE steps (session_id TEXT, seq INTEGER, kind TEXT, PRIMARY KEY (session_id, seq));
    `);
    db.run("INSERT INTO harnesses VALUES ('fake', 'Fake', '1.0.0', '[]')");
    db.run(
      "INSERT INTO sessions (id, harness_id, depth, source_path, model_primary) VALUES ('a', 'fake', 0, '/a', NULL)",
    );
    db.run("INSERT INTO steps (session_id, seq, kind) VALUES ('a', 0, 'call')");

    migrate(db);

    expect(columns(db, 'steps')).toContain('model_id');
    expect(columns(db, 'steps')).toContain('skill_name');
    expect(columns(db, 'steps')).not.toContain('model');
    expect(columns(db, 'sessions')).toContain('model_primary_id');
    expect((db.query('SELECT COUNT(*) AS n FROM models').get() as { n: number }).n).toBe(0);
    expect(db.query('SELECT session_id, seq, kind, model_id FROM steps').all()).toEqual([
      { session_id: 'a', seq: 0, kind: 'call', model_id: null },
    ]);
    expect((db.query('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(1);
    expect(() => migrate(db)).not.toThrow();
    db.close();
  });

  test('running migrate() twice after a rebuild is a no-op (columns and data unchanged)', () => {
    const db = seedLegacyModelDb();
    migrate(db);
    const before = snapshot(db);
    migrate(db);
    expect(snapshot(db)).toBe(before);
    db.close();
  });

  test('deleting a session still cascades its steps after the rebuild', () => {
    const db = seedLegacyModelDb();
    migrate(db);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec("DELETE FROM sessions WHERE id = 's1'");
    expect(
      (db.query("SELECT COUNT(*) AS n FROM steps WHERE session_id = 's1'").get() as { n: number })
        .n,
    ).toBe(0);
    // 8 seeded steps minus s1's four.
    expect((db.query('SELECT COUNT(*) AS n FROM steps').get() as { n: number }).n).toBe(4);
    db.close();
  });

  test('a rebuild that would leave an FK violation throws instead of committing silently', () => {
    const db = seedLegacyModelDb();
    // A dangling harness reference survives the copy (foreign_keys is OFF) but
    // must be caught by the post-rebuild `foreign_key_check`.
    db.exec('DELETE FROM harnesses');
    expect(() => migrate(db)).toThrow(/foreign-key violation/);
    db.close();
  });

  test('the rebuilt tables carry every index the dropped tables had (incl. the new model index)', () => {
    const db = seedLegacyModelDb();
    migrate(db);
    expect(indexNames(db, 'steps')).toEqual(
      expect.arrayContaining(['idx_steps_session_id', 'idx_steps_session_kind_model']),
    );
    expect(indexNames(db, 'sessions')).toEqual(
      expect.arrayContaining([
        'idx_sessions_parent_id',
        'idx_sessions_project_key',
        'idx_sessions_harness_id',
        'idx_sessions_source_id',
        'idx_sessions_root_started',
      ]),
    );
    const sourceIndex = (
      db.query('PRAGMA index_list(sessions)').all() as { name: string; unique: number }[]
    ).find((r) => r.name === 'idx_sessions_source_id');
    expect(sourceIndex?.unique).toBe(1);
    db.close();
  });
});
