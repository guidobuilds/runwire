import type { LaneAgent, LaneCallKind, LaneEvent, LaneModel, LanesResponse } from '@runwire/core';

export type LaneColumn = {
  index: number;
  local: number;
  agentIndex: number;
  agentId: string;
  seq: number;
  at: number;
  model: string | null;
  tier: LaneModel['tier'];
  contextWindow: number | null;
  contextPercent: number | null;
  promptInput: number | null;
  output: number | null;
  kind: LaneCallKind;
  tools: number;
  mechanical: boolean;
  fails: number;
  marks: { subagents: number; skills: number; mcp: number; failures: number };
  spawns: readonly string[];
  events: readonly LaneEvent[];
};
export type ModelAgent = Omit<LaneAgent, 'calls'> & {
  label: string;
  detail: string;
  cols: LaneColumn[];
};
export type LaneModelData = {
  sessionId: string;
  agents: ModelAgent[];
  cols: LaneColumn[];
  byId: Map<string, ModelAgent>;
  children: Map<string, string[]>;
  callCount: number;
  excludedNullAtCount: number;
};

/** Caller memoizes by response identity/session revision, never by sessionId alone. */
export function buildModel(response: LanesResponse): LaneModelData {
  const cols: LaneColumn[] = [];
  const shortTypes = response.agents.map((agent) => {
    const type = agent.agentType?.split(/[:/]/).at(-1) || 'Agent';
    return type.length > 24 ? `${type.slice(0, 23)}…` : type;
  });
  const totals = new Map<string, number>();
  response.agents.forEach((agent, index) => {
    if (agent.parentId) {
      const type = shortTypes[index] ?? 'Agent';
      totals.set(type, (totals.get(type) ?? 0) + 1);
    }
  });
  const ordinals = new Map<string, number>();
  const agents = response.agents.map(({ calls, ...agent }, agentIndex) => {
    const agentCols = calls.seq.map((seq, local): LaneColumn => {
      const model = response.models[calls.model[local] ?? -1];
      const promptInput = calls.promptInput[local] ?? null;
      const contextWindow = model?.contextWindow ?? null;
      const fails = calls.failed[local] ?? 0;
      const spawns = [...(calls.spawns[local] ?? [])];
      return {
        index: 0,
        local,
        agentIndex,
        agentId: agent.id,
        seq,
        at: Date.parse(calls.at[local] ?? ''),
        model: model?.name ?? null,
        tier: model?.tier ?? null,
        contextWindow,
        promptInput,
        contextPercent:
          contextWindow && promptInput !== null ? (promptInput / contextWindow) * 100 : null,
        output: calls.output[local] ?? null,
        kind: calls.kind[local] ?? 'reply',
        tools: calls.tools[local] ?? 0,
        mechanical: calls.mechanical[local] ?? false,
        fails,
        spawns,
        marks: {
          subagents: Math.max(spawns.length, calls.kind[local] === 'agent' ? 1 : 0),
          skills: calls.skill[local] ?? 0,
          mcp: calls.mcp[local] ?? 0,
          failures: fails,
        },
        events: (calls.events[local] ?? []).map((event) => ({ ...event })),
      };
    });
    cols.push(...agentCols);
    const type = shortTypes[agentIndex] ?? 'Agent';
    const ordinal = (ordinals.get(type) ?? 0) + 1;
    if (agent.parentId) ordinals.set(type, ordinal);
    const label = !agent.parentId
      ? 'main'
      : `${type}${(totals.get(type) ?? 0) > 1 ? ` #${ordinal}` : ''}`;
    return {
      ...agent,
      label,
      detail: `${agent.agentType ?? 'Agent'} · ${agentCols.length} calls`,
      cols: agentCols,
    };
  });
  cols.sort((a, b) => a.at - b.at || a.agentIndex - b.agentIndex || a.seq - b.seq);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const children = new Map(agents.map((agent) => [agent.id, [] as string[]]));
  for (const agent of agents) {
    if (agent.parentId) children.get(agent.parentId)?.push(agent.id);
  }
  cols.forEach((col, index) => {
    col.index = index;
  });
  for (const agent of agents) {
    agent.cols.sort((a, b) => a.index - b.index);
    agent.cols.forEach((col, local) => {
      col.local = local;
    });
  }
  return {
    sessionId: response.sessionId,
    agents,
    cols,
    byId,
    children,
    callCount: cols.length,
    excludedNullAtCount: response.excludedNullAtCount,
  };
}
