import type { Database } from 'bun:sqlite';

const MODELS_TABLE_BODY = `(
  id INTEGER PRIMARY KEY,
  provider TEXT,
  name TEXT NOT NULL
)`;

const MODELS_TABLE = `
CREATE TABLE IF NOT EXISTS models ${MODELS_TABLE_BODY};
`;

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
  mcp_server TEXT,
  mcp_tool TEXT,
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
  capabilities TEXT NOT NULL,
  imported_version TEXT
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

function ensureColumn(db: Database, table: string, column: string, type: string): void {
  if (!tableColumns(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function tableColumns(db: Database, table: string): Set<string> {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(cols.map((c) => c.name));
}

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
  'mcp_server',
  'mcp_tool',
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

function rebuildModelsProvider(db: Database): void {
  if (tableColumns(db, 'models').has('provider')) return;

  const foreignKeysWasOn =
    (db.query('PRAGMA foreign_keys').get() as { foreign_keys: number } | null)?.foreign_keys === 1;

  db.exec('PRAGMA foreign_keys = OFF');
  const run = db.transaction(() => {
    db.exec(`CREATE TABLE models_new ${MODELS_TABLE_BODY}`);
    db.exec('INSERT INTO models_new (id, provider, name) SELECT id, NULL, name FROM models');
    db.exec('DROP TABLE models');
    db.exec('ALTER TABLE models_new RENAME TO models');
  });
  run();
  db.exec(`PRAGMA foreign_keys = ${foreignKeysWasOn ? 'ON' : 'OFF'}`);
}

function rebuildModelIdentity(db: Database): void {
  const rebuildSteps =
    tableColumns(db, 'steps').has('model') || !tableColumns(db, 'steps').has('model_id');
  const rebuildSessions =
    tableColumns(db, 'sessions').has('model_primary') ||
    !tableColumns(db, 'sessions').has('model_primary_id');
  if (!rebuildSteps && !rebuildSessions) return;

  if (rebuildSteps) {
    ensureColumn(db, 'steps', 'model', 'TEXT');
    ensureColumn(db, 'steps', 'skill_name', 'TEXT');
  }
  if (rebuildSessions) {
    ensureColumn(db, 'sessions', 'model_primary', 'TEXT');
  }

  const stepsColumns = tableColumns(db, 'steps');
  const sessionsColumns = tableColumns(db, 'sessions');

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

export function migrate(db: Database): void {
  db.exec(DDL);
  rebuildModelsProvider(db);
  ensureColumn(db, 'sessions', 'source_id', 'TEXT');
  ensureColumn(db, 'sessions', 'source_locator', 'TEXT');
  db.exec(
    'UPDATE sessions SET source_id = source_path, source_locator = source_path WHERE source_id IS NULL',
  );

  ensureColumn(db, 'steps', 'mcp_server', 'TEXT');
  ensureColumn(db, 'steps', 'mcp_tool', 'TEXT');

  ensureColumn(db, 'harnesses', 'imported_version', 'TEXT');

  rebuildModelIdentity(db);

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_source_id ON sessions(source_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_parent_id ON sessions(parent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project_key ON sessions(project_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_harness_id ON sessions(harness_id)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sessions_root_started ON sessions(started_at, id) WHERE parent_id IS NULL',
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_steps_session_id ON steps(session_id)');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_models_provider_name ON models(provider, name) WHERE provider IS NOT NULL',
  );
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_models_name_no_provider ON models(name) WHERE provider IS NULL',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_steps_session_kind_model ON steps(session_id, kind, model_id)',
  );
}
