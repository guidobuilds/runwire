import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { profileScopeCte, profileScopeParams, readProfileScopeNodes } from './profile-scope';
import type { Event, EventFilter, MergedEventsQuery, MergedEventsResponse } from './profile-types';

type EventRow = {
  stream_id: string;
  seq: number;
  at: string | null;
  kind: Event['kind'];
  error: number | null;
  model: string | null;
  category: string | null;
  tool_name: string | null;
  duration_ms: number | null;
  trigger: string | null;
  from_value: string | null;
  to_value: string | null;
};

/* The exact, content-free definition of the curated default. `harness` steps
 * are hook evidence; `hook` also remains accepted if a future adapter maps it
 * as a tool category. Every arm is mutually exclusive at the source kind. */
const RELEVANT_SQL = `(
  error = 1
  OR kind IN ('harness', 'compaction', 'model-change', 'mode-change')
  OR (kind = 'tool' AND category IN ('mcp', 'skill', 'agent', 'hook'))
)`;

/* G8's merged-events default (session-profile-v2 design decision): unlike
 * `relevant`, `signals` deliberately drops hook/harness and mode-change —
 * hooks fire on every tool call and would flood a globally merged table. */
const SIGNALS_SQL = `(
  error = 1
  OR kind IN ('compaction', 'model-change')
  OR (kind = 'tool' AND category IN ('mcp', 'skill', 'agent'))
)`;

/* Seven source variants, with an explicit metadata-only column list for every
 * arm. No catch-all arm means an unknown future source kind cannot leak into
 * the profile by accident, and UNION ALL is safe because source kinds differ. */
const EVENTS_CTE = `,
profile_events(stream_id, seq, at, kind, error, model, category, tool_name, duration_ms, trigger, from_value, to_value) AS (
  SELECT st.session_id, st.seq, st.at, 'call', st.error, st.model,
         NULL, NULL, NULL, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'call'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'tool', st.error, NULL,
         st.tool_category, st.tool_name, NULL, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'tool'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'turn', st.error, NULL,
         NULL, NULL, st.duration_ms, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'turn'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'harness', st.error, NULL,
         NULL, st.tool_name, NULL, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'harness'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'compaction', st.error, NULL,
         NULL, NULL, NULL, st.compaction_trigger, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'compaction'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'model-change', st.error, NULL,
         NULL, NULL, NULL, NULL, st.from_value, st.to_value
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'model-change'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'mode-change', st.error, NULL,
         NULL, NULL, NULL, NULL, st.from_value, st.to_value
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'mode-change'
)`;

function eventPredicate(filter: EventFilter): string {
  switch (filter) {
    case 'all':
      return '1=1';
    case 'relevant':
      return RELEVANT_SQL;
    case 'signals':
      return SIGNALS_SQL;
    case 'mcp':
      return "kind = 'tool' AND category = 'mcp'";
    case 'skill':
      return "kind = 'tool' AND category = 'skill'";
    case 'hook':
      return "kind = 'harness' OR (kind = 'tool' AND category = 'hook')";
    case 'read':
    case 'write':
    case 'exec':
    case 'agent':
      return "kind = 'tool' AND category = ?";
    case 'error':
      return 'error = 1';
  }
}

function filterParams(filter: EventFilter): { sql: string; params: SQLQueryBindings[] } {
  const sql = ` AND (${eventPredicate(filter)})`;
  const params: SQLQueryBindings[] = ['read', 'write', 'exec', 'agent'].includes(filter)
    ? [filter]
    : [];
  return { sql, params };
}

function toEvent(row: EventRow): Event {
  const base = {
    streamId: row.stream_id,
    sessionId: row.stream_id,
    seq: row.seq,
    at: row.at,
    error: row.error === null ? null : row.error !== 0,
  };
  switch (row.kind) {
    case 'call':
      return { ...base, kind: 'call', model: row.model };
    case 'tool':
      return { ...base, kind: 'tool', category: row.category, toolName: row.tool_name };
    case 'turn':
      return { ...base, kind: 'turn', durationMs: row.duration_ms };
    case 'harness':
      return { ...base, kind: 'harness', toolName: row.tool_name };
    case 'compaction':
      return { ...base, kind: 'compaction', trigger: row.trigger };
    case 'model-change':
      return { ...base, kind: 'model-change', from: row.from_value, to: row.to_value };
    case 'mode-change':
      return { ...base, kind: 'mode-change', from: row.from_value, to: row.to_value };
  }
}

/**
 * Metadata-only, single page of events merged by true chronology across the
 * whole scope (G8). Events without a usable `at` are never interleaved; they
 * are excluded from `items` and reported in `excludedNullAtCount`.
 */
export function readProfileMergedEvents(
  db: Database,
  sessionId: string,
  query: MergedEventsQuery = {},
): MergedEventsResponse | null {
  const scope = query.scope ?? 'tree';
  const nodes = readProfileScopeNodes(db, sessionId, scope);
  if (nodes === null) return null;
  const prefix = `${profileScopeCte(scope)}${EVENTS_CTE}`;
  const scopeParams = profileScopeParams(sessionId);
  const filter = query.filter ?? 'signals';
  const where = filterParams(filter);
  const limit = Math.max(1, Math.min(200, Math.floor(query.limit ?? 50)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));

  const totalRow = db
    .query(
      `${prefix} SELECT COUNT(*) AS n FROM profile_events WHERE 1=1${where.sql} AND at IS NOT NULL`,
    )
    .get(...scopeParams, ...where.params) as { n: number };
  const excludedRow = db
    .query(
      `${prefix} SELECT COUNT(*) AS n FROM profile_events WHERE 1=1${where.sql} AND at IS NULL`,
    )
    .get(...scopeParams, ...where.params) as { n: number };
  const rows = db
    .query(
      `${prefix} SELECT stream_id, seq, at, kind, error, model, category, tool_name, duration_ms, trigger, from_value, to_value FROM profile_events WHERE 1=1${where.sql} AND at IS NOT NULL ORDER BY at ASC, stream_id COLLATE BINARY, seq ASC LIMIT ? OFFSET ?`,
    )
    .all(...scopeParams, ...where.params, limit, offset) as EventRow[];

  return {
    sessionId,
    scope,
    filter,
    nodes: nodes.map((node) => ({ id: node.id, agentType: node.agentType })),
    items: rows.map(toEvent),
    total: totalRow.n,
    limit,
    offset,
    excludedNullAtCount: excludedRow.n,
  };
}
