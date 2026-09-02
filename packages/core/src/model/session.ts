import type { Diagnostic } from './diagnostic';
import type { HarnessId } from './harness';
import type { Metric } from './metric';
import type { Counts, Usage } from './usage';

export type ProjectIdentityKind = 'remote' | 'repo-root' | 'cwd';

export type ProjectRef = {
  /** Grouping key: normalized remote URL, else repo root, else cwd (D8, D9). */
  key: string;
  /** Displayed: repo name or last path segment. */
  name: string;
  repoRoot?: string;
  /** Worktree name when cwd is inside a linked worktree. */
  worktree?: string;
  identity: ProjectIdentityKind;
};

export type SessionRelation = 'subagent' | 'teammate' | 'fork';

/**
 * Who or what started the session.
 *
 * `human` is deliberately weaker than `machine`: a harness reports the
 * *surface* a session came in on, not who typed. A surface like Claude Code's
 * `cli` means "a surface capable of interaction", and a scripted `claude -p`
 * in CI collapses onto that same value — so `human` is at best `medium`
 * confidence while an SDK surface can be `high`. That asymmetry is real and
 * lives in the model rather than being flattened away.
 */
export type InitiatorKind = 'human' | 'machine' | 'unknown';

export type Initiator = {
  kind: InitiatorKind;
  /**
   * The harness's own raw surface value, passed through unmapped (e.g.
   * 'cli', 'sdk-py'). Adapters must not invent a taxonomy here: the enums
   * are open sets and new values must survive as `kind: 'unknown'`.
   * `'unknown'` only when the harness reported no surface at all.
   */
  surface: string;
  /** Optional refinement of *how* a machine started it: 'sdk' | 'ci' | 'subagent-dispatch' | ... */
  automation?: string;
};

export type SessionSummary = {
  /** `${harness}:${sourceId}`; stable across rescans. */
  id: string;
  harness: HarnessId;
  harnessVersion?: { first: string; last: string };
  /** Absent on roots. */
  parentId?: string;
  relation?: SessionRelation;
  /** 0 for roots. */
  depth: number;
  /** The parent's tool-call id that spawned this session (ADR 0001); plain id passthrough, not content-derived. */
  viaCallId?: string;
  /** e.g. "Explore", "forge-adversary" - a name, not a prompt. */
  agentType?: string;
  /** Human- vs machine-started, with the harness surface it was derived from. */
  initiator?: Metric<Initiator>;
  /** D7: the one content-derived field. */
  title?: { value: string; contentDerived: true };
  project: ProjectRef;
  cwd: { first: string; all: string[] };
  git?: { branch?: string; commit?: string; repoName?: string };
  timing: { startedAt?: Metric<string>; endedAt?: Metric<string>; durationMs?: Metric };
  model: { primary?: Metric<string>; all: string[]; changes: number };
  mode?: { primary?: Metric<string>; all: string[]; changes: number };
  effort?: Metric<string>;
  flags: { resumed?: boolean; forkedFrom?: string; versionChanged?: boolean };
  /** Exclusive (this session alone, not descendants). */
  usage: Usage;
  /** Exclusive; `subagents` is always absent here (rollup-only, see SessionRollup). */
  counts: Counts;
  /** Harness-reported only (D6). */
  cost?: Metric<{ usd: number }>;
  /** Ids of direct children. */
  children: string[];
  source: { path: string; sizeBytes: number; mtimeMs: number };
  diagnostics: Diagnostic[];
};
