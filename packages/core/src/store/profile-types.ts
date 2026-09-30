import type { Capability } from '../contract/capabilities';
import type { ToolCategory } from '../contract/types';

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

export type EventKind =
  | 'call'
  | 'tool'
  | 'turn'
  | 'harness'
  | 'compaction'
  | 'model-change'
  | 'mode-change';

/** A stable, machine-readable semantic action: the recorded tool category for a
 * `tool` step, otherwise the step kind. A `tool` step with no category falls
 * back to `'tool'`. This is a filter/sort token, never a display label. */
export type EventAction = ToolCategory | EventKind;

/** `error` matches rows with `error = 1`; `ok` matches every row without an
 * error (`error IS NULL OR error = 0`), matching how the UI decides status. */
export type EventStatus = 'ok' | 'error';

export type EventSortField = 'time' | 'agent' | 'kind' | 'action' | 'subject' | 'model' | 'status';

export type SortDirection = 'asc' | 'desc';

export type EventBase = {
  streamId: string;
  sessionId: string;
  seq: number;
  at: string | null;
  error: boolean | null;
  /** Stable semantic action token (see {@link EventAction}). */
  action: EventAction;
  /** Metadata-only presentation subject: the call/tool model, tool name,
   * compaction trigger, or `from → to`; null for a turn. Never args, paths,
   * prompt text, or tool output. */
  subject: string | null;
};

/** Seven source-step variants; payloads are metadata-only. */
export type Event =
  | (EventBase & { kind: 'call'; model: string | null })
  | (EventBase & {
      kind: 'tool';
      category: string | null;
      toolName: string | null;
      model: string | null;
    })
  | (EventBase & { kind: 'turn'; durationMs: number | null })
  | (EventBase & { kind: 'harness'; toolName: string | null })
  | (EventBase & { kind: 'compaction'; trigger: string | null })
  | (EventBase & { kind: 'model-change'; from: string | null; to: string | null })
  | (EventBase & { kind: 'mode-change'; from: string | null; to: string | null });

export type MergedEventsQuery = {
  scope?: Scope;
  /** Default 50, clamped [1, 200]. */
  limit?: number;
  /** Default 0, clamped >= 0. */
  offset?: number;
  /** Default 'time'. */
  sort?: EventSortField;
  /** Default 'asc'. */
  dir?: SortDirection;
  /** Restrict to these step kinds (AND with the other filters). */
  kind?: readonly EventKind[];
  /** Restrict to these semantic actions (AND with the other filters). */
  action?: readonly EventAction[];
  status?: EventStatus;
  /** Exact model name match. */
  model?: string;
  /** Metadata-only substring search over action, subject, and model. */
  q?: string;
};

/** Slim scope-node projection: enough to label an event's agent without the full ProfileNode. */
export type MergedEventNode = { id: string; agentType: string | null };

export type MergedEventsResponse = {
  sessionId: string;
  scope: Scope;
  /** The applied sort field and direction (echoed so the table can render it). */
  sort: EventSortField;
  dir: SortDirection;
  /** Every session node in scope (id → agentType), for agent labelling in the table. */
  nodes: readonly MergedEventNode[];
  /** Merged across the whole scope, ordered by the requested sort (default: at
   * ASC, then sessionId, then seq) with a stable tie-break. */
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

/**
 * One model's share of a group's output tokens. `other` is the overflow
 * bucket: literal `unknown`/`other` model names plus every named model outside
 * the top 7 by output tokens. Share is `outputTokens / group.outputTokens`
 * (0 when the group total is 0).
 */
export type ModelUsageEntry = {
  model: string | 'other';
  outputTokens: number;
  share: number;
};

/** A group's total output tokens and its top-7 + `other` model breakdown. */
export type ModelUsageGroup = {
  outputTokens: number;
  models: readonly ModelUsageEntry[];
};

/**
 * Metadata-only per-model OUTPUT-token shares for a session's own `kind='call'`
 * steps and for the same rows across every subagent descendant (the session
 * itself excluded). `null` models contribute to neither numerator nor
 * denominator. Empty groups are `{ outputTokens: 0, models: [] }`.
 */
export type ModelsResponse = {
  sessionId: string;
  session: ModelUsageGroup;
  descendants: ModelUsageGroup;
};

/**
 * Prompt-context pressure for one scope. A call is *observable* when at least
 * one of its prompt-input categories (`uncachedInput`/`cachedInput`/
 * `cacheWrite`) is present; a missing category then counts as `0`. Every field
 * is `null` when `observedCalls` is `0` (the source never reported prompt
 * input), never a fabricated zero. `cacheReadShare` is additionally `null` when
 * the observed prompt-input total is `0`.
 */
export type ContextMetrics = {
  observedCalls: number;
  /** Sum of the per-call prompt input (`uncachedInput + cachedInput + cacheWrite`). */
  promptInput: number | null;
  /** `promptInput / observedCalls`. */
  avgPromptInput: number | null;
  /** Nearest-rank p95: the value at `ceil(0.95 * observedCalls)` in ascending order. */
  p95PromptInput: number | null;
  peakPromptInput: number | null;
  /** Weighted `sum(cachedInput) / sum(promptInput)` over observable calls. */
  cacheReadShare: number | null;
};

/** One descendant session's own-only context metrics, for the comparison table. */
export type ProfileContextDescendant = {
  id: string;
  parentId: string | null;
  /** 1 for a direct child of the requested session, 2 for a grandchild, etc. */
  relativeDepth: number;
  agentType: string | null;
  startedAt: string | null;
  durationMs: number | null;
  modelPrimary: string | null;
  costUsd: number | null;
  metrics: ContextMetrics;
};

/**
 * Context pressure for a requested session: its own scope, the pooled tree
 * scope, and one own-only row per descendant. `descendants` is empty when the
 * session has none, and is ordered depth-first, parent before child, siblings
 * by `startedAt` ASC (null first) then id.
 */
export type ProfileContextResponse = {
  sessionId: string;
  own: ContextMetrics;
  tree: ContextMetrics;
  descendants: readonly ProfileContextDescendant[];
};
