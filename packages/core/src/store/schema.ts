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
//
// Model identity is normalized: `steps.model_id` / `sessions.model_primary_id`
// are hard FKs to `models(id)`, and the legacy text columns (`steps.model`,
// `sessions.model_primary`) are eliminated by a shape-guarded rebuild in
// `migrate()`. `models.name` is the exact raw harness model string (the
// canonical key; reserved names such as 'unknown'/'other' are stored as-is).

const MODELS_TABLE = `
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
`;

// Canonical column/shape bodies shared by the DDL (fresh DBs) and the
// shape-guarded rebuild (legacy DBs) so a rebuilt table is byte-identical to a
// fresh one. `source_id`/`source_locator` live in the table body rather than
// only being appended by `ensureColumn` so a rebuilt `sessions` keeps its
// explicit (e.g. OpenCode) source identity instead of backfilling from
// `source_path`.
const SESSIONS_TABLE_BODY = `(
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
  model_primary_id INTEGER REFERENCES models(id),
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
  source_mtime REAL,
  source_id TEXT,
  source_locator TEXT
)`;

const STEPS_TABLE_BODY = `(
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TEXT,
  kind TEXT NOT NULL,
  model_id INTEGER REFERENCES models(id),
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
)`;

const DDL = `
${MODELS_TABLE}
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

CREATE TABLE IF NOT EXISTS sessions ${SESSIONS_TABLE_BODY};

CREATE TABLE IF NOT EXISTS steps ${STEPS_TABLE_BODY};

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
  if (!tableColumns(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function tableColumns(db: Database, table: string): Set<string> {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(cols.map((c) => c.name));
}

// The canonical target column order for the rebuild copies. These mirror the
// column lists in SESSIONS_TABLE_BODY / STEPS_TABLE_BODY (the INSERT lists
// columns explicitly, so only the SELECT expression order must line up).
const SESSION_TARGET_COLUMNS = [
  'id',
  'harness_id',
  'project_key',
  'parent_id',
  'relation',
  'depth',
  'agent_type',
  'spawn_call_id',
  'title',
  'cwd',
  'git_branch',
  'git_commit',
  'started_at',
  'ended_at',
  'duration_ms',
  'model_primary_id',
  'model_changes',
  'mode_primary',
  'mode_changes',
  'effort',
  'uncached_input',
  'cached_input',
  'cache_write',
  'output',
  'reasoning_output',
  'turns',
  'api_calls',
  'tool_calls',
  'compactions',
  'cost_usd',
  'initiator_kind',
  'initiator_surface',
  'initiator_automation',
  'resumed',
  'forked_from',
  'harness_version_first',
  'harness_version_last',
  'source_path',
  'source_size',
  'source_mtime',
  'source_id',
  'source_locator',
] as const;

const STEP_TARGET_COLUMNS = [
  'session_id',
  'seq',
  'at',
  'kind',
  'model_id',
  'tool_category',
  'tool_name',
  'skill_name',
  'call_id',
  'child_id',
  'duration_ms',
  'error',
  'uncached_input',
  'cached_input',
  'cache_write',
  'output',
  'reasoning_output',
  'compaction_trigger',
  'pre_tokens',
  'post_tokens',
  'from_value',
  'to_value',
] as const;

/**
 * Builds the row-for-row copy from a legacy table into its `*_new` rebuild.
 * Every canonical target column is selected; one the legacy table lacks is
 * filled with NULL (so an ancient shape with only a handful of columns still
 * rebuilds), and the model-id column is resolved from the raw model string via
 * the `models` LEFT JOIN (NULL text -> NULL id). A LEFT JOIN preserves every
 * source row even when the text is NULL or (defensively) unmatched.
 */
function buildCopySql(
  target: string,
  source: string,
  targetColumns: readonly string[],
  oldColumns: Set<string>,
  modelIdColumn: string,
  modelTextColumn: string,
): string {
  const hasModelText = oldColumns.has(modelTextColumn);
  const cols = targetColumns.join(', ');
  const exprs = targetColumns
    .map((c) => {
      if (c === modelIdColumn) return hasModelText ? 'm.id' : 'NULL';
      return oldColumns.has(c) ? `s.${c}` : 'NULL';
    })
    .join(', ');
  const join = hasModelText ? ` LEFT JOIN models m ON m.name = s.${modelTextColumn}` : '';
  return `INSERT INTO ${target} (${cols}) SELECT ${exprs} FROM ${source} s${join}`;
}

/**
 * Shape-guarded, lossless, one-transaction rebuild that replaces the legacy
 * text model columns with hard FK ids. `steps` is rebuilt iff it still has
 * `model` or lacks `model_id` (the latter covers ancient pre-model DBs);
 * `sessions` likewise for `model_primary`/`model_primary_id`. Fresh DBs (and a
 * second `migrate()`) are a no-op, so they never regain the text columns.
 *
 * `PRAGMA foreign_keys` is a no-op inside a transaction, so it is switched off
 * before the transaction (the DROP/RENAME dance would otherwise cascade or
 * reject), then restored, and `foreign_key_check` runs last: any violation
 * throws so a corrupt rebuild can never commit silently.
 */
function rebuildModelIdentity(db: Database): void {
  const rebuildSteps =
    tableColumns(db, 'steps').has('model') || !tableColumns(db, 'steps').has('model_id');
  const rebuildSessions =
    tableColumns(db, 'sessions').has('model_primary') ||
    !tableColumns(db, 'sessions').has('model_primary_id');
  if (!rebuildSteps && !rebuildSessions) return;

  if (rebuildSteps) {
    // A legacy table may predate `model`/`skill_name`; ensure they exist so the
    // copy SELECT's source columns are all present. The rebuild then drops
    // them for real, so a fresh/migrated DB never regains a text column.
    ensureColumn(db, 'steps', 'model', 'TEXT');
    ensureColumn(db, 'steps', 'skill_name', 'TEXT');
  }
  if (rebuildSessions) {
    ensureColumn(db, 'sessions', 'model_primary', 'TEXT');
  }

  const stepsColumns = tableColumns(db, 'steps');
  const sessionsColumns = tableColumns(db, 'sessions');

  // Snapshot the raw strings into `models` first. Only text columns that
  // actually exist can contribute.
  const modelArms: string[] = [];
  if (stepsColumns.has('model')) {
    modelArms.push('SELECT model FROM steps WHERE model IS NOT NULL');
  }
  if (sessionsColumns.has('model_primary')) {
    modelArms.push('SELECT model_primary FROM sessions WHERE model_primary IS NOT NULL');
  }

  const foreignKeysWasOn =
    (db.query('PRAGMA foreign_keys').get() as { foreign_keys: number } | null)?.foreign_keys === 1;

  db.exec('PRAGMA foreign_keys = OFF');
  const run = db.transaction(() => {
    if (modelArms.length > 0) {
      db.exec(`INSERT OR IGNORE INTO models(name) ${modelArms.join(' UNION ')}`);
    }

    if (rebuildSteps) {
      db.exec(`CREATE TABLE steps_new ${STEPS_TABLE_BODY}`);
      db.exec(
        buildCopySql('steps_new', 'steps', STEP_TARGET_COLUMNS, stepsColumns, 'model_id', 'model'),
      );
      db.exec('DROP TABLE steps');
      db.exec('ALTER TABLE steps_new RENAME TO steps');
    }

    if (rebuildSessions) {
      db.exec(`CREATE TABLE sessions_new ${SESSIONS_TABLE_BODY}`);
      db.exec(
        buildCopySql(
          'sessions_new',
          'sessions',
          SESSION_TARGET_COLUMNS,
          sessionsColumns,
          'model_primary_id',
          'model_primary',
        ),
      );
      db.exec('DROP TABLE sessions');
      db.exec('ALTER TABLE sessions_new RENAME TO sessions');
    }
  });
  run();
  db.exec(`PRAGMA foreign_keys = ${foreignKeysWasOn ? 'ON' : 'OFF'}`);

  const violations = db.query('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error(
      `migrate(): model-identity rebuild left ${violations.length} foreign-key violation(s)`,
    );
  }
}

/** Idempotent: every statement is IF NOT EXISTS, so running this twice is a no-op. */
export function migrate(db: Database): void {
  db.exec(DDL);
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

  rebuildModelIdentity(db);

  // Every index on `sessions`/`steps` is created here, AFTER the rebuild: a
  // rebuild drops those tables (taking their indexes with them), and
  // `idx_steps_session_kind_model` references `model_id`, which a legacy table
  // lacks until the rebuild has run. Idempotent (IF NOT EXISTS); no index is
  // dropped as lateral cleanup (idx_steps_session_id is kept even though the
  // (session_id, kind, model_id) index makes it redundant).
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_source_id ON sessions(source_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_parent_id ON sessions(parent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project_key ON sessions(project_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_harness_id ON sessions(harness_id)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sessions_root_started ON sessions(started_at, id) WHERE parent_id IS NULL',
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_steps_session_id ON steps(session_id)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_steps_session_kind_model ON steps(session_id, kind, model_id)',
  );
}
