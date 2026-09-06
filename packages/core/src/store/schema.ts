import type { Database } from 'bun:sqlite';

// docs/ARCHITECTURE.md §5. `sessions.parent_id` and `steps.child_id` are
// plain indexed columns with NO foreign key (plan P20, spiked in
// grill.md §3 / lessons `bun-sqlite-self-fk-rejects-orphans-and-prepare-is-
// single-statement`): with `PRAGMA foreign_keys = ON`, a self-referencing FK
// on `parent_id` rejects an orphan child at insert time even
// `DEFERRABLE INITIALLY DEFERRED` (fails at the per-bundle COMMIT instead),
// and link.ts (f1-t7) must be able to persist an orphan and NULL it out
// afterward. `steps`, `session_tool_counts`, `diagnostics` and `rollups`
// keep real `ON DELETE CASCADE` FKs to `sessions(id)`.

const DDL = `
CREATE TABLE IF NOT EXISTS harnesses (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  capabilities TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_root TEXT,
  worktree TEXT,
  identity TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  harness_id TEXT NOT NULL REFERENCES harnesses(id),
  project_key TEXT REFERENCES projects(key),
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

CREATE TABLE IF NOT EXISTS steps (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS session_tool_counts (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (session_id, category)
);

CREATE TABLE IF NOT EXISTS diagnostics (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  line INTEGER,
  count INTEGER
);

CREATE TABLE IF NOT EXISTS rollups (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  uncached_input INTEGER,
  cached_input INTEGER,
  cache_write INTEGER,
  output INTEGER,
  reasoning_output INTEGER,
  api_calls INTEGER,
  tool_calls INTEGER,
  compactions INTEGER,
  descendants INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_parent_id ON sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_key ON sessions(project_key);
CREATE INDEX IF NOT EXISTS idx_sessions_harness_id ON sessions(harness_id);
CREATE INDEX IF NOT EXISTS idx_steps_session_id ON steps(session_id);
CREATE INDEX IF NOT EXISTS idx_diagnostics_session_id ON diagnostics(session_id);
CREATE INDEX IF NOT EXISTS idx_session_tool_counts_session_id ON session_tool_counts(session_id);

CREATE VIEW IF NOT EXISTS project_aggregates AS
SELECT
  p.key AS project_key,
  p.name AS name,
  p.repo_root AS repo_root,
  p.worktree AS worktree,
  p.identity AS identity,
  COUNT(s.id) AS session_count,
  SUM(r.uncached_input) AS uncached_input,
  SUM(r.cached_input) AS cached_input,
  SUM(r.cache_write) AS cache_write,
  SUM(r.output) AS output,
  SUM(r.reasoning_output) AS reasoning_output,
  SUM(r.api_calls) AS api_calls,
  SUM(r.tool_calls) AS tool_calls,
  SUM(r.compactions) AS compactions,
  MAX(s.ended_at) AS latest_activity_at
FROM sessions s
JOIN projects p ON p.key = s.project_key
LEFT JOIN rollups r ON r.session_id = s.id
WHERE s.parent_id IS NULL
GROUP BY p.key;

CREATE VIEW IF NOT EXISTS harness_aggregates AS
SELECT
  h.id AS harness_id,
  COUNT(s.id) AS session_count,
  COUNT(DISTINCT s.project_key) AS project_count,
  SUM(r.uncached_input) AS uncached_input,
  SUM(r.cached_input) AS cached_input,
  SUM(r.cache_write) AS cache_write,
  SUM(r.output) AS output,
  SUM(r.reasoning_output) AS reasoning_output,
  SUM(r.api_calls) AS api_calls,
  SUM(r.tool_calls) AS tool_calls,
  SUM(r.compactions) AS compactions,
  MAX(s.ended_at) AS latest_activity_at
FROM sessions s
JOIN harnesses h ON h.id = s.harness_id
LEFT JOIN rollups r ON r.session_id = s.id
WHERE s.parent_id IS NULL
GROUP BY h.id;
`;

/**
 * Adds a column to an existing table only when it is absent. `CREATE TABLE
 * IF NOT EXISTS` never alters a pre-existing table, so an existing (legacy)
 * DB would keep its old `steps` shape without the new `skill_name` column;
 * the `PRAGMA table_info` guard makes the `ALTER TABLE` a no-op on any DB
 * that already has the column (fresh `:memory:`, or a second `migrate()` run),
 * avoiding a "duplicate column name" error.
 */
function ensureColumn(db: Database, table: string, column: string, type: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Idempotent: every statement is IF NOT EXISTS, so running this twice is a no-op. */
export function migrate(db: Database): void {
  db.exec(DDL);
  ensureColumn(db, 'steps', 'skill_name', 'TEXT');
  // A legacy `steps` table (pre-`model`) has no `model` column; ensure it exists
  // before the `idx_steps_session_kind_model` index below is created. Idempotent.
  ensureColumn(db, 'steps', 'model', 'TEXT');
  // Source-identity split (design §2.4): additive nullable columns + backfill
  // + UNIQUE index on the effective source id. The backfill runs BEFORE the
  // UNIQUE INDEX so no NULL source_id exists at index time. A second
  // `migrate()` is a no-op: ensureColumn skips existing columns, the backfill
  // only fires `WHERE source_id IS NULL`, and the index is IF NOT EXISTS.
  ensureColumn(db, 'sessions', 'source_id', 'TEXT');
  ensureColumn(db, 'sessions', 'source_locator', 'TEXT');
  db.exec(
    'UPDATE sessions SET source_id = source_path, source_locator = source_path WHERE source_id IS NULL',
  );
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_source_id ON sessions(source_id)');
  // /sessions filter + pagination indexes (sessions-api-query T2 / D-11). The
  // partial index speeds the root query's started_at filter + the
  // ORDER BY started_at DESC, id; the steps index speeds the model filter
  // CTE's steps lookup. Idempotent (IF NOT EXISTS); no index is dropped as
  // lateral cleanup (idx_steps_session_id is kept even though the new
  // (session_id, kind, model) index makes it redundant).
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sessions_root_started ON sessions(started_at, id) WHERE parent_id IS NULL',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_steps_session_kind_model ON steps(session_id, kind, model)',
  );
}
