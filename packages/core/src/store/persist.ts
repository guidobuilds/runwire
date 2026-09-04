import type { Database } from 'bun:sqlite';
import { sep } from 'node:path';
import type { ScoutFs } from '../adapter/types';
import type { Known } from '../contract/adapter';
import { makeDiagnostic } from '../contract/diagnostic';
import type { Project, Session, SessionBundle, Step, ToolCategory } from '../contract/types';

/** Minimal shape persist.ts needs from a HarnessAdapter, to avoid a store -> contract/adapter -> ... cycle. */
export type HarnessMeta = {
  id: string;
  displayName: string;
  adapterVersion: string;
  capabilities: readonly string[];
};

export function upsertHarness(db: Database, adapter: HarnessMeta): void {
  db.run(
    `INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       adapter_version = excluded.adapter_version,
       capabilities = excluded.capabilities`,
    [adapter.id, adapter.displayName, adapter.adapterVersion, JSON.stringify(adapter.capabilities)],
  );
}

export function upsertProject(db: Database, project: Project): void {
  db.run(
    `INSERT INTO projects (key, name, repo_root, worktree, identity) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       repo_root = excluded.repo_root,
       worktree = excluded.worktree,
       identity = excluded.identity`,
    [
      project.key,
      project.name,
      project.repoRoot ?? null,
      project.worktree ?? null,
      project.identity,
    ],
  );
}

function upsertSessionRow(db: Database, s: Session): void {
  db.run(
    `INSERT INTO sessions (
       id, harness_id, project_key, parent_id, relation, depth, agent_type, spawn_call_id,
       title, cwd, git_branch, git_commit, started_at, ended_at, duration_ms,
       model_primary, model_changes, mode_primary, mode_changes, effort,
       uncached_input, cached_input, cache_write, output, reasoning_output,
       turns, api_calls, tool_calls, compactions, cost_usd,
       initiator_kind, initiator_surface, initiator_automation, resumed, forked_from,
       harness_version_first, harness_version_last, source_path, source_size, source_mtime
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       harness_id = excluded.harness_id, project_key = excluded.project_key, parent_id = excluded.parent_id,
       relation = excluded.relation, depth = excluded.depth, agent_type = excluded.agent_type,
       spawn_call_id = excluded.spawn_call_id, title = excluded.title, cwd = excluded.cwd,
       git_branch = excluded.git_branch, git_commit = excluded.git_commit, started_at = excluded.started_at,
       ended_at = excluded.ended_at, duration_ms = excluded.duration_ms, model_primary = excluded.model_primary,
       model_changes = excluded.model_changes, mode_primary = excluded.mode_primary,
       mode_changes = excluded.mode_changes, effort = excluded.effort, uncached_input = excluded.uncached_input,
       cached_input = excluded.cached_input, cache_write = excluded.cache_write, output = excluded.output,
       reasoning_output = excluded.reasoning_output, turns = excluded.turns, api_calls = excluded.api_calls,
       tool_calls = excluded.tool_calls, compactions = excluded.compactions, cost_usd = excluded.cost_usd,
       initiator_kind = excluded.initiator_kind, initiator_surface = excluded.initiator_surface,
       initiator_automation = excluded.initiator_automation, resumed = excluded.resumed,
       forked_from = excluded.forked_from, harness_version_first = excluded.harness_version_first,
       harness_version_last = excluded.harness_version_last, source_path = excluded.source_path,
       source_size = excluded.source_size, source_mtime = excluded.source_mtime`,
    [
      s.id,
      s.harnessId,
      s.projectKey,
      s.parentId ?? null,
      s.relation ?? null,
      s.depth,
      s.agentType ?? null,
      s.spawnCallId ?? null,
      s.title ?? null,
      s.cwd ?? null,
      s.gitBranch ?? null,
      s.gitCommit ?? null,
      s.startedAt ?? null,
      s.endedAt ?? null,
      s.durationMs ?? null,
      s.modelPrimary ?? null,
      s.modelChanges ?? null,
      s.modePrimary ?? null,
      s.modeChanges ?? null,
      s.effort ?? null,
      s.uncachedInput ?? null,
      s.cachedInput ?? null,
      s.cacheWrite ?? null,
      s.output ?? null,
      s.reasoningOutput ?? null,
      s.turns ?? null,
      s.apiCalls ?? null,
      s.toolCalls ?? null,
      s.compactions ?? null,
      s.costUsd ?? null,
      s.initiatorKind ?? null,
      s.initiatorSurface ?? null,
      s.initiatorAutomation ?? null,
      s.resumed === undefined ? null : s.resumed ? 1 : 0,
      s.forkedFrom ?? null,
      s.harnessVersionFirst ?? null,
      s.harnessVersionLast ?? null,
      s.sourcePath,
      s.sourceSize,
      s.sourceMtime,
    ],
  );
}

function replaceSteps(db: Database, sessionId: string, steps: Step[]): void {
  db.run('DELETE FROM steps WHERE session_id = ?', [sessionId]);
  for (const step of steps) {
    db.run(
      `INSERT INTO steps (
         session_id, seq, at, kind, model, tool_category, tool_name, call_id, child_id,
         duration_ms, error, uncached_input, cached_input, cache_write, output, reasoning_output,
         compaction_trigger, pre_tokens, post_tokens, from_value, to_value
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        step.seq,
        step.at ?? null,
        step.kind,
        step.model ?? null,
        step.toolCategory ?? null,
        step.toolName ?? null,
        step.callId ?? null,
        step.childId ?? null,
        step.durationMs ?? null,
        step.error === undefined ? null : step.error ? 1 : 0,
        step.uncachedInput ?? null,
        step.cachedInput ?? null,
        step.cacheWrite ?? null,
        step.output ?? null,
        step.reasoningOutput ?? null,
        step.compactionTrigger ?? null,
        step.preTokens ?? null,
        step.postTokens ?? null,
        step.fromValue ?? null,
        step.toValue ?? null,
      ],
    );
  }
}

/** Derived from the bundle's `tool` steps at persist time (plan P6) - never a bundle field. */
function replaceToolCounts(db: Database, sessionId: string, steps: Step[]): void {
  db.run('DELETE FROM session_tool_counts WHERE session_id = ?', [sessionId]);
  const counts = new Map<ToolCategory, number>();
  for (const step of steps) {
    if (step.kind !== 'tool' || step.toolCategory === undefined) continue;
    counts.set(step.toolCategory, (counts.get(step.toolCategory) ?? 0) + 1);
  }
  for (const [category, count] of counts) {
    db.run('INSERT INTO session_tool_counts (session_id, category, count) VALUES (?, ?, ?)', [
      sessionId,
      category,
      count,
    ]);
  }
}

function replaceDiagnostics(
  db: Database,
  sessionId: string,
  diagnostics: { level: string; code: string; message: string; line?: number; count?: number }[],
): void {
  db.run('DELETE FROM diagnostics WHERE session_id = ?', [sessionId]);
  for (const d of diagnostics) {
    db.run(
      'INSERT INTO diagnostics (session_id, level, code, message, line, count) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, d.level, d.code, d.message, d.line ?? null, d.count ?? null],
    );
  }
}

/**
 * One transaction per bundle (ARCHITECTURE §6): upsert project; delete any
 * stale row that used to live at this source_path under a different id
 * (two unique keys on `sessions`: `id` PK and `source_path UNIQUE`); upsert
 * the session by id; replace its steps, derived session_tool_counts and
 * diagnostics.
 */
export function persistBundle(db: Database, bundle: SessionBundle): void {
  const run = db.transaction((b: SessionBundle) => {
    upsertProject(db, b.project);
    db.run('DELETE FROM sessions WHERE source_path = ? AND id <> ?', [
      b.session.sourcePath,
      b.session.id,
    ]);
    upsertSessionRow(db, b.session);
    replaceSteps(db, b.session.id, b.steps);
    replaceToolCounts(db, b.session.id, b.steps);
    replaceDiagnostics(db, b.session.id, b.diagnostics);
  });
  run(bundle);
}

/**
 * Validation failure -> a stub session row (project_key NULL, depth 0,
 * source_size/source_mtime NULL) plus an error diagnostic `bundle-invalid`,
 * never cached as if it were a good import (plan P5). Returns false and
 * writes nothing when `raw.session.id`/`raw.session.sourcePath` are not
 * usable strings.
 */
export function persistInvalidBundle(
  db: Database,
  harnessId: string,
  raw: unknown,
  issues: string[],
): boolean {
  const session = isRecord(raw) && isRecord(raw.session) ? raw.session : undefined;
  const id = session && typeof session.id === 'string' ? session.id : undefined;
  const sourcePath =
    session && typeof session.sourcePath === 'string' ? session.sourcePath : undefined;
  if (id === undefined || sourcePath === undefined) return false;

  const message = issues[0] ?? 'invalid bundle';
  const diagnostic = makeDiagnostic('error', 'bundle-invalid', message.slice(0, 200));

  const run = db.transaction(() => {
    db.run('DELETE FROM sessions WHERE source_path = ? AND id <> ?', [sourcePath, id]);
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES (?, ?, NULL, 0, ?, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET
         harness_id = excluded.harness_id, project_key = NULL, depth = 0,
         source_path = excluded.source_path, source_size = NULL, source_mtime = NULL`,
      [id, harnessId, sourcePath],
    );
    replaceDiagnostics(db, id, [diagnostic]);
    db.run('DELETE FROM steps WHERE session_id = ?', [id]);
    db.run('DELETE FROM session_tool_counts WHERE session_id = ?', [id]);
  });
  run();
  return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Root-scoped (plan P4): only rows whose source_path equals one of `roots`
 * or starts with `root + path.sep`. NULL size/mtime (a stub from
 * persistInvalidBundle) maps to `{ size: -1, mtime: -1 }`, which no real
 * stat can match, so the source is re-parsed every import until it
 * validates (plan P5).
 */
export function loadKnown(db: Database, harnessId: string, roots: string[]): Known {
  const known: Known = new Map();
  const rows = db
    .query('SELECT source_path, source_size, source_mtime FROM sessions WHERE harness_id = ?')
    .all(harnessId) as {
    source_path: string;
    source_size: number | null;
    source_mtime: number | null;
  }[];
  for (const row of rows) {
    const inScope = roots.some(
      (root) => row.source_path === root || row.source_path.startsWith(root + sep),
    );
    if (!inScope) continue;
    known.set(row.source_path, {
      size: row.source_size ?? -1,
      mtime: row.source_mtime ?? -1,
    });
  }
  return known;
}

/**
 * Deletes sessions whose path is in `known`, was not re-emitted this run,
 * and no longer stats (plan P4). Cascades to steps/session_tool_counts/
 * diagnostics/rollups via the FKs in store/schema.ts.
 */
export async function removeVanished(
  db: Database,
  harnessId: string,
  known: Known,
  emitted: Set<string>,
  fs: ScoutFs,
): Promise<number> {
  let removed = 0;
  for (const path of known.keys()) {
    if (emitted.has(path)) continue;
    const stat = await fs.stat(path);
    if (stat !== undefined) continue;
    db.run('DELETE FROM sessions WHERE harness_id = ? AND source_path = ?', [harnessId, path]);
    removed++;
  }
  return removed;
}
