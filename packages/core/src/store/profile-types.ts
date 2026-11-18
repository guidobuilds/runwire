import type { Capability } from '../contract/capabilities';
import type { ToolCategory } from '../contract/types';

export type Scope = 'own' | 'tree';
export type ProfileScope = Scope;

export const PROFILE_TOKEN_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const;

export type TokenField = (typeof PROFILE_TOKEN_FIELDS)[number];
export type ProfileUsageField = TokenField;
export type NullableTokens = Record<TokenField, number | null>;
export type FieldCounts = Record<TokenField, number>;
export type ProfileUsageTotals = NullableTokens;

export type Harness = {
  id: string;
  displayName: string;
  adapterVersion: string;
};
export type Capabilities = readonly Capability[];

export type ProfileTimestamps = {
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
};
export type Timestamps = ProfileTimestamps;

export type ProfileNode = {
  id: string;
  parentId: string | null;
  relation: 'subagent' | 'teammate' | 'fork' | null;
  agentType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  harness?: Harness;
  capabilities?: readonly Capability[];
  durationMs?: number | null;
  timestamps?: ProfileTimestamps;
};
export type Node = ProfileNode;

export type UsageSeries = {
  model: string | 'unknown' | 'other';
  totals: NullableTokens;
  callsWithField: FieldCounts;
  callCount: number;
};

export type TimeDomain = {
  start: string | null;
  end: string | null;
};

export type EventKind =
  | 'call'
  | 'tool'
  | 'turn'
  | 'harness'
  | 'compaction'
  | 'model-change'
  | 'mode-change';

export type EventAction = ToolCategory | EventKind;

export type EventStatus = 'ok' | 'error';

export type EventSortField = 'time' | 'agent' | 'kind' | 'action' | 'subject' | 'model' | 'status';

export type SortDirection = 'asc' | 'desc';

export type EventBase = {
  streamId: string;
  sessionId: string;
  seq: number;
  at: string | null;
  error: boolean | null;
  action: EventAction;
  subject: string | null;
};

export type Event =
  | (EventBase & { kind: 'call'; model: string | null })
  | (EventBase & {
      kind: 'tool';
      category: string | null;
      toolName: string | null;
      mcpServer?: string | null;
      mcpTool?: string | null;
      model: string | null;
    })
  | (EventBase & { kind: 'turn'; durationMs: number | null })
  | (EventBase & { kind: 'harness'; toolName: string | null })
  | (EventBase & { kind: 'compaction'; trigger: string | null })
  | (EventBase & { kind: 'model-change'; from: string | null; to: string | null })
  | (EventBase & { kind: 'mode-change'; from: string | null; to: string | null });

export type MergedEventsQuery = {
  scope?: Scope;
  limit?: number;
  offset?: number;
  sort?: EventSortField;
  dir?: SortDirection;
  kind?: readonly EventKind[];
  action?: readonly EventAction[];
  status?: EventStatus;
  model?: string;
  q?: string;
};

export type MergedEventNode = { id: string; agentType: string | null };

export type MergedEventsResponse = {
  sessionId: string;
  scope: Scope;
  sort: EventSortField;
  dir: SortDirection;
  nodes: readonly MergedEventNode[];
  items: readonly Event[];
  total: number;
  limit: number;
  offset: number;
  excludedNullAtCount: number;
};

export type CausalStatus =
  | 'linked'
  | 'missing-call-id'
  | 'call-not-found'
  | 'ambiguous'
  | 'inconsistent'
  | 'unresolved';

export type SpawnItem = {
  parent: ProfileNode;
  child: ProfileNode | null;
  childInScope: boolean;
  callId: string | null;
  causalStatus: CausalStatus;
  callAt: string | null;
};

export type ProfileSpawn = SpawnItem;

export type ProfileSpawnsQuery = {
  scope?: Scope;
  limit?: number;
  offset?: number;
};

export type ProfileSpawnsResponse = {
  sessionId: string;
  scope: Scope;
  nodes: readonly ProfileNode[];
  items: readonly SpawnItem[];
  total: number;
  limit: number;
  offset: number;
  counts: Record<CausalStatus, number>;
  orphanSessionCount: number;
  spawns?: readonly SpawnItem[];
};
export type SpawnsQuery = ProfileSpawnsQuery;
export type SpawnsResponse = ProfileSpawnsResponse;

export type SignalsQuery = { scope?: Scope };

export type SignalsResponse = {
  sessionId: string;
  scope: Scope;
  compactions: { auto: number; manual: number; unknown: number };
  modelChanges: number;
  toolCalls: { total: number; mcp: number };
  mcpServers: readonly string[];
  skillCalls: number;
  skillNames: readonly string[];
};

export type TimelineQuery = { scope?: Scope; field?: TokenField };

export type TimelinePoint = {
  at: string;
  delta: readonly (number | null)[];
  cumulative: readonly (number | null)[];
  totalDelta: number | null;
  totalCumulative: number | null;
};

export type SpawnMarker = { at: string; parentId: string; childId: string };

export type TimelineResponse = {
  sessionId: string;
  scope: Scope;
  field: TokenField;
  series: readonly UsageSeries[];
  points: readonly TimelinePoint[];
  spawns: readonly SpawnMarker[];
  excludedNullAtCount: number;
  timeDomain: TimeDomain;
};

export type ModelUsageEntry = {
  model: string | 'other';
  outputTokens: number;
  share: number;
};

export type ModelUsageGroup = {
  outputTokens: number;
  models: readonly ModelUsageEntry[];
};

export type ModelsResponse = {
  sessionId: string;
  session: ModelUsageGroup;
  descendants: ModelUsageGroup;
};

export type ContextMetrics = {
  observedCalls: number;
  promptInput: number | null;
  avgPromptInput: number | null;
  p95PromptInput: number | null;
  peakPromptInput: number | null;
  cacheReadShare: number | null;
};

export type ProfileContextDescendant = {
  id: string;
  parentId: string | null;
  relativeDepth: number;
  agentType: string | null;
  startedAt: string | null;
  durationMs: number | null;
  modelPrimary: string | null;
  costUsd: number | null;
  metrics: ContextMetrics;
};

export type ProfileContextResponse = {
  sessionId: string;
  own: ContextMetrics;
  tree: ContextMetrics;
  descendants: readonly ProfileContextDescendant[];
};

export type LaneCallKind = 'agent' | 'mcp' | 'write' | 'exec' | 'look' | 'other' | 'reply';

export type LaneEvent =
  | {
      kind: 'compaction';
      trigger: string | null;
      preTokens: number | null;
      postTokens: number | null;
      after?: true;
    }
  | { kind: 'model-change'; from: string | null; to: string | null; after?: true };

export type LaneCalls = {
  seq: number[];
  at: string[];
  model: number[];
  promptInput: (number | null)[];
  output: (number | null)[];
  kind: LaneCallKind[];
  tools: number[];
  mechanical: boolean[];
  failed: number[];
  mcp: number[];
  skill: number[];
  spawns: (string[] | null)[];
  events: (LaneEvent[] | null)[];
};

export type LaneAgent = {
  id: string;
  parentId: string | null;
  depth: number;
  agentType: string | null;
  spawnCallId: string | null;
  calls: LaneCalls;
};

export type LaneModel = {
  name: string;
  contextWindow: number | null;
  tier: 'high' | 'mid' | 'low' | null;
};

export type LanesResponse = {
  sessionId: string;
  scope: Scope;
  agents: readonly LaneAgent[];
  models: readonly LaneModel[];
  callCount: number;
  excludedNullAtCount: number;
};
