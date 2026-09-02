import type { DiagnosticLevel } from '../model/diagnostic';
import type { Confidence } from '../model/metric';
import type { InitiatorKind, SessionRelation } from '../model/session';
import type { ToolCategory } from '../model/trace';
import type { Usage } from '../model/usage';

/** ISO-8601 UTC. */
export type At = string;

export type UsageEventFields = {
  uncachedInput?: number;
  cachedInput?: number;
  cacheWrite?: number;
  output?: number;
  reasoningOutput?: number;
};

export type MetaEvent = {
  kind: 'meta';
  sourceId: string;
  role: 'root' | 'child';
  harnessVersion?: string;
  cwd?: string;
  title?: string;
  git?: { branch?: string; commit?: string; remote?: string };
  at?: At;
};

export type LinkEvent = {
  kind: 'link';
  parentSourceId: string;
  relation: SessionRelation;
  agentType?: string;
  depth?: number;
  /** The parent's tool call that spawned this child. */
  viaCallId?: string;
};

/**
 * Who started the session, as classified by the adapter (only the adapter
 * knows its harness's surface vocabulary). Carries its own `confidence`
 * because the strength of the signal varies per surface, not per kind — an
 * SDK surface is `high` machine evidence while an interactive surface is only
 * `medium` human evidence. Deliberately carries no `at`: it describes the
 * whole session, and touching the timestamp window here would perturb
 * timing/duration derivation in reduce.
 */
export type InitiatorEvent = {
  kind: 'initiator';
  initiatorKind: InitiatorKind;
  /** Raw harness surface value, unmapped. */
  surface: string;
  automation?: string;
  confidence: Confidence;
};

export type ObservedEvent = { kind: 'observed'; at: At };
export type ModelEvent = { kind: 'model'; model: string; at?: At };
export type ModeEvent = { kind: 'mode'; mode: string; at?: At };
export type EffortEvent = { kind: 'effort'; effort: string; at?: At };
export type CwdEvent = { kind: 'cwd'; cwd: string; at?: At };
export type VersionEvent = { kind: 'version'; version: string; at?: At };

export type UsageEvent = UsageEventFields & {
  kind: 'usage';
  dedupeKey?: string;
  model?: string;
  at?: At;
  derived?: Array<keyof Usage>;
  /** Per API call; blocks are summed across dedupe duplicates. */
  blocks?: { text?: number; thinking?: number; toolUse?: number };
};

export type UsageTotalEvent = UsageEventFields & {
  kind: 'usageTotal';
  at?: At;
  derived?: Array<keyof Usage>;
};

export type TurnEvent = { kind: 'turn'; at?: At; durationMs?: number };

export type ToolCallEvent = {
  kind: 'toolCall';
  at?: At;
  name: string;
  category: ToolCategory;
  callId?: string;
  durationMs?: number;
};

export type ToolResultEvent = {
  kind: 'toolResult';
  at?: At;
  callId?: string;
  name?: string;
  error: boolean;
  durationMs?: number;
};

/** Fixed vocabulary per adapter: 'hook:<hookName>', 'permission', 'plan-mode', 'auto-mode', 'nudge'... */
export type HarnessEventEvent = { kind: 'harnessEvent'; at?: At; name: string };

export type CompactionEvent = {
  kind: 'compaction';
  at?: At;
  trigger?: string;
  preTokens?: number;
  postTokens?: number;
};

export type CostEvent = { kind: 'cost'; usd: number; at?: At };

export type FlagEvent =
  | { kind: 'flag'; flag: 'resumed'; value: true }
  | { kind: 'flag'; flag: 'forkedFrom'; value: string };

export type DiagnosticEvent = {
  kind: 'diagnostic';
  level: DiagnosticLevel;
  code: string;
  message: string;
  line?: number;
  /** Aggregated duplicate count, when the same diagnostic recurs many times. */
  count?: number;
};

export type ScoutEvent =
  | MetaEvent
  | LinkEvent
  | InitiatorEvent
  | ObservedEvent
  | ModelEvent
  | ModeEvent
  | EffortEvent
  | CwdEvent
  | VersionEvent
  | UsageEvent
  | UsageTotalEvent
  | TurnEvent
  | ToolCallEvent
  | ToolResultEvent
  | HarnessEventEvent
  | CompactionEvent
  | CostEvent
  | FlagEvent
  | DiagnosticEvent;
