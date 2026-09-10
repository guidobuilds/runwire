import type { Database, SQLQueryBindings } from 'bun:sqlite';

// Read/query layer for the local HTTP API (docs/ARCHITECTURE.md §7,
// .forge/sessions-api/design.md T1/T2). The SQL lives in @scout/core so it is
// testable on `:memory:`. DTO names are `Api*`-prefixed to avoid colliding with
// `SessionSummary`/`TokenTotals` already exported by
// packages/adapter-opencode/src/connector/types.ts (lesson `core-read-dto-name-
// collision-with-adapter-opencode`).

export type ApiTokenTotals = {
  uncachedInput: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoningOutput: number;
};

export type ApiSessionSummary = {
  id: string;
  /** `title ?? project.name ?? id` — never null (design D-E). */
  name: string;
  /** Privacy-gated; null when imported without titles (D7/D71). */
  title: string | null;
  parentId: string | null;
  harness: { id: string; displayName: string; adapterVersion: string };
  /** Null when the session has no project (project_key is null). */
  project: { key: string; name: string } | null;
  /** Stored per row; a root whose parent_id was NULLed by resolveOrphans can keep depth > 0. */
  depth: number;
  relation: 'subagent' | 'teammate' | 'fork' | null;
  agentType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  modelPrimary: string | null;
  /** Own models: the session's own `steps.kind='call'` models + its own model_primary. */
  modelsOwn: string[];
  /** Descendant models: all descendants' `steps.kind='call'` models + each descendant's model_primary. */
  modelsDescendants: string[];
  /** Exclusive (own only) token totals from sessions.*, coalesced to 0. */
  tokensOwn: ApiTokenTotals;
  /** Inclusive (own + all descendants) token totals from rollups.*, coalesced to 0. */
  tokensInclusive: ApiTokenTotals;
  /** `sessions.turns` — own only. There is NO turnsInclusive: rollups has no `turns` column. */
  turnsOwn: number;
  apiCallsOwn: number;
  apiCallsInclusive: number;
  toolCallsOwn: number;
  toolCallsInclusive: number;
  compactionsOwn: number;
  compactionsInclusive: number;
  /** Harness-reported only, never computed. */
  costUsd: number | null;
  /** Direct children count. */
  childCount: number;
  /** All descendants count (`rollups.descendants`), >= 0. */
  descendantCount: number;
};

export type ApiSessionDetail = ApiSessionSummary & {
  parent: ApiSessionSummary | null;
  children: ApiSessionSummary[];
};

/**
 * Query surface for `listSessions`. The caller (server transport) is expected to
 * validate; core applies safe defaults for direct/test calls. `startedAfter` may
 * be any valid ISO-8601 datetime — core normalizes it to canonical `.sssZ` UTC
 * (design D-4), which is load-bearing: a millis-less value mis-compares against
 * canonical stored `started_at` values otherwise.
 *
 * `harness` is a comma-separated list of harness ids (trimmed, empty segments
 * dropped, de-duplicated). `q` is a case-insensitive substring matched against
 * `title ?? project name ?? id` with `%`/`_`/`\` treated as literals. `sort` is
 * a whitelisted field name, optionally `-`-prefixed for DESC; an unknown value
 * falls back to the default order. All filter values are bound via `?`.
 */
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

/** The paged list envelope: the filtered root set, `total` before pagination. */
export type PagedSessions = {
  items: ApiSessionSummary[];
  total: number;
  limit: number;
  offset: number;
};

/** A harness option for the web filter: only harnesses with at least one root session. */
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

// The single item query. `WHERE` is supplied per call (roots-only for the
// list, `s.id = ?` for a detail) but is always a constant from this module —
// user input (the id) is bound via `?`, never interpolated.
const ITEM_SQL = `
  SELECT
    s.id, s.title, s.parent_id, s.depth, s.relation, s.agent_type,
    s.started_at, s.ended_at, s.duration_ms, mp.name AS model_primary,
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

function toSummary(
  row: SessionRow,
  childCounts: Map<string, number>,
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
    childCount: childCounts.get(row.id) ?? 0,
    descendantCount: row.r_descendants ?? 0,
  };
}

/**
 * `modelsOwn` map: one grouped `steps.kind='call'` query over the given ids,
 * unioned with each session's own `model_primary`. Never one query per row.
 */
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

/**
 * `modelsDescendants` map: one cycle-guarded recursive CTE seeded by `seedWhere`
 * (a constant from this module). The `t.id <> t.ancestor_id` predicate excludes
 * each seed node's OWN models, so the map holds only descendant models — the
 * seed's own models come from `modelsOwn`. This is the one heavier query; it is
 * never run once per row (no N+1).
 */
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

/** Direct-children count map: one grouped query over `parentIds`. */
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

/**
 * The `model` filter's cycle-guarded recursive CTE, seeded with the base root
 * filter (design D-1 / T1 step 3). The seed must include the base root filter so
 * only roots are seeded; the recursion then walks every descendant with the
 * `instr(path, ',' || s.id || ',') = 0` guard (same as `collectModelsDescendants`)
 * so a hand-made parent cycle terminates.
 *
 * `seedWhere` is the base root `WHERE` fragment (a constant from this module; user
 * values are bound via `?`). In a model-filtered query the base-filter values are
 * therefore bound TWICE: once for the CTE seed and once for the outer WHERE.
 */
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

/**
 * The `model` matching predicate applied over the CTE alias `tree t`. A root is
 * kept iff the model appears in the node's own `steps.kind='call'` models OR its
 * own `model_primary`. Because the CTE includes the root node itself (`t.id =
 * t.ancestor_id`) and every descendant node, this is exactly
 * `m ∈ modelsOwn ∪ modelsDescendants` (root OR any descendant). Two `?` bindings,
 * in SQL order.
 */
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

/**
 * The display-name expression used by both the `q` filter and the `name` sort.
 * It mirrors `toSummary`'s `title ?? project_name ?? id` exactly, and is a
 * scalar subquery (never a join) so the join-free COUNT query stays valid.
 */
const NAME_EXPR = `COALESCE(s.title, (SELECT p.name FROM projects p WHERE p.key = s.project_key), s.id)`;

/**
 * Module-level ORDER BY whitelist. `sort` is a user-supplied field name, so the
 * column text must come from this constant map — never from interpolation of the
 * input. Values are safe SQL fragments over the ITEM_SQL aliases (`s`, `h`, `r`).
 */
const SORT_COLUMNS: Record<string, string> = {
  name: `LOWER(${NAME_EXPR})`,
  harness: 'LOWER(h.display_name)',
  startedAt: 's.started_at',
  duration: 's.duration_ms',
  tokens:
    '(COALESCE(r.uncached_input,0)+COALESCE(r.cached_input,0)+COALESCE(r.cache_write,0)+COALESCE(r.output,0)+COALESCE(r.reasoning_output,0))',
  cost: 's.cost_usd',
};

const DEFAULT_ORDER_BY = 's.started_at DESC, s.id';

/**
 * Maps a `sort` string (`<field>` ASC / `-<field>` DESC) to a safe ORDER BY via
 * the `SORT_COLUMNS` whitelist. An absent or unknown field falls back to the
 * default `started_at DESC, id`. Every produced clause ends with `, s.id` so a
 * tie on the sort field is always deterministic.
 */
function buildOrderBy(sort: string | undefined): string {
  if (sort === undefined) return DEFAULT_ORDER_BY;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const column = SORT_COLUMNS[field];
  if (column === undefined) return DEFAULT_ORDER_BY;
  return `${column} ${desc ? 'DESC' : 'ASC'}, s.id`;
}

/**
 * Root sessions only (`parent_id IS NULL`), ordered by the whitelisted `sort`
 * (default `started_at DESC, id`), filtered by the optional AND filters
 * (`harness` comma-list, `startedAfter`, `model`, `q`, `durationMin`,
 * `costOnly`) and paginated by `limit`/`offset`. `total` is the real COUNT of
 * the filtered root set BEFORE pagination. Models/childCounts are computed ONLY
 * for the paginated slice (design D-12) — never for all roots after deciding the
 * page. No N+1.
 */
export function listSessions(db: Database, query: ListSessionsQuery = {}): PagedSessions {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  // Base root filter (design T1 step 2): roots only, plus optional exact harness
  // (case-sensitive on harness_id; a comma list becomes `= ?` for one id and
  // `IN (?,…)` for several), exclusive startedAt (`started_at > ?`, NULL never
  // matches), `q` substring, `durationMin` lower bound (NULL excluded) and
  // `costOnly` (> 0, NULL excluded). All values bound with `?`; never
  // interpolated.
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
    // Normalize to canonical `.sssZ` UTC (D-4, load-bearing): a millis-less
    // bound would otherwise compare lexicographically GREATER than the
    // same-instant and 1-ms-later canonical stored values, wrongly excluding
    // a session that should be included.
    baseParams.push(new Date(query.startedAfter).toISOString());
  }
  if (query.q !== undefined) {
    // Scalar subquery, NOT a join: the COUNT query above has no joins and must
    // stay valid. `%`/`_`/`\` in the user text are escaped and `\` is declared
    // as the LIKE escape character so they match literally.
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

  // Model filter (design D-1 / T1 step 3): a cycle-guarded recursive CTE applied
  // as a SUBQUERY — never a materialised placeholder list (`AND s.id IN (?,?,…)`),
  // which would hit SQLite's max-variable limit on a large dataset. A `model` with
  // no matches naturally yields an empty subquery and therefore an empty page.
  const hasModel = query.model !== undefined;
  const ctePrefix = hasModel ? modelCtePrefix(where) : '';
  const modelSubquery = hasModel
    ? ` AND s.id IN (SELECT DISTINCT t.ancestor_id FROM tree t WHERE ${MODEL_MATCH})`
    : '';
  const modelParams: SQLQueryBindings[] = hasModel
    ? [query.model as string, query.model as string]
    : [];

  // `total` — the real COUNT of the filtered root set BEFORE pagination (D-7).
  // Binding-order gotcha (T1): when `model` is present the base-filter values are
  // bound TWICE — CTE-seed `[harness?][startedAt?]`, then outer WHERE
  // `[harness?][startedAt?]`, then `MODEL_MATCH` `model?` twice.
  const countSql = `${ctePrefix}SELECT COUNT(*) AS c FROM sessions s WHERE ${where}${modelSubquery}`;
  const countParams = hasModel ? [...baseParams, ...baseParams, ...modelParams] : baseParams;
  const countRow = db.query(countSql).get(...countParams) as { c: number };
  const total = countRow.c;

  // The paginated, ordered item slice (D-2 / D-8 / D-9).
  const itemSql = `${ctePrefix}${ITEM_SQL} WHERE ${where}${modelSubquery} ORDER BY ${buildOrderBy(query.sort)} LIMIT ? OFFSET ?`;
  const itemParams = hasModel
    ? [...baseParams, ...baseParams, ...modelParams, limit, offset]
    : [...baseParams, limit, offset];
  const rows = db.query(itemSql).all(...itemParams) as SessionRow[];
  const sliceIds = rows.map((r) => r.id);

  // Slice-only aggregates (D-12): compute models/childCounts only for the page.
  // Guard the empty slice (e.g. `offset` past the end) so we never emit an
  // invalid `id IN ()` clause.
  if (sliceIds.length === 0) {
    return { items: [], total, limit, offset };
  }
  const childCounts = collectChildCounts(db, sliceIds);
  const modelsOwn = collectModelsOwn(db, sliceIds);
  const placeholders = sliceIds.map(() => '?').join(',');
  const modelsDescendants = collectModelsDescendants(db, `id IN (${placeholders})`, sliceIds);

  const items = rows.map((r) => toSummary(r, childCounts, modelsOwn, modelsDescendants));
  return { items, total, limit, offset };
}

/**
 * Harness options for the web filter: every harness that has at least one root
 * session (`parent_id IS NULL`), ordered by display name. Harnesses with only
 * descendant rows are omitted.
 */
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

/**
 * One session's detail (`ApiSessionDetail | null`). Uses a WHERE-parameterized
 * item builder (`WHERE s.id = ?`, never the list's `parent_id IS NULL` filter,
 * which would 404 every subagent id). Binds the id with `?` so ids containing
 * a literal `/` work. Hoists the models maps once so children[]'s
 * `modelsDescendants` (one CTE seeded at `parent_id = <id>`) and `modelsOwn`
 * (one grouped query over the child ids) never run per child (no N+1).
 */
export function getSession(db: Database, id: string): ApiSessionDetail | null {
  const rows = itemRows(db, 's.id = ?', [id]);
  const row = rows[0];
  if (!row) return null;
  const sessionId = row.id;

  const childRows = itemRows(db, 's.parent_id = ?', [sessionId]);
  const childIds = childRows.map((r) => r.id);

  const childCounts = collectChildCounts(db, [sessionId, ...childIds]);
  childCounts.set(sessionId, childRows.length);

  const modelsOwn = collectModelsOwn(db, [sessionId, ...childIds]);
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

  const summary = toSummary(row, childCounts, modelsOwn, modelsDescendants);

  let parent: ApiSessionSummary | null = null;
  if (row.parent_id !== null) {
    const parentRows = itemRows(db, 's.id = ?', [row.parent_id]);
    const pRow = parentRows[0];
    if (pRow) {
      const pChildCounts = new Map<string, number>();
      const pCount = db
        .query('SELECT COUNT(*) AS c FROM sessions WHERE parent_id = ?')
        .get(row.parent_id) as { c: number } | undefined;
      pChildCounts.set(row.parent_id, pCount?.c ?? 0);
      const pModelsOwn = collectModelsOwn(db, [row.parent_id]);
      const pModelsDescendants = collectModelsDescendants(db, 'id = ?', [row.parent_id]);
      parent = toSummary(pRow, pChildCounts, pModelsOwn, pModelsDescendants);
    }
  }

  const children = childRows.map((r) => toSummary(r, childCounts, modelsOwn, modelsDescendants));
  return { ...summary, parent, children };
}
