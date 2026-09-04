// The 2026-09-04 core/adapter contract (docs/ARCHITECTURE.md §3). Additive:
// lives alongside the untouched legacy `../model` types until f2-t8 deletes
// them (.forge/core-adapter-reset/plan.md P17).

export type ProjectIdentityKind = 'remote' | 'repo-root' | 'cwd';

export type Project = {
  /** Normalized remote -> repo root -> cwd (D8, D9). */
  key: string;
  /** Repo name or last path segment. */
  name: string;
  repoRoot?: string;
  worktree?: string;
  identity: ProjectIdentityKind;
};

export type SessionRelation = 'subagent' | 'teammate' | 'fork';
export type InitiatorKind = 'human' | 'machine' | 'unknown';

export type Session = {
  /** `${harnessId}:${sourceId}`, stable across imports. */
  id: string;
  harnessId: string;
  projectKey: string;
  parentId?: string;
  relation?: SessionRelation;
  depth: number;
  agentType?: string;
  /** The parent's tool call_id that spawned this child (adr/0001); core fills steps.child_id from it. */
  spawnCallId?: string;
  /** Only when ctx.privacy.titles (D7). */
  title?: string;
  cwd?: string;
  gitBranch?: string;
  gitCommit?: string;
  /** ISO-8601 UTC. */
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  modelPrimary?: string;
  modelChanges?: number;
  modePrimary?: string;
  modeChanges?: number;
  effort?: string;
  uncachedInput?: number;
  cachedInput?: number;
  cacheWrite?: number;
  output?: number;
  reasoningOutput?: number;
  turns?: number;
  apiCalls?: number;
  toolCalls?: number;
  compactions?: number;
  /** Harness-reported only, never computed. */
  costUsd?: number;
  initiatorKind?: InitiatorKind;
  initiatorSurface?: string;
  initiatorAutomation?: string;
  resumed?: boolean;
  forkedFrom?: string;
  harnessVersionFirst?: string;
  harnessVersionLast?: string;
  sourcePath: string;
  sourceSize: number;
  sourceMtime: number;
};

export type StepKind =
  | 'call'
  | 'tool'
  | 'turn'
  | 'harness'
  | 'compaction'
  | 'model-change'
  | 'mode-change';

export type ToolCategory =
  | 'read'
  | 'write'
  | 'exec'
  | 'search'
  | 'plan'
  | 'agent'
  | 'web'
  | 'mcp'
  | 'skill'
  | 'other';

export type Step = {
  sessionId: string;
  seq: number;
  at?: string;
  kind: StepKind;
  /** call */
  model?: string;
  /** tool; harness uses toolName = event name */
  toolCategory?: ToolCategory;
  toolName?: string;
  callId?: string;
  skillName?: string;
  /** tool (agent) - filled by core, ARCHITECTURE §6 */
  childId?: string;
  /** tool, turn */
  durationMs?: number;
  error?: boolean;
  /** call */
  uncachedInput?: number;
  cachedInput?: number;
  cacheWrite?: number;
  output?: number;
  reasoningOutput?: number;
  /** compaction */
  compactionTrigger?: string;
  preTokens?: number;
  postTokens?: number;
  /** model-change, mode-change */
  fromValue?: string;
  toValue?: string;
};

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export type Diagnostic = {
  level: DiagnosticLevel;
  code: string;
  /** Never contains record content. */
  message: string;
  line?: number;
  count?: number;
};

export type SessionBundle = {
  project: Project;
  session: Session;
  steps: Step[];
  diagnostics: Diagnostic[];
};

/** The five canonical token fields (D5), in schema/rollup order. */
export const TOKEN_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const satisfies readonly (keyof Session & keyof Step)[];
