import type { Database } from 'bun:sqlite';
import { isAbsolute, relative } from 'node:path';
import type { AdapterContext, ScoutFs } from '../adapter/types';
import type { Known } from '../contract/adapter';
import { makeDiagnostic } from '../contract/diagnostic';
import type {
  Project,
  Session,
  SessionBundle,
  SourceRef,
  Step,
  ToolCategory,
} from '../contract/types';

/**
 * The identity CORE actually uses (design §2.1): `sourceId ?? sourcePath`.
 * For a filesystem source (Claude) both reduce to `sourcePath`, preserving
 * today's behavior exactly; for a DB-backed source (OpenCode) `sourceId` is
 * explicit and `sourcePath` mirrors it.
 */
export function effectiveSourceId(s: { sourceId?: string; sourcePath: string }): string {
  return s.sourceId ?? s.sourcePath;
}

/** The physical locator CORE uses for existence checks: `sourceLocator ?? sourcePath`. */
export function effectiveSourceLocator(s: { sourceLocator?: string; sourcePath: string }): string {
  return s.sourceLocator ?? s.sourcePath;
}

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

/**
 * Upserts every distinct raw model string the bundle mentions (union of
 * `steps[].model` and `session.modelPrimary`) into `models` by its UNIQUE
 * `name` (idempotent, `upsertHarness` style), then resolves name -> id in one
 * SELECT. Runs inside persistBundle's transaction before the session/step
 * writes so the hard FKs (`sessions.model_primary_id`, `steps.model_id`) can
 * never observe a missing `models` row. The contract stays raw-string
 * (`Session.modelPrimary` / `Step.model`); which model is "primary" is chosen
 * by the adapter and persist only stores what it is given.
 */
function upsertModels(db: Database, b: SessionBundle): Map<string, number> {
  const names = new Set<string>();
  if (b.session.modelPrimary !== undefined) names.add(b.session.modelPrimary);
  for (const step of b.steps) {
    if (step.model !== undefined) names.add(step.model);
  }
  if (names.size === 0) return new Map();

  for (const name of names) {
    db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
  }

  const placeholders = [...names].map(() => '?').join(', ');
  const rows = db
    .query(`SELECT id, name FROM models WHERE name IN (${placeholders})`)
    .all(...names) as { id: number; name: string }[];
  const ids = new Map<string, number>();
  for (const row of rows) ids.set(row.name, row.id);
  return ids;
}

function upsertSessionRow(db: Database, s: Session, modelIds: Map<string, number>): void {
  db.run(
    `INSERT INTO sessions (
       id, harness_id, project_key, parent_id, relation, depth, agent_type, spawn_call_id,
       title, cwd, git_branch, git_commit, started_at, ended_at, duration_ms,
       model_primary_id, model_changes, mode_primary, mode_changes, effort,
       uncached_input, cached_input, cache_write, output, reasoning_output,
       turns, api_calls, tool_calls, compactions, cost_usd,
       initiator_kind, initiator_surface, initiator_automation, resumed, forked_from,
       harness_version_first, harness_version_last, source_id, source_locator,
       source_path, source_size, source_mtime
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       harness_id = excluded.harness_id, project_key = excluded.project_key, parent_id = excluded.parent_id,
       relation = excluded.relation, depth = excluded.depth, agent_type = excluded.agent_type,
       spawn_call_id = excluded.spawn_call_id, title = excluded.title, cwd = excluded.cwd,
       git_branch = excluded.git_branch, git_commit = excluded.git_commit, started_at = excluded.started_at,
       ended_at = excluded.ended_at, duration_ms = excluded.duration_ms, model_primary_id = excluded.model_primary_id,
       model_changes = excluded.model_changes, mode_primary = excluded.mode_primary,
       mode_changes = excluded.mode_changes, effort = excluded.effort, uncached_input = excluded.uncached_input,
       cached_input = excluded.cached_input, cache_write = excluded.cache_write, output = excluded.output,
       reasoning_output = excluded.reasoning_output, turns = excluded.turns, api_calls = excluded.api_calls,
       tool_calls = excluded.tool_calls, compactions = excluded.compactions, cost_usd = excluded.cost_usd,
       initiator_kind = excluded.initiator_kind, initiator_surface = excluded.initiator_surface,
       initiator_automation = excluded.initiator_automation, resumed = excluded.resumed,
       forked_from = excluded.forked_from, harness_version_first = excluded.harness_version_first,
       harness_version_last = excluded.harness_version_last, source_id = excluded.source_id,
       source_locator = excluded.source_locator, source_path = excluded.source_path,
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
      s.modelPrimary === undefined ? null : (modelIds.get(s.modelPrimary) ?? null),
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
      s.sourceId ?? null,
      s.sourceLocator ?? null,
      s.sourcePath,
      s.sourceSize,
      s.sourceMtime,
    ],
  );
}

function replaceSteps(
  db: Database,
  sessionId: string,
  steps: Step[],
  modelIds: Map<string, number>,
): void {
  db.run('DELETE FROM steps WHERE session_id = ?', [sessionId]);
  for (const step of steps) {
    db.run(
      `INSERT INTO steps (
         session_id, seq, at, kind, model_id, tool_category, tool_name, skill_name, call_id, child_id,
         duration_ms, error, uncached_input, cached_input, cache_write, output, reasoning_output,
         compaction_trigger, pre_tokens, post_tokens, from_value, to_value
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        step.seq,
        step.at ?? null,
        step.kind,
        step.model === undefined ? null : (modelIds.get(step.model) ?? null),
        step.toolCategory ?? null,
        step.toolName ?? null,
        step.skillName ?? null,
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
    // Displace by the EFFECTIVE source id (COALESCE(source_id, source_path)) so a
    // re-emitted source that changes its id still removes the stale row, whether
    // or not source_id is set (design §2.4).
    db.run('DELETE FROM sessions WHERE COALESCE(source_id, source_path) = ? AND id <> ?', [
      effectiveSourceId(b.session),
      b.session.id,
    ]);
    const modelIds = upsertModels(db, b);
    upsertSessionRow(db, b.session, modelIds);
    replaceSteps(db, b.session.id, b.steps, modelIds);
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
  const sourceId = session && typeof session.sourceId === 'string' ? session.sourceId : undefined;
  const sourceLocator =
    session && typeof session.sourceLocator === 'string' ? session.sourceLocator : undefined;

  const message = issues[0] ?? 'invalid bundle';
  const diagnostic = makeDiagnostic('error', 'bundle-invalid', message.slice(0, 200));

  const run = db.transaction(() => {
    // Displace by the EFFECTIVE source id so a stale row at the same identity is
    // removed even when the invalid bundle carries a different id.
    db.run('DELETE FROM sessions WHERE COALESCE(source_id, source_path) = ? AND id <> ?', [
      sourceId ?? sourcePath,
      id,
    ]);
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_id, source_locator, source_path, source_size, source_mtime)
       VALUES (?, ?, NULL, 0, ?, ?, ?, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET
         harness_id = excluded.harness_id, project_key = NULL, depth = 0,
         source_id = excluded.source_id, source_locator = excluded.source_locator,
         source_path = excluded.source_path, source_size = NULL, source_mtime = NULL`,
      [id, harnessId, sourceId ?? null, sourceLocator ?? null, sourcePath],
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
 * True iff `target` is `root` itself or a path nested under it, checked via
 * `path.relative` rather than a literal `root + path.sep` prefix: source
 * paths and roots may come from a virtual/redacted filesystem (tests) that
 * always uses `/`, or a real OS path (production) that uses `path.sep` -
 * `relative()` (via node:path's platform module) understands both, so a
 * hardcoded separator character can't be wrong for either source.
 */
function isUnderRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Root-scoped (plan P4): only rows whose source_path equals one of `roots`
 * or is nested under one. NULL size/mtime (a stub from
 * persistInvalidBundle) maps to `{ size: -1, mtime: -1 }`, which no real
 * stat can match, so the source is re-parsed every import until it
 * validates (plan P5).
 */
export function loadKnown(db: Database, harnessId: string, roots: string[]): Known {
  const known: Known = new Map();
  const rows = db
    .query(
      'SELECT source_id, source_locator, source_path, source_size, source_mtime FROM sessions WHERE harness_id = ?',
    )
    .all(harnessId) as {
    source_id: string | null;
    source_locator: string | null;
    source_path: string;
    source_size: number | null;
    source_mtime: number | null;
  }[];
  for (const row of rows) {
    // Keyed by the EFFECTIVE source id (identity); scoped by the PHYSICAL
    // locator (design §2.5) so an opaque id is never fed to isUnderRoot.
    const identity = row.source_id ?? row.source_path;
    const locator = row.source_locator ?? row.source_path;
    const inScope = roots.some((root) => isUnderRoot(root, locator));
    if (!inScope) continue;
    known.set(identity, {
      size: row.source_size ?? -1,
      mtime: row.source_mtime ?? -1,
    });
  }
  return known;
}

/**
 * Deletes sessions whose source id is in `known`, was not re-emitted this run,
 * and no longer exists (design §2.6). Cascades to steps/session_tool_counts/
 * diagnostics/rollups via the FKs in store/schema.ts.
 *
 * The existence test is adapter-answered when `opts.sourceExists` is provided
 * (a DB-backed source with real vanished semantics); otherwise it falls back
 * to `fs.stat(sourceLocator ?? sourceId)`, which is the current filesystem
 * heuristic the Claude adapter relies on. Delete is by
 * `COALESCE(source_id, source_path)` so a NULL-source_id row (invalid stub /
 * raw test insert) is still removable.
 */
export async function removeVanished(
  db: Database,
  harnessId: string,
  known: Known,
  emitted: Set<string>,
  fs: ScoutFs,
  opts?: {
    sourceExists?: (ctx: AdapterContext, source: SourceRef) => Promise<boolean>;
    ctx?: AdapterContext;
  },
): Promise<number> {
  let removed = 0;
  for (const sourceId of known.keys()) {
    if (emitted.has(sourceId)) continue;
    const row = db
      .query(
        'SELECT COALESCE(source_locator, source_path) AS locator FROM sessions WHERE harness_id = ? AND COALESCE(source_id, source_path) = ?',
      )
      .get(harnessId, sourceId) as { locator: string } | null;
    const locator = row?.locator ?? sourceId;
    const exists =
      opts?.sourceExists && opts.ctx
        ? await opts.sourceExists(opts.ctx, { sourceId, sourceLocator: locator })
        : (await fs.stat(locator ?? sourceId)) !== undefined;
    if (exists) continue;
    db.run('DELETE FROM sessions WHERE harness_id = ? AND COALESCE(source_id, source_path) = ?', [
      harnessId,
      sourceId,
    ]);
    removed++;
  }
  return removed;
}
