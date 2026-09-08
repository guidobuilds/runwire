import type { Database } from 'bun:sqlite';
import { profileScopeCte, profileScopeParams, readProfileScopeNodes } from './profile-scope';
import type {
  CausalStatus,
  ProfileNode,
  ProfileSpawnsQuery,
  ProfileSpawnsResponse,
  SpawnItem,
} from './profile-types';

type NodeRow = {
  id: string;
  parent_id: string | null;
  relation: ProfileNode['relation'];
  agent_type: string | null;
  started_at: string | null;
  ended_at: string | null;
};

type ChildRow = NodeRow & { spawn_call_id: string | null };
type ActionRow = {
  parent_id: string;
  seq: number;
  call_id: string | null;
  child_id: string | null;
  at: string | null;
};

function node(row: NodeRow): ProfileNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    relation: row.relation,
    agentType: row.agent_type,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function key(parentId: string, callId: string): string {
  // A Map key, not SQL or a persisted identifier; NUL cannot collide with a
  // pair of SQLite TEXT values made by this function.
  return `${parentId}\0${callId}`;
}

const EMPTY_COUNTS: Record<CausalStatus, number> = {
  linked: 0,
  'missing-call-id': 0,
  'call-not-found': 0,
  ambiguous: 0,
  inconsistent: 0,
  unresolved: 0,
};

/**
 * Metadata-only spawn evidence.  A session row is a candidate by its declared
 * parent/spawn_call_id, never by steps.child_id: that column is merely cached
 * link evidence and may be stale, dangling, or collision-pruned by linkSessions.
 */
export function readProfileSpawns(
  db: Database,
  sessionId: string,
  query: ProfileSpawnsQuery = {},
): ProfileSpawnsResponse | null {
  const scope = query.scope ?? 'tree';
  const nodes = readProfileScopeNodes(db, sessionId, scope);
  if (nodes === null) return null;

  const prefix = profileScopeCte(scope);
  const params = profileScopeParams(sessionId);
  // Children are intentionally not joined back to profile_scope.  In `own`,
  // they provide causal context for the root without becoming scope consumers.
  const children = db
    .query(
      `${prefix}
       SELECT c.id, c.parent_id, c.relation, c.agent_type, c.started_at, c.ended_at, c.spawn_call_id
       FROM sessions c JOIN profile_scope ps ON ps.id = c.parent_id
       ORDER BY c.parent_id COLLATE BINARY, c.id COLLATE BINARY`,
    )
    .all(...params) as ChildRow[];
  const actions = db
    .query(
      `${prefix}
       SELECT st.session_id AS parent_id, st.seq, st.call_id, st.child_id, st.at
       FROM steps st JOIN profile_scope ps ON ps.id = st.session_id
       WHERE st.kind = 'tool' AND st.tool_category = 'agent'
       ORDER BY st.session_id COLLATE BINARY, st.seq ASC`,
    )
    .all(...params) as ActionRow[];

  const childrenByCall = new Map<string, ChildRow[]>();
  for (const child of children) {
    if (child.spawn_call_id === null) continue;
    const k = key(child.parent_id as string, child.spawn_call_id);
    const group = childrenByCall.get(k);
    if (group) group.push(child);
    else childrenByCall.set(k, [child]);
  }
  const actionsByCall = new Map<string, ActionRow[]>();
  for (const action of actions) {
    if (action.call_id === null) continue;
    const k = key(action.parent_id, action.call_id);
    const group = actionsByCall.get(k);
    if (group) group.push(action);
    else actionsByCall.set(k, [action]);
  }

  const childInScope = new Set(nodes.map((n) => n.id));
  const childrenByParent = new Map<string, ChildRow[]>();
  for (const child of children) {
    const group = childrenByParent.get(child.parent_id as string);
    if (group) group.push(child);
    else childrenByParent.set(child.parent_id as string, [child]);
  }
  const actionsByParent = new Map<string, ActionRow[]>();
  for (const action of actions) {
    const group = actionsByParent.get(action.parent_id);
    if (group) group.push(action);
    else actionsByParent.set(action.parent_id, [action]);
  }

  const items: SpawnItem[] = [];
  for (const parent of nodes) {
    for (const child of childrenByParent.get(parent.id) ?? []) {
      const childNode = node(child);
      let causalStatus: CausalStatus;
      // Set only for an unambiguous single-action match; ambiguous/unmatched
      // items have no single action to attribute a spawn instant to.
      let callAt: string | null = null;
      if (child.spawn_call_id === null) {
        causalStatus = 'missing-call-id';
      } else {
        const matchingChildren = childrenByCall.get(key(parent.id, child.spawn_call_id)) ?? [];
        const matchingActions = actionsByCall.get(key(parent.id, child.spawn_call_id)) ?? [];
        if (matchingActions.length === 0) causalStatus = 'call-not-found';
        else if (matchingChildren.length !== 1 || matchingActions.length !== 1)
          causalStatus = 'ambiguous';
        else {
          const matchingAction = matchingActions[0]!;
          callAt = matchingAction.at;
          if (matchingAction.child_id === child.id) causalStatus = 'linked';
          else if (matchingAction.child_id === null) causalStatus = 'unresolved';
          else causalStatus = 'inconsistent';
        }
      }
      items.push({
        parent,
        child: childNode,
        childInScope: childInScope.has(child.id),
        callId: child.spawn_call_id,
        causalStatus,
        callAt,
      });
    }
    // An agent action with a child candidate is represented by that child item.
    // Actions without one remain visible, including a missing call id.
    for (const action of actionsByParent.get(parent.id) ?? []) {
      const candidates =
        action.call_id === null ? [] : (childrenByCall.get(key(parent.id, action.call_id)) ?? []);
      if (candidates.length !== 0) continue;
      items.push({
        parent,
        child: null,
        childInScope: false,
        callId: action.call_id,
        causalStatus: action.call_id === null ? 'missing-call-id' : 'unresolved',
        // Each row here is exactly one action instance, never a grouped
        // multi-match, so its own `at` is unambiguous; a missing call id
        // means there is no spawn call to attribute an instant to.
        callAt: action.call_id === null ? null : action.at,
      });
    }
  }

  const counts = { ...EMPTY_COUNTS };
  for (const item of items) counts[item.causalStatus] += 1;
  const total = items.length;
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const page = items.slice(offset, offset + limit);
  const orphanRow = db
    .query(
      `${prefix}
       SELECT COUNT(*) AS count
       FROM sessions s JOIN profile_scope ps ON ps.id = s.id
       WHERE s.parent_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sessions parent WHERE parent.id = s.parent_id)`,
    )
    .get(...params) as { count: number };

  return {
    sessionId,
    scope,
    nodes,
    items: page,
    total,
    limit,
    offset,
    counts,
    orphanSessionCount: orphanRow.count,
    spawns: page,
  };
}
