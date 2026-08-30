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
  /** e.g. "Explore", "forge-adversary" - a name, not a prompt. */
  agentType?: string;
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
