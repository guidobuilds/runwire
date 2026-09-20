import type { Database } from 'bun:sqlite';
import { profileScopeCte, profileScopeParams } from './profile-scope';
import type {
  ContextMetrics,
  ProfileContextDescendant,
  ProfileContextResponse,
} from './profile-types';

type CallRow = {
  session_id: string;
  uncached_input: number | null;
  cached_input: number | null;
  cache_write: number | null;
};

type NodeRow = {
  id: string;
  parent_id: string | null;
  agent_type: string | null;
  started_at: string | null;
  duration_ms: number | null;
  model_primary: string | null;
  cost_usd: number | null;
};

// Both queries run once for the whole tree (no per-descendant query): the call
// rows are grouped in JS by `session_id`, and the node rows give every
// descendant's metadata + ordering. `profile_scope` is the parameterized
// recursive scope CTE seeded at the requested id.
const CALLS_SQL = `
  SELECT st.session_id AS session_id, st.uncached_input, st.cached_input, st.cache_write
  FROM steps st
  WHERE st.kind = 'call' AND st.session_id IN (SELECT id FROM profile_scope)
`;

const NODES_SQL = `
  SELECT
    s.id, s.parent_id, s.agent_type, s.started_at, s.duration_ms,
    mp.name AS model_primary, s.cost_usd
  FROM sessions s
  LEFT JOIN models mp ON mp.id = s.model_primary_id
  WHERE s.id IN (SELECT id FROM profile_scope)
`;

/** Observable iff at least one prompt-input category was reported. */
function isObservable(row: CallRow): boolean {
  return row.uncached_input !== null || row.cached_input !== null || row.cache_write !== null;
}

/**
 * Folds one scope's call rows into `ContextMetrics`. Non-observable rows
 * (all three categories NULL) are excluded from every figure. A missing
 * category inside an observable row counts as 0. All-null at zero observable
 * calls; `cacheReadShare` is also null at a zero prompt-input denominator.
 */
function summarize(rows: readonly CallRow[]): ContextMetrics {
  const values: number[] = [];
  let cachedTotal = 0;
  let promptTotal = 0;
  for (const row of rows) {
    if (!isObservable(row)) continue;
    const cached = row.cached_input ?? 0;
    const prompt = (row.uncached_input ?? 0) + cached + (row.cache_write ?? 0);
    values.push(prompt);
    promptTotal += prompt;
    cachedTotal += cached;
  }
  const observedCalls = values.length;
  if (observedCalls === 0) {
    return {
      observedCalls: 0,
      promptInput: null,
      avgPromptInput: null,
      p95PromptInput: null,
      peakPromptInput: null,
      cacheReadShare: null,
    };
  }
  values.sort((a, b) => a - b);
  // Nearest-rank p95: the value at 1-based rank ceil(0.95 * N), clamped by the
  // in-range rank guarantee.
  const rank = Math.ceil(0.95 * observedCalls);
  return {
    observedCalls,
    promptInput: promptTotal,
    avgPromptInput: promptTotal / observedCalls,
    p95PromptInput: values[rank - 1] as number,
    peakPromptInput: values[observedCalls - 1] as number,
    cacheReadShare: promptTotal === 0 ? null : cachedTotal / promptTotal,
  };
}

/** Siblings: `startedAt` ASC with NULL first, then id (bytewise). */
function compareSiblings(a: NodeRow, b: NodeRow): number {
  if (a.started_at !== b.started_at) {
    if (a.started_at === null) return -1;
    if (b.started_at === null) return 1;
    return a.started_at < b.started_at ? -1 : 1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Metadata-only prompt-context pressure for a session. Returns null iff the
 * session row is absent (the transport maps that to a 404); an existing session
 * with no observable calls returns all-null metrics.
 *
 * `own` is the requested session's own `kind='call'` steps, `tree` pools the
 * same rows across the whole recursive subtree, and `descendants` carries one
 * own-only row per descendant in depth-first parent-before-child order.
 */
export function readProfileSessionContext(
  db: Database,
  sessionId: string,
): ProfileContextResponse | null {
  const calls = db
    .query(`${profileScopeCte('tree')}${CALLS_SQL}`)
    .all(...profileScopeParams(sessionId)) as CallRow[];
  const nodes = db
    .query(`${profileScopeCte('tree')}${NODES_SQL}`)
    .all(...profileScopeParams(sessionId)) as NodeRow[];

  // The tree CTE seeded at an absent id admits no rows, so an empty node set is
  // exactly the absent-session case (including a session with no call steps the
  // node set still contains the root row).
  if (nodes.length === 0) return null;

  const callsBySession = new Map<string, CallRow[]>();
  for (const call of calls) {
    let list = callsBySession.get(call.session_id);
    if (!list) {
      list = [];
      callsBySession.set(call.session_id, list);
    }
    list.push(call);
  }

  const nodeById = new Map<string, NodeRow>();
  for (const node of nodes) nodeById.set(node.id, node);

  const children = new Map<string, NodeRow[]>();
  for (const node of nodes) {
    if (node.parent_id === null || !nodeById.has(node.parent_id)) continue;
    let list = children.get(node.parent_id);
    if (!list) {
      list = [];
      children.set(node.parent_id, list);
    }
    list.push(node);
  }
  for (const list of children.values()) list.sort(compareSiblings);

  const descendants: ProfileContextDescendant[] = [];
  const visited = new Set<string>([sessionId]);
  const walk = (parentId: string, relativeDepth: number): void => {
    const kids = children.get(parentId);
    if (!kids) return;
    for (const kid of kids) {
      if (visited.has(kid.id)) continue;
      visited.add(kid.id);
      descendants.push({
        id: kid.id,
        parentId: kid.parent_id,
        relativeDepth,
        agentType: kid.agent_type,
        startedAt: kid.started_at,
        durationMs: kid.duration_ms,
        modelPrimary: kid.model_primary,
        costUsd: kid.cost_usd,
        metrics: summarize(callsBySession.get(kid.id) ?? []),
      });
      walk(kid.id, relativeDepth + 1);
    }
  };
  walk(sessionId, 1);

  return {
    sessionId,
    own: summarize(callsBySession.get(sessionId) ?? []),
    tree: summarize(calls),
    descendants,
  };
}
