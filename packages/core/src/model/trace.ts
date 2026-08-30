import type { UsageNumbers } from './usage';

export type ToolCategory =
  | 'read'
  | 'write'
  | 'exec'
  | 'search'
  | 'plan'
  | 'agent'
  | 'web'
  | 'mcp'
  | 'other';

export type TraceStepCall = {
  kind: 'call';
  i: number;
  at?: string;
  model: string;
  usage?: Partial<UsageNumbers>;
  /** Running total in canonical fields. */
  cum: UsageNumbers;
  /** ¶ prose / thinking / tool-use blocks in the response. */
  blocks: { text: number; thinking: number; toolUse: number };
};

export type TraceStepTool = {
  kind: 'tool';
  i: number;
  at?: string;
  category: ToolCategory;
  name: string;
  callId?: string;
  durationMs?: number;
  error?: boolean;
  /** Set when this call spawned a known subagent. */
  childId?: string;
};

export type TraceStepTurn = { kind: 'turn'; i: number; at?: string; durationMs?: number };
export type TraceStepHarness = { kind: 'harness'; i: number; at?: string; name: string };
export type TraceStepCompaction = {
  kind: 'compaction';
  i: number;
  at?: string;
  preTokens?: number;
  postTokens?: number;
};
export type TraceStepModelChange = {
  kind: 'model-change';
  i: number;
  at?: string;
  from: string;
  to: string;
};
export type TraceStepModeChange = {
  kind: 'mode-change';
  i: number;
  at?: string;
  from?: string;
  to: string;
};

export type TraceStep =
  | TraceStepCall
  | TraceStepTool
  | TraceStepTurn
  | TraceStepHarness
  | TraceStepCompaction
  | TraceStepModelChange
  | TraceStepModeChange;

export type SessionTrace = {
  id: string;
  steps: TraceStep[];
  models: string[];
  axis: { steps: number; startedAt?: string; endedAt?: string };
  /** Must equal the summary's exclusive usage. */
  totals: UsageNumbers;
  truncated?: boolean;
};
