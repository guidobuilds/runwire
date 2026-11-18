import type { Database, SQLQueryBindings } from 'bun:sqlite';

export type ApiTokenTotals = {
  uncachedInput: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoningOutput: number;
};

export type ApiSessionSummary = {
  id: string;
  name: string;
  title: string | null;
  parentId: string | null;
  harness: { id: string; displayName: string; adapterVersion: string };
  project: { key: string; name: string } | null;
  depth: number;
  relation: 'subagent' | 'teammate' | 'fork' | null;
  agentType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastActivity: string | null;
  durationMs: number | null;
  modelPrimary: string | null;
  modelsOwn: string[];
  modelsDescendants: string[];
  tokensOwn: ApiTokenTotals;
  tokensInclusive: ApiTokenTotals;
  turnsOwn: number;
  apiCallsOwn: number;
  apiCallsInclusive: number;
  toolCallsOwn: number;
  toolCallsInclusive: number;
  compactionsOwn: number;
  compactionsInclusive: number;
  costUsd: number | null;
  childCount: number;
  descendantCount: number;
  subagentChildCount: number;
  subagentDescendantCount: number;
};

export type ApiSessionDetail = ApiSessionSummary & {
  parent: ApiSessionSummary | null;
  children: ApiSessionSummary[];
};

export type ListSessionsQuery = {
  limit?: number;
  offset?: number;
  harness?: string;
  startedAfter?: string;
  model?: string;
  q?: string;
  durationMin?: number;
  costOnly?: boolean;
  sort?: string;
};

export type PagedSessions = {
  items: ApiSessionSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type ApiSessionStatsSeriesPoint = {
  date: string;
  sessions: number;
};

export type ApiSessionsStats = {
  totalSessions: number;
  totalCostUsd: number;
  totalTokens: number;
  avgDurationMs: number;
  series: ApiSessionStatsSeriesPoint[];
};

export type ApiHarnessOption = {
  id: string;
  displayName: string;
};

type SessionRow = {
  id: string;
  title: string | null;
  parent_id: string | null;
  depth: number;
  relation: string | null;
  agent_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  last_activity: string | null;
  duration_ms: number | null;
  model_primary: string | null;
  uncached_input: number | null;
  cached_input: number | null;
  cache_write: number | null;
  output: number | null;
  reasoning_output: number | null;
  turns: number | null;
  api_calls: number | null;
  tool_calls: number | null;
  compactions: number | null;
  cost_usd: number | null;
  harness_id: string;
  harness_display_name: string;
  harness_adapter_version: string;
  project_key: string | null;
  project_name: string | null;
  r_uncached_input: number | null;
  r_cached_input: number | null;
  r_cache_write: number | null;
  r_output: number | null;
  r_reasoning_output: number | null;
  r_api_calls: number | null;
  r_tool_calls: number | null;
  r_compactions: number | null;
  r_descendants: number | null;
};

const LAST_ACTIVITY_EXPR = `COALESCE(
  (
    SELECT MAX(a.ended_at)
    FROM sessions a
    WHERE a.id IN (
      WITH RECURSIVE subtree(id, path) AS (
        SELECT s.id, '.' || hex(s.id) || '.'
        UNION ALL
        SELECT c.id, st.path || hex(c.id) || '.'
        FROM sessions c JOIN subtree st ON c.parent_id = st.id
        WHERE instr(st.path, '.' || hex(c.id) || '.') = 0
      )
      SELECT id FROM subtree
    )
  ),
  s.started_at
)`;

const ITEM_SQL = `
  SELECT
    s.id, s.title, s.parent_id, s.depth, s.relation, s.agent_type,
    s.started_at, s.ended_at, ${LAST_ACTIVITY_EXPR} AS last_activity,
    s.duration_ms, mp.name AS model_primary,
    s.uncached_input, s.cached_input, s.cache_write, s.output, s.reasoning_output,
    s.turns, s.api_calls, s.tool_calls, s.compactions, s.cost_usd,
    h.id AS harness_id, h.display_name AS harness_display_name, h.adapter_version AS harness_adapter_version,
    p.key AS project_key, p.name AS project_name,
    r.uncached_input AS r_uncached_input, r.cached_input AS r_cached_input, r.cache_write AS r_cache_write,
    r.output AS r_output, r.reasoning_output AS r_reasoning_output,
    r.api_calls AS r_api_calls, r.tool_calls AS r_tool_calls, r.compactions AS r_compactions,
    r.descendants AS r_descendants
  FROM sessions s
  JOIN harnesses h ON h.id = s.harness_id
  LEFT JOIN projects p ON p.key = s.project_key
  LEFT JOIN rollups r ON r.session_id = s.id
  LEFT JOIN models mp ON mp.id = s.model_primary_id
`;

function itemRows(
  db: Database,
  where: string,
  params: SQLQueryBindings[],
  orderBy = '',
): SessionRow[] {
  return db.query(`${ITEM_SQL} WHERE ${where} ${orderBy}`).all(...params) as SessionRow[];
}

type SummaryCounts = {
  childCounts: Map<string, number>;
  subagentChildCounts: Map<string, number>;
  subagentDescendantCounts: Map<string, number>;
};

function toSummary(
  row: SessionRow,
  counts: SummaryCounts,
  modelsOwn: Map<string, Set<string>>,
  modelsDescendants: Map<string, Set<string>>,
): ApiSessionSummary {
  const own = modelsOwn.get(row.id) ?? new Set<string>();
  const descendants = modelsDescendants.get(row.id) ?? new Set<string>();
  return {
    id: row.id,
    name: row.title ?? row.project_name ?? row.id,
    title: row.title,
    parentId: row.parent_id,
    harness: {
      id: row.harness_id,
      displayName: row.harness_display_name,
      adapterVersion: row.harness_adapter_version,
    },
    project:
      row.project_key === null ? null : { key: row.project_key, name: row.project_name as string },
    depth: row.depth,
    relation: (row.relation as ApiSessionSummary['relation']) ?? null,
    agentType: row.agent_type,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastActivity: row.last_activity,
    durationMs: row.duration_ms,
    modelPrimary: row.model_primary,
    modelsOwn: [...own].sort(),
    modelsDescendants: [...descendants].sort(),
    tokensOwn: {
      uncachedInput: row.uncached_input ?? 0,
      cachedInput: row.cached_input ?? 0,
      cacheWrite: row.cache_write ?? 0,
      output: row.output ?? 0,
      reasoningOutput: row.reasoning_output ?? 0,
    },
    tokensInclusive: {
      uncachedInput: row.r_uncached_input ?? 0,
      cachedInput: row.r_cached_input ?? 0,
      cacheWrite: row.r_cache_write ?? 0,
      output: row.r_output ?? 0,
      reasoningOutput: row.r_reasoning_output ?? 0,
    },
    turnsOwn: row.turns ?? 0,
    apiCallsOwn: row.api_calls ?? 0,
    apiCallsInclusive: row.r_api_calls ?? 0,
    toolCallsOwn: row.tool_calls ?? 0,
    toolCallsInclusive: row.r_tool_calls ?? 0,
    compactionsOwn: row.compactions ?? 0,
    compactionsInclusive: row.r_compactions ?? 0,
    costUsd: row.cost_usd,
    childCount: counts.childCounts.get(row.id) ?? 0,
    descendantCount: row.r_descendants ?? 0,
    subagentChildCount: counts.subagentChildCounts.get(row.id) ?? 0,
    subagentDescendantCount: counts.subagentDescendantCounts.get(row.id) ?? 0,
  };
}

function collectModelsOwn(db: Database, sessionIds: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (sessionIds.length === 0) return map;
  const placeholders = sessionIds.map(() => '?').join(',');
  const stepRows = db
    .query(
      `SELECT st.session_id AS session_id, m.name AS model FROM steps st
       JOIN models m ON m.id = st.model_id
       WHERE st.kind='call' AND st.model_id IS NOT NULL AND st.session_id IN (${placeholders})
       GROUP BY st.session_id, m.name`,
    )
    .all(...sessionIds) as { session_id: string; model: string }[];
  for (const r of stepRows) {
    let set = map.get(r.session_id);
    if (!set) {
      set = new Set<string>();
      map.set(r.session_id, set);
    }
    set.add(r.model);
  }
  const primaryRows = db
    .query(
      `SELECT s.id AS id, m.name AS model_primary FROM sessions s
       JOIN models m ON m.id = s.model_primary_id
       WHERE s.model_primary_id IS NOT NULL AND s.id IN (${placeholders})`,
    )
    .all(...sessionIds) as { id: string; model_primary: string }[];
  for (const r of primaryRows) {
    let set = map.get(r.id);
    if (!set) {
      set = new Set<string>();
      map.set(r.id, set);
    }
    set.add(r.model_primary);
  }
  return map;
}

function collectModelsDescendants(
  db: Database,
  seedWhere: string,
  seedParams: SQLQueryBindings[],
): Map<string, Set<string>> {
  const sql = `
    WITH RECURSIVE tree(ancestor_id, id, path) AS (
      SELECT id, id, ',' || id || ',' FROM sessions WHERE ${seedWhere}
      UNION ALL
      SELECT t.ancestor_id, s.id, t.path || s.id || ','
      FROM tree t JOIN sessions s ON s.parent_id = t.id
      WHERE instr(t.path, ',' || s.id || ',') = 0
    )
    SELECT DISTINCT t.ancestor_id AS ancestor_id, m.name AS model
    FROM tree t JOIN steps st ON st.session_id = t.id JOIN models m ON m.id = st.model_id
    WHERE st.kind='call' AND st.model_id IS NOT NULL AND t.id <> t.ancestor_id
    UNION
    SELECT DISTINCT t.ancestor_id AS ancestor_id, m.name AS model
    FROM tree t JOIN sessions s ON s.id = t.id JOIN models m ON m.id = s.model_primary_id
    WHERE s.model_primary_id IS NOT NULL AND t.id <> t.ancestor_id
  `;
  const rows = db.query(sql).all(...seedParams) as { ancestor_id: string; model: string }[];
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = map.get(r.ancestor_id);
    if (!set) {
      set = new Set<string>();
      map.set(r.ancestor_id, set);
    }
    set.add(r.model);
  }
  return map;
}

function collectChildCounts(db: Database, parentIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (parentIds.length === 0) return map;
  const placeholders = parentIds.map(() => '?').join(',');
  const rows = db
    .query(
      `SELECT parent_id, COUNT(*) AS child_count FROM sessions
       WHERE parent_id IN (${placeholders}) GROUP BY parent_id`,
    )
    .all(...parentIds) as { parent_id: string; child_count: number }[];
  for (const r of rows) map.set(r.parent_id, r.child_count);
  return map;
}

function collectSubagentChildCounts(db: Database, parentIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (parentIds.length === 0) return map;
  const placeholders = parentIds.map(() => '?').join(',');
  const rows = db
    .query(
      `SELECT parent_id, COUNT(*) AS child_count FROM sessions
       WHERE parent_id IN (${placeholders}) AND relation = 'subagent' GROUP BY parent_id`,
    )
    .all(...parentIds) as { parent_id: string; child_count: number }[];
  for (const r of rows) map.set(r.parent_id, r.child_count);
  return map;
}

function collectSubagentDescendantCounts(
  db: Database,
  seedWhere: string,
  seedParams: SQLQueryBindings[],
): Map<string, number> {
  const sql = `
    WITH RECURSIVE tree(ancestor_id, id, path) AS (
      SELECT id, id, '.' || hex(id) || '.' FROM sessions WHERE ${seedWhere}
      UNION ALL
      SELECT t.ancestor_id, s.id, t.path || hex(s.id) || '.'
      FROM tree t JOIN sessions s ON s.parent_id = t.id
      WHERE instr(t.path, '.' || hex(s.id) || '.') = 0
    )
    SELECT t.ancestor_id AS ancestor_id, COUNT(*) AS c
    FROM tree t JOIN sessions s ON s.id = t.id
    WHERE s.relation = 'subagent' AND t.id <> t.ancestor_id
    GROUP BY t.ancestor_id
  `;
  const rows = db.query(sql).all(...seedParams) as { ancestor_id: string; c: number }[];
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.ancestor_id, r.c);
  return map;
}

function modelCtePrefix(seedWhere: string): string {
  return `
WITH RECURSIVE tree(ancestor_id, id, path) AS (
  SELECT id, id, ',' || id || ',' FROM sessions s
  WHERE ${seedWhere}
  UNION ALL
  SELECT t.ancestor_id, s.id, t.path || s.id || ','
  FROM tree t JOIN sessions s ON s.parent_id = t.id
  WHERE instr(t.path, ',' || s.id || ',') = 0
)`;
}

const MODEL_MATCH = `(
  EXISTS (
    SELECT 1 FROM steps st
    WHERE st.session_id = t.id AND st.kind = 'call'
      AND st.model_id IN (SELECT id FROM models WHERE name = ?)
  )
  OR EXISTS (
    SELECT 1 FROM sessions s2
    WHERE s2.id = t.id
      AND s2.model_primary_id IN (SELECT id FROM models WHERE name = ?)
  )
)`;

const NAME_EXPR = `COALESCE(s.title, (SELECT p.name FROM projects p WHERE p.key = s.project_key), s.id)`;

const SORT_COLUMNS: Record<string, string> = {
  name: `LOWER(${NAME_EXPR})`,
  harness: 'LOWER(h.display_name)',
  startedAt: 's.started_at',
  lastActivity: LAST_ACTIVITY_EXPR,
  duration: 's.duration_ms',
  tokens:
    '(COALESCE(r.uncached_input,0)+COALESCE(r.cached_input,0)+COALESCE(r.cache_write,0)+COALESCE(r.output,0))',
  cost: 's.cost_usd',
};

const DEFAULT_ORDER_BY = `${LAST_ACTIVITY_EXPR} DESC, s.id`;

function buildOrderBy(sort: string | undefined): string {
  if (sort === undefined) return DEFAULT_ORDER_BY;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const column = SORT_COLUMNS[field];
  if (column === undefined) return DEFAULT_ORDER_BY;
  return `${column} ${desc ? 'DESC' : 'ASC'}, s.id`;
}

type RootFilter = {
  where: string;
  ctePrefix: string;
  modelSubquery: string;
  params: SQLQueryBindings[];
};

function buildRootFilter(query: ListSessionsQuery): RootFilter {
  let where = 's.parent_id IS NULL';
  const baseParams: SQLQueryBindings[] = [];
  if (query.harness !== undefined) {
    const harnessIds = [
      ...new Set(
        query.harness
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ];
    if (harnessIds.length === 1) {
      where += ' AND s.harness_id = ?';
      baseParams.push(harnessIds[0] as string);
    } else if (harnessIds.length > 1) {
      where += ` AND s.harness_id IN (${harnessIds.map(() => '?').join(',')})`;
      baseParams.push(...harnessIds);
    }
  }
  if (query.startedAfter !== undefined) {
    where += ' AND s.started_at > ?';
    baseParams.push(new Date(query.startedAfter).toISOString());
  }
  if (query.q !== undefined) {
    where += ` AND ${NAME_EXPR} LIKE ? ESCAPE '\\'`;
    baseParams.push(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (query.durationMin !== undefined) {
    where += ' AND s.duration_ms >= ?';
    baseParams.push(query.durationMin * 60000);
  }
  if (query.costOnly === true) {
    where += ' AND s.cost_usd > 0';
  }

  const hasModel = query.model !== undefined;
  const ctePrefix = hasModel ? modelCtePrefix(where) : '';
  const modelSubquery = hasModel
    ? ` AND s.id IN (SELECT DISTINCT t.ancestor_id FROM tree t WHERE ${MODEL_MATCH})`
    : '';
  const modelParams: SQLQueryBindings[] = hasModel
    ? [query.model as string, query.model as string]
    : [];
  const params = hasModel ? [...baseParams, ...baseParams, ...modelParams] : baseParams;
  return { where, ctePrefix, modelSubquery, params };
}

export function listSessions(db: Database, query: ListSessionsQuery = {}): PagedSessions {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const { where, ctePrefix, modelSubquery, params } = buildRootFilter(query);

  const countSql = `${ctePrefix}SELECT COUNT(*) AS c FROM sessions s WHERE ${where}${modelSubquery}`;
  const countRow = db.query(countSql).get(...params) as { c: number };
  const total = countRow.c;

  const itemSql = `${ctePrefix}${ITEM_SQL} WHERE ${where}${modelSubquery} ORDER BY ${buildOrderBy(query.sort)} LIMIT ? OFFSET ?`;
  const itemParams = [...params, limit, offset];
  const rows = db.query(itemSql).all(...itemParams) as SessionRow[];
  const sliceIds = rows.map((r) => r.id);

  if (sliceIds.length === 0) {
    return { items: [], total, limit, offset };
  }
  const childCounts = collectChildCounts(db, sliceIds);
  const subagentChildCounts = collectSubagentChildCounts(db, sliceIds);
  const modelsOwn = collectModelsOwn(db, sliceIds);
  const placeholders = sliceIds.map(() => '?').join(',');
  const modelsDescendants = collectModelsDescendants(db, `id IN (${placeholders})`, sliceIds);
  const subagentDescendantCounts = collectSubagentDescendantCounts(
    db,
    `id IN (${placeholders})`,
    sliceIds,
  );

  const counts: SummaryCounts = { childCounts, subagentChildCounts, subagentDescendantCounts };
  const items = rows.map((r) => toSummary(r, counts, modelsOwn, modelsDescendants));
  return { items, total, limit, offset };
}

export function getSessionsStats(db: Database, query: ListSessionsQuery = {}): ApiSessionsStats {
  const { where, ctePrefix, modelSubquery, params } = buildRootFilter(query);

  const totalsSql = `${ctePrefix}
    SELECT
      COUNT(*) AS total_sessions,
      COALESCE(SUM(s.cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(
        COALESCE(r.uncached_input, 0) + COALESCE(r.cached_input, 0) + COALESCE(r.cache_write, 0)
        + COALESCE(r.output, 0)
      ), 0) AS total_tokens,
      COALESCE(AVG(s.duration_ms), 0) AS avg_duration_ms
    FROM sessions s
    LEFT JOIN rollups r ON r.session_id = s.id
    WHERE ${where}${modelSubquery}`;
  const totals = db.query(totalsSql).get(...params) as {
    total_sessions: number;
    total_cost_usd: number;
    total_tokens: number;
    avg_duration_ms: number;
  };

  const seriesSql = `${ctePrefix}
    SELECT substr(s.started_at, 1, 10) AS date, COUNT(*) AS sessions
    FROM sessions s
    WHERE ${where} AND s.started_at IS NOT NULL${modelSubquery}
    GROUP BY date
    ORDER BY date`;
  const seriesRows = db.query(seriesSql).all(...params) as { date: string; sessions: number }[];

  return {
    totalSessions: totals.total_sessions,
    totalCostUsd: totals.total_cost_usd,
    totalTokens: totals.total_tokens,
    avgDurationMs: totals.avg_duration_ms,
    series: seriesRows.map((row) => ({ date: row.date, sessions: row.sessions })),
  };
}

export function listHarnesses(db: Database): ApiHarnessOption[] {
  const rows = db
    .query(
      `SELECT h.id AS id, h.display_name AS display_name FROM harnesses h
       WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.harness_id = h.id AND s.parent_id IS NULL)
       ORDER BY h.display_name`,
    )
    .all() as { id: string; display_name: string }[];
  return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
}

export function getSession(db: Database, id: string): ApiSessionDetail | null {
  const rows = itemRows(db, 's.id = ?', [id]);
  const row = rows[0];
  if (!row) return null;
  const sessionId = row.id;

  const childRows = itemRows(db, 's.parent_id = ?', [sessionId]);
  const childIds = childRows.map((r) => r.id);
  const allIds = [sessionId, ...childIds];

  const childCounts = collectChildCounts(db, allIds);
  childCounts.set(sessionId, childRows.length);
  const subagentChildCounts = collectSubagentChildCounts(db, allIds);

  const modelsOwn = collectModelsOwn(db, allIds);
  const modelsDescendants = collectModelsDescendants(db, 'id = ?', [sessionId]);
  if (childIds.length > 0) {
    const childModels = collectModelsDescendants(db, 'parent_id = ?', [sessionId]);
    for (const [cid, set] of childModels) {
      let existing = modelsDescendants.get(cid);
      if (!existing) {
        existing = new Set<string>();
        modelsDescendants.set(cid, existing);
      }
      for (const m of set) existing.add(m);
    }
  }
  const placeholders = allIds.map(() => '?').join(',');
  const subagentDescendantCounts = collectSubagentDescendantCounts(
    db,
    `id IN (${placeholders})`,
    allIds,
  );

  const counts: SummaryCounts = { childCounts, subagentChildCounts, subagentDescendantCounts };
  const summary = toSummary(row, counts, modelsOwn, modelsDescendants);

  let parent: ApiSessionSummary | null = null;
  if (row.parent_id !== null) {
    const parentRows = itemRows(db, 's.id = ?', [row.parent_id]);
    const pRow = parentRows[0];
    if (pRow) {
      const parentIds = [row.parent_id];
      const parentCounts: SummaryCounts = {
        childCounts: collectChildCounts(db, parentIds),
        subagentChildCounts: collectSubagentChildCounts(db, parentIds),
        subagentDescendantCounts: collectSubagentDescendantCounts(db, 'id = ?', parentIds),
      };
      const pModelsOwn = collectModelsOwn(db, parentIds);
      const pModelsDescendants = collectModelsDescendants(db, 'id = ?', parentIds);
      parent = toSummary(pRow, parentCounts, pModelsOwn, pModelsDescendants);
    }
  }

  const children = childRows.map((r) => toSummary(r, counts, modelsOwn, modelsDescendants));
  return { ...summary, parent, children };
}
