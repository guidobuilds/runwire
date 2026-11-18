import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { resolveMcpIdentity } from './profile-mcp';
import { profileScopeCte, profileScopeParams, readProfileScopeNodes } from './profile-scope';
import type {
  Event,
  EventAction,
  EventSortField,
  MergedEventsQuery,
  MergedEventsResponse,
  SortDirection,
} from './profile-types';

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
  mcp_server: string | null;
  mcp_tool: string | null;
  action: EventAction;
  subject: string | null;
};

const EVENTS_CTE = `,
profile_events(stream_id, seq, at, kind, error, model, category, tool_name, duration_ms, trigger, from_value, to_value, mcp_server, mcp_tool) AS (
  SELECT st.session_id, st.seq, st.at, 'call', st.error, mn.name,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id
  LEFT JOIN models mn ON mn.id = st.model_id
  WHERE st.kind = 'call'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'tool', st.error, mn.name,
         st.tool_category, st.tool_name, NULL, NULL, NULL, NULL, st.mcp_server, st.mcp_tool
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id
  LEFT JOIN models mn ON mn.id = st.model_id
  WHERE st.kind = 'tool'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'turn', st.error, NULL,
         NULL, NULL, st.duration_ms, NULL, NULL, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'turn'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'harness', st.error, NULL,
         NULL, st.tool_name, NULL, NULL, NULL, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'harness'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'compaction', st.error, NULL,
         NULL, NULL, NULL, st.compaction_trigger, NULL, NULL, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'compaction'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'model-change', st.error, NULL,
         NULL, NULL, NULL, NULL, st.from_value, st.to_value, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'model-change'
  UNION ALL
  SELECT st.session_id, st.seq, st.at, 'mode-change', st.error, NULL,
         NULL, NULL, NULL, NULL, st.from_value, st.to_value, NULL, NULL
  FROM steps st JOIN profile_scope ps ON ps.id = st.session_id WHERE st.kind = 'mode-change'
)`;

const ACTION_EXPR = 'COALESCE(category, kind)';

const SUBJECT_EXPR = `(CASE
  WHEN kind = 'call' THEN model
  WHEN kind IN ('tool', 'harness') THEN tool_name
  WHEN kind = 'compaction' THEN trigger
  WHEN kind IN ('model-change', 'mode-change')
    THEN COALESCE(from_value, '?') || ' → ' || COALESCE(to_value, '?')
  ELSE NULL
END)`;

const SORT_EXPR: Record<EventSortField, string> = {
  time: 'at',
  agent: 'stream_id',
  kind: 'kind',
  action: ACTION_EXPR,
  subject: SUBJECT_EXPR,
  model: 'model',
  status: 'CASE WHEN error = 1 THEN 1 ELSE 0 END',
};

type Conditions = { sql: string; params: SQLQueryBindings[] };

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}

function filterConditions(query: MergedEventsQuery): Conditions {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (query.kind !== undefined && query.kind.length > 0) {
    clauses.push(`kind IN (${query.kind.map(() => '?').join(', ')})`);
    params.push(...query.kind);
  }
  if (query.action !== undefined && query.action.length > 0) {
    clauses.push(`${ACTION_EXPR} IN (${query.action.map(() => '?').join(', ')})`);
    params.push(...query.action);
  }
  if (query.status === 'error') {
    clauses.push('error = 1');
  } else if (query.status === 'ok') {
    clauses.push('(error IS NULL OR error = 0)');
  }
  if (query.model !== undefined) {
    clauses.push('model = ?');
    params.push(query.model);
  }
  if (query.q !== undefined) {
    clauses.push(
      `(COALESCE(${ACTION_EXPR}, '') LIKE ? ESCAPE '\\'` +
        ` OR COALESCE(${SUBJECT_EXPR}, '') LIKE ? ESCAPE '\\'` +
        ` OR COALESCE(model, '') LIKE ? ESCAPE '\\'` +
        ` OR COALESCE(mcp_server, '') LIKE ? ESCAPE '\\'` +
        ` OR COALESCE(mcp_tool, '') LIKE ? ESCAPE '\\')`,
    );
    const pattern = likePattern(query.q);
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  return { sql: clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`, params };
}

function orderSql(sort: EventSortField, dir: SortDirection): string {
  const direction = dir === 'desc' ? 'DESC' : 'ASC';
  const parts = [`${SORT_EXPR[sort]} ${direction}`];
  if (sort !== 'time') parts.push(`at ${direction}`);
  parts.push('stream_id COLLATE BINARY ASC', 'seq ASC');
  return `ORDER BY ${parts.join(', ')}`;
}

function toEvent(row: EventRow): Event {
  const base = {
    streamId: row.stream_id,
    sessionId: row.stream_id,
    seq: row.seq,
    at: row.at,
    error: row.error === null ? null : row.error !== 0,
    action: row.action,
    subject: row.subject,
  };
  switch (row.kind) {
    case 'call':
      return { ...base, kind: 'call', model: row.model };
    case 'tool': {
      const identity = resolveMcpIdentity({
        category: row.category,
        toolName: row.tool_name,
        mcpServer: row.mcp_server,
        mcpTool: row.mcp_tool,
      });
      return {
        ...base,
        kind: 'tool',
        category: row.category,
        toolName: row.tool_name,
        mcpServer: identity.server,
        mcpTool: identity.tool,
        model: row.model,
      };
    }
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
  const sort = query.sort ?? 'time';
  const dir = query.dir ?? 'asc';
  const filter = filterConditions(query);
  const limit = Math.max(1, Math.min(200, Math.floor(query.limit ?? 50)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));

  const countSql = `${prefix} SELECT COUNT(*) AS n FROM profile_events WHERE at IS NOT NULL${filter.sql}`;
  const excludedSql = `${prefix} SELECT COUNT(*) AS n FROM profile_events WHERE at IS NULL${filter.sql}`;
  const pageSql = `${prefix} SELECT stream_id, seq, at, kind, error, model, category, tool_name, duration_ms, trigger, from_value, to_value, mcp_server, mcp_tool, ${ACTION_EXPR} AS action, ${SUBJECT_EXPR} AS subject FROM profile_events WHERE at IS NOT NULL${filter.sql} ${orderSql(sort, dir)} LIMIT ? OFFSET ?`;

  const totalRow = db.query(countSql).get(...scopeParams, ...filter.params) as { n: number };
  const excludedRow = db.query(excludedSql).get(...scopeParams, ...filter.params) as {
    n: number;
  };
  const rows = db.query(pageSql).all(...scopeParams, ...filter.params, limit, offset) as EventRow[];

  return {
    sessionId,
    scope,
    sort,
    dir,
    nodes: nodes.map((node) => ({ id: node.id, agentType: node.agentType })),
    items: rows.map(toEvent),
    total: totalRow.n,
    limit,
    offset,
    excludedNullAtCount: excludedRow.n,
  };
}
