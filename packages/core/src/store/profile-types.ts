import type { Capability } from '../contract/capabilities';

/** The scope selector shared by every profile reader. */
export type Scope = 'own' | 'tree';
/** @deprecated Prefer Scope in new reader contracts. */
export type ProfileScope = Scope;

export const PROFILE_TOKEN_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const;

/** A field is intentionally null when its source did not report it. */
export type TokenField = (typeof PROFILE_TOKEN_FIELDS)[number];
/** @deprecated Prefer TokenField. */
export type ProfileUsageField = TokenField;
export type NullableTokens = Record<TokenField, number | null>;
/** Number of rows/calls that contributed a non-null value for each token field. */
export type FieldCounts = Record<TokenField, number>;
/** @deprecated Prefer NullableTokens. */
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

/** Metadata-only node; it never carries a title, source path, or raw step data. */
export type ProfileNode = {
  id: string;
  parentId: string | null;
  relation: 'subagent' | 'teammate' | 'fork' | null;
  agentType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Present when the node projection joins the harness table. */
  harness?: Harness;
  /** The capabilities declared by the node's harness. */
  capabilities?: readonly Capability[];
  /** Present when duration is selected alongside the timestamps. */
  durationMs?: number | null;
  timestamps?: ProfileTimestamps;
};
export type Node = ProfileNode;

export type UsageSeries = {
  /** A literal model id, or a reserved global bucket. */
  model: string | 'unknown' | 'other';
  totals: NullableTokens;
  callsWithField: FieldCounts;
  callCount: number;
};

export type TimeDomain = {
  start: string | null;
  end: string | null;
};

export type EventFilter =
  | 'relevant'
  | 'signals'
  | 'all'
  | 'mcp'
  | 'skill'
  | 'hook'
  | 'read'
  | 'write'
  | 'exec'
  | 'agent'
  | 'error';

export type EventKind =
  | 'call'
  | 'tool'
  | 'turn'
  | 'harness'
  | 'compaction'
  | 'model-change'
  | 'mode-change';

export type EventBase = {
  streamId: string;
  sessionId: string;
  seq: number;
  at: string | null;
  error: boolean | null;
};

/** Seven source-step variants; payloads are metadata-only. */
export type Event =
  | (EventBase & { kind: 'call'; model: string | null })
  | (EventBase & { kind: 'tool'; category: string | null; toolName: string | null })
  | (EventBase & { kind: 'turn'; durationMs: number | null })
  | (EventBase & { kind: 'harness'; toolName: string | null })
  | (EventBase & { kind: 'compaction'; trigger: string | null })
  | (EventBase & { kind: 'model-change'; from: string | null; to: string | null })
  | (EventBase & { kind: 'mode-change'; from: string | null; to: string | null });

export type MergedEventsQuery = {
  scope?: Scope;
  /** Vocabulary: relevant/signals/all/mcp/skill/hook/read/write/exec/agent/error; default 'signals'. */
  filter?: EventFilter;
  /** Default 50, clamped [1, 200]. */
  limit?: number;
  /** Default 0, clamped >= 0. */
  offset?: number;
};

export type MergedEventsResponse = {
  sessionId: string;
  scope: Scope;
  filter: EventFilter;
  /** Merged across the whole scope, ordered by at ASC, then sessionId, then seq. */
  items: readonly Event[];
  /** Count of in-scope, filtered, at-NOT-NULL rows. */
  total: number;
  limit: number;
  offset: number;
  /** Filtered rows with at IS NULL, never interleaved into items. */
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
  /** The `at` of the matched spawn-call step (kind='tool', tool_category='agent');
   * null when there is no matching action, or the action's `at` is null, or the
   * match is ambiguous (see readProfileSpawns). */
  callAt: string | null;
};

/** @deprecated Prefer SpawnItem. */
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
  /** Compatibility name retained for older consumers. */
  spawns?: readonly SpawnItem[];
};
export type SpawnsQuery = ProfileSpawnsQuery;
export type SpawnsResponse = ProfileSpawnsResponse;

export type SignalsQuery = { scope?: Scope };

export type SignalsResponse = {
  sessionId: string;
  scope: Scope;
  /** unknown = trigger IS NULL, or any literal other than 'auto'/'manual'. */
  compactions: { auto: number; manual: number; unknown: number };
  modelChanges: number;
  toolCalls: { total: number; mcp: number };
  /** Distinct, best-effort parse of tool_name for MCP calls (see readProfileSignals). */
  mcpServers: readonly string[];
  skillCalls: number;
  /** Distinct, non-null steps.skill_name. */
  skillNames: readonly string[];
};

export type TimelineQuery = { scope?: Scope; field?: TokenField };

export type TimelinePoint = {
  /** Never null — null-at rows are excluded from points, see excludedNullAtCount. */
  at: string;
  /** Per-model bucket deltas, indexed exactly like TimelineResponse.series. */
  delta: readonly (number | null)[];
  /** Per-model running totals, indexed exactly like TimelineResponse.series. */
  cumulative: readonly (number | null)[];
  totalDelta: number | null;
  totalCumulative: number | null;
};

export type SpawnMarker = { at: string; parentId: string; childId: string };

export type TimelineResponse = {
  sessionId: string;
  scope: Scope;
  field: TokenField;
  /** Same reserved-bucket legend convention: top 7 + unknown/other. */
  series: readonly UsageSeries[];
  /** At most 400 buckets, exact (not sampled), ordered by at ASC across the whole scope. */
  points: readonly TimelinePoint[];
  /** From the same callAt join as the agent graph; at !== null only. */
  spawns: readonly SpawnMarker[];
  /** Call steps in scope with at IS NULL, dropped from points. */
  excludedNullAtCount: number;
  timeDomain: TimeDomain;
};
