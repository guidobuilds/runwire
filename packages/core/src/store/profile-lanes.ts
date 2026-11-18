import type { Database } from 'bun:sqlite';
import { type ModelOverride, resolveModelCatalog } from '../models/catalog';
import { profileScopeCte, profileScopeParams } from './profile-scope';
import type {
  LaneAgent,
  LaneCallKind,
  LaneCalls,
  LaneEvent,
  LaneModel,
  LanesResponse,
  Scope,
} from './profile-types';

type NodeRow = {
  id: string;
  parent_id: string | null;
  agent_type: string | null;
  spawn_call_id: string | null;
  in_scope: number;
};
type StepRow = {
  session_id: string;
  seq: number;
  at: string | null;
  kind: string;
  model: string | null;
  model_provider: string | null;
  tool_category: string | null;
  call_id: string | null;
  error: number | null;
  uncached_input: number | null;
  cached_input: number | null;
  cache_write: number | null;
  output: number | null;
  compaction_trigger: string | null;
  pre_tokens: number | null;
  post_tokens: number | null;
  from_value: string | null;
  to_value: string | null;
};

const NODES_SQL = `
  SELECT s.id, s.parent_id, s.agent_type, s.spawn_call_id,
    s.id IN (SELECT id FROM profile_scope) AS in_scope
  FROM sessions s
  WHERE s.id IN (SELECT id FROM profile_scope)
     OR s.parent_id IN (SELECT id FROM profile_scope)
  ORDER BY s.started_at ASC, s.id COLLATE BINARY
`;
const STEPS_SQL = `
  SELECT st.session_id, st.seq, st.at, st.kind, m.name AS model, m.provider AS model_provider,
    st.tool_category, st.call_id, st.error,
    st.uncached_input, st.cached_input, st.cache_write, st.output,
    st.compaction_trigger, st.pre_tokens, st.post_tokens, st.from_value, st.to_value
  FROM steps st
  JOIN profile_scope ps ON ps.id = st.session_id
  LEFT JOIN models m ON m.id = st.model_id
  WHERE st.kind IN ('call', 'tool', 'compaction', 'model-change')
  ORDER BY st.session_id COLLATE BINARY, st.seq ASC
`;

const PRIORITY: readonly LaneCallKind[] = [
  'reply',
  'other',
  'look',
  'exec',
  'write',
  'mcp',
  'agent',
];
function toolKind(category: string | null): LaneCallKind {
  switch (category) {
    case 'agent':
    case 'mcp':
    case 'write':
    case 'exec':
      return category;
    case 'read':
    case 'search':
      return 'look';
    default:
      return 'other';
  }
}

function emptyCalls(): LaneCalls {
  return {
    seq: [],
    at: [],
    model: [],
    promptInput: [],
    output: [],
    kind: [],
    tools: [],
    mechanical: [],
    failed: [],
    mcp: [],
    skill: [],
    spawns: [],
    events: [],
  };
}

function assemble(
  rows: readonly StepRow[],
  children: ReadonlyMap<string, string[]>,
  modelIndex: (name: string | null, provider: string | null) => number,
): { calls: LaneCalls; excluded: number } {
  const calls = emptyCalls();
  let current: number | null = null;
  let excluded = 0;
  let pending: LaneEvent[] = [];
  for (const row of rows) {
    if (row.kind === 'call') {
      current = null;
      if (row.at === null) excluded += 1;
      const hasInput =
        row.uncached_input !== null || row.cached_input !== null || row.cache_write !== null;
      if (row.at === null || (!hasInput && row.output === null)) continue;
      current = calls.seq.length;
      calls.seq.push(row.seq);
      calls.at.push(row.at);
      calls.model.push(modelIndex(row.model, row.model_provider));
      calls.promptInput.push(
        hasInput
          ? (row.uncached_input ?? 0) + (row.cached_input ?? 0) + (row.cache_write ?? 0)
          : null,
      );
      calls.output.push(row.output);
      calls.kind.push('reply');
      calls.tools.push(0);
      calls.mechanical.push(false);
      calls.failed.push(0);
      calls.mcp.push(0);
      calls.skill.push(0);
      calls.spawns.push(null);
      calls.events.push(pending.length === 0 ? null : pending);
      pending = [];
    } else if (row.kind === 'tool') {
      if (current === null) continue;
      const count = calls.tools[current] ?? 0;
      calls.tools[current] = count + 1;
      const kind = toolKind(row.tool_category);
      if (PRIORITY.indexOf(kind) > PRIORITY.indexOf(calls.kind[current] ?? 'reply')) {
        calls.kind[current] = kind;
      }
      const mechanical = kind === 'exec' || kind === 'look';
      calls.mechanical[current] = mechanical && (count === 0 || calls.mechanical[current] === true);
      if (row.error === 1) calls.failed[current] = (calls.failed[current] ?? 0) + 1;
      if (row.tool_category === 'mcp') calls.mcp[current] = (calls.mcp[current] ?? 0) + 1;
      if (row.tool_category === 'skill') calls.skill[current] = (calls.skill[current] ?? 0) + 1;
      if (row.tool_category === 'agent' && row.call_id !== null) {
        const ids = children.get(row.call_id);
        if (ids) {
          const spawns = calls.spawns[current] ?? [];
          for (const id of ids) if (!spawns.includes(id)) spawns.push(id);
          calls.spawns[current] = spawns;
        }
      }
    } else if (row.kind === 'compaction') {
      pending.push({
        kind: 'compaction',
        trigger: row.compaction_trigger,
        preTokens: row.pre_tokens,
        postTokens: row.post_tokens,
      });
    } else if (row.kind === 'model-change') {
      pending.push({ kind: 'model-change', from: row.from_value, to: row.to_value });
    }
  }
  const last = calls.seq.length - 1;
  if (last >= 0 && pending.length > 0) {
    calls.events[last] = [
      ...(calls.events[last] ?? []),
      ...pending.map((event) => ({ ...event, after: true as const })),
    ];
  }
  return { calls, excluded };
}

export function readProfileLanes(
  db: Database,
  sessionId: string,
  query: { scope: Scope },
  modelOverrides: readonly ModelOverride[] = [],
): LanesResponse | null {
  const prefix = profileScopeCte(query.scope);
  const params = profileScopeParams(sessionId);
  const nodes = db.query(`${prefix}${NODES_SQL}`).all(...params) as NodeRow[];
  const root = nodes.find((node) => node.id === sessionId);
  if (!root) return null;
  const rows = db.query(`${prefix}${STEPS_SQL}`).all(...params) as StepRow[];
  const bySession = new Map<string, StepRow[]>();
  for (const row of rows) {
    const group = bySession.get(row.session_id) ?? [];
    group.push(row);
    bySession.set(row.session_id, group);
  }
  const children = new Map<string, NodeRow[]>();
  const spawns = new Map<string, Map<string, string[]>>();
  for (const node of nodes) {
    if (node.parent_id === null) continue;
    const siblings = children.get(node.parent_id) ?? [];
    if (node.in_scope === 1) siblings.push(node);
    children.set(node.parent_id, siblings);
    if (node.spawn_call_id === null) continue;
    const parentSpawns = spawns.get(node.parent_id) ?? new Map<string, string[]>();
    const ids = parentSpawns.get(node.spawn_call_id) ?? [];
    ids.push(node.id);
    parentSpawns.set(node.spawn_call_id, ids);
    spawns.set(node.parent_id, parentSpawns);
  }
  const models: LaneModel[] = [];
  const modelIndices = new Map<string, number>();
  const modelIndex = (name: string | null, provider: string | null): number => {
    if (name === null) return -1;
    const key = JSON.stringify([provider, name]);
    const existing = modelIndices.get(key);
    if (existing !== undefined) return existing;
    const index = models.length;
    models.push({ name, ...resolveModelCatalog(provider, name, modelOverrides) });
    modelIndices.set(key, index);
    return index;
  };
  const agents: LaneAgent[] = [];
  const visited = new Set<string>();
  const stack = [{ node: root, depth: 0 }];
  let callCount = 0;
  let excludedNullAtCount = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || visited.has(entry.node.id)) continue;
    const { node, depth } = entry;
    visited.add(node.id);
    const result = assemble(
      bySession.get(node.id) ?? [],
      spawns.get(node.id) ?? new Map(),
      modelIndex,
    );
    agents.push({
      id: node.id,
      parentId: node.parent_id,
      depth,
      agentType: node.agent_type,
      spawnCallId: node.spawn_call_id,
      calls: result.calls,
    });
    callCount += result.calls.seq.length;
    excludedNullAtCount += result.excluded;
    const kids = children.get(node.id) ?? [];
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      if (kid) stack.push({ node: kid, depth: depth + 1 });
    }
  }
  return { sessionId, scope: query.scope, agents, models, callCount, excludedNullAtCount };
}
