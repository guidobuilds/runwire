export type ProjectIdentityKind = 'remote' | 'repo-root' | 'cwd';

export type Project = {
  key: string;
  name: string;
  repoRoot?: string;
  worktree?: string;
  identity: ProjectIdentityKind;
};

export type SessionRelation = 'subagent' | 'teammate' | 'fork';
export type InitiatorKind = 'human' | 'machine' | 'unknown';

export type SourceRef = { sourceId: string; sourceLocator?: string };

export type Session = {
  id: string;
  harnessId: string;
  projectKey: string;
  parentId?: string;
  relation?: SessionRelation;
  depth: number;
  agentType?: string;
  spawnCallId?: string;
  title?: string;
  cwd?: string;
  gitBranch?: string;
  gitCommit?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  modelPrimary?: string;
  modelPrimaryProvider?: string;
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
  costUsd?: number;
  initiatorKind?: InitiatorKind;
  initiatorSurface?: string;
  initiatorAutomation?: string;
  resumed?: boolean;
  forkedFrom?: string;
  harnessVersionFirst?: string;
  harnessVersionLast?: string;
  sourceId?: string;
  sourceLocator?: string;
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
  model?: string;
  modelProvider?: string;
  toolCategory?: ToolCategory;
  toolName?: string;
  mcpServer?: string;
  mcpTool?: string;
  callId?: string;
  skillName?: string;
  childId?: string;
  durationMs?: number;
  error?: boolean;
  uncachedInput?: number;
  cachedInput?: number;
  cacheWrite?: number;
  output?: number;
  reasoningOutput?: number;
  compactionTrigger?: string;
  preTokens?: number;
  postTokens?: number;
  fromValue?: string;
  toValue?: string;
};

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export type Diagnostic = {
  level: DiagnosticLevel;
  code: string;
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

export const TOKEN_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const satisfies readonly (keyof Session & keyof Step)[];
