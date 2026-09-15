# Architecture

The contract between `core` and the harness adapters. Decisions are `D<n>` in [DECISIONS.md](DECISIONS.md). Related: [PRODUCT.md](PRODUCT.md), [adapters/README.md](adapters/README.md), [adapters/claude-code.md](adapters/claude-code.md), [harness-survey.md](harness-survey.md).

## 1. Overview

Runwire reads harness session files from disk, read-only. Each adapter discovers its harness's sessions and returns one fully computed record per session. Core validates, persists to SQLite, links parents to children, and computes rollups and aggregates. Core never reads or interprets harness data.

```text
harness files on disk ──▶ adapter ──────────────▶ SessionBundle stream ──▶ core
~/.claude/projects/**     discover(ctx, known)     { project, session,        persist (SQLite)
                          computes everything       steps[], diagnostics[] }  link parent/child
                                                    one session at a time     rollups, aggregates
```

- The adapter owns all harness knowledge (D68). If core needs something the adapter does not deliver, the adapter changes.
- No shared metric math in core. The contract defines meaning; the test kit (§8) enforces it.
- Nothing leaves an adapter that is not on its allowlist (§7).

## 2. Packages and boundaries

```text
packages/core/                 types, SQLite store, import orchestrator, contract test kit, RunwireFs
packages/adapter-claude-code/  Claude Code adapter
packages/cli/                  composition root (D76): adapter registry + the `runwire` command
fixtures/<harness>/            redacted sessions: versions, subagents, canary, malformed
```

| Package | May import |
|---|---|
| `core` | nothing from the repo |
| `adapter-*` | `@runwire/core` only (never another adapter) |
| `cli` | `@runwire/core` and `@runwire/adapter-*` — the only package that knows which adapters exist |

Enforced by `.dependency-cruiser.cjs` inside `bun run lint`.

## 3. Contract

TS names are camelCase; the SQL columns in §5 are the same names in snake_case.

```ts
interface HarnessAdapter {
  id: string;                          // 'claude-code' | 'opencode'
  displayName: string;
  adapterVersion: string;              // bump when a mapping changes
  capabilities: readonly Capability[];
  allowlist: Projection;               // §7
  probe(ctx: AdapterContext): Promise<{ installed: boolean; roots: string[]; notes: string[] }>;
  discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle>;
  // Optional explicit existence check. When undefined, CORE falls back to
  // fs.stat(sourceLocator ?? sourceId) — the filesystem heuristic the Claude
  // adapter relies on. A DB-backed adapter returns true (retain) on any
  // DB open/read/stat error and only false (delete) on a CONFIRMED absent
  // source, so a transient error never mass-deletes.
  sourceExists?(ctx: AdapterContext, source: SourceRef): Promise<boolean>;
}

type SourceRef = { sourceId: string; sourceLocator?: string };
// The effective source id (sourceId ?? sourcePath) → what core already stored.
type Known = Map<string, { size: number; mtime: number }>;

type AdapterContext = {
  home: string; platform: NodeJS.Platform; env: Record<string, string | undefined>;
  fs: RunwireFs;                         // read-only: stat, readdir, readFile, openStream, openSqliteReadonly; core exports readLines(stream) over openStream
  privacy: { titles: boolean };
  log: Logger;
};

type Capability =
  | 'usage.perCall' | 'usage.cumulative' | 'usage.cacheWrite' | 'usage.reasoning'
  | 'timing' | 'model' | 'mode' | 'effort' | 'version' | 'turns' | 'toolCalls' | 'compactions'
  | 'subagents' | 'cost' | 'title' | 'git' | 'initiator'
  | 'steps.errors' | 'steps.harness' | 'steps.toolDurations';

type SessionBundle = { project: Project; session: Session; steps: Step[]; diagnostics: Diagnostic[] };

type Project = {
  key: string;                         // normalized remote → repo root → cwd (D8, D9)
  name: string;                        // repo name or last path segment
  repoRoot?: string; worktree?: string;
  identity: 'remote' | 'repo-root' | 'cwd';
};

type Session = {
  id: string;                          // `${harness}:${sourceId}`, stable across imports
  harnessId: string; projectKey: string;
  parentId?: string; relation?: 'subagent' | 'teammate' | 'fork'; depth: number; agentType?: string;
  spawnCallId?: string;                // the parent's tool call_id that spawned this child; core fills steps.child_id from it
  title?: string;                      // only when ctx.privacy.titles (D7)
  cwd?: string; gitBranch?: string; gitCommit?: string;
  startedAt?: string; endedAt?: string; durationMs?: number;                  // ISO-8601 UTC
  modelPrimary?: string; modelChanges?: number;
  modePrimary?: string; modeChanges?: number; effort?: string;
  uncachedInput?: number; cachedInput?: number; cacheWrite?: number; output?: number; reasoningOutput?: number;
  turns?: number; apiCalls?: number; toolCalls?: number; compactions?: number;
  costUsd?: number;                    // harness-reported only, never computed
  initiatorKind?: 'human' | 'machine' | 'unknown'; initiatorSurface?: string; initiatorAutomation?: string;
  resumed?: boolean; forkedFrom?: string;
  harnessVersionFirst?: string; harnessVersionLast?: string;
  sourceId?: string;                   // opaque namespaced identity (defaults in CORE to sourcePath)
  sourceLocator?: string;              // optional physical locator (defaults in CORE to sourcePath)
  sourcePath: string; sourceSize: number; sourceMtime: number;
};

// effectiveSourceId(session)     = session.sourceId ?? session.sourcePath
// effectiveSourceLocator(session) = session.sourceLocator ?? session.sourcePath
// For a filesystem source (Claude) both reduce to sourcePath → today's behavior
// preserved exactly. For a DB-backed source (OpenCode) sourceId is explicit and
// sourceLocator is the DB file path.

type StepKind = 'call' | 'tool' | 'turn' | 'harness' | 'compaction' | 'model-change' | 'mode-change';
type ToolCategory = 'read' | 'write' | 'exec' | 'search' | 'plan' | 'agent' | 'web' | 'mcp' | 'skill' | 'other';

type Step = {
  sessionId: string; seq: number; at?: string; kind: StepKind;
  model?: string;                                                              // call
  toolCategory?: ToolCategory; toolName?: string; callId?: string;             // tool; harness uses toolName = event name
  skillName?: string;                                                          // tool (skill) — metadata only, never the rest of input (D7)
  childId?: string;                                                            // tool (agent) — filled by core, §6
  durationMs?: number; error?: boolean;                                        // tool, turn
  uncachedInput?: number; cachedInput?: number; cacheWrite?: number; output?: number; reasoningOutput?: number;  // call
  compactionTrigger?: string; preTokens?: number; postTokens?: number;         // compaction
  fromValue?: string; toValue?: string;                                        // model-change, mode-change
};

type Diagnostic = { level: 'info' | 'warn' | 'error'; code: string; message: string; line?: number; count?: number };
```

## 4. What an adapter computes

| Field | Definition |
|---|---|
| dedup | One usage per API request (e.g. Claude Code `requestId`). Duplicates count once everywhere. |
| `uncached_input` … `reasoning_output` | Σ over deduped API requests, canonical names per D5. |
| `api_calls` | Number of deduped API requests. |
| `model_primary`, `model_changes` | Model with the most `output` tokens; transitions in source order. |
| `mode_primary`, `mode_changes` | Most frequent mode; transitions in source order. |
| `turns` | Human prompts. |
| `tool_calls`, `compactions` | Number of `tool` / `compaction` steps. |
| `started_at`, `ended_at`, `duration_ms` | First and last timestamp in the source; `duration_ms = ended − started`. |
| `harness_version_first/last` | First and last version seen. |
| `initiator_*` | Per D47/D48. |
| `title` | Only if `ctx.privacy.titles`. |
| `steps` | Source order, `seq` from 0. `call` carries its own usage; `tool` carries `call_id`, `error`, `duration_ms` from the paired result. |
| `skill_name` | Tool steps of category `skill` carry the skill name (`message.content[].input.skill`); metadata only, never the rest of the tool_use `input` (D7). |
| `session_tool_counts` | `tool` steps tallied per `tool_category`. |
| `parent_id`, `relation`, `agent_type`, `depth` | From the harness's own linkage (e.g. subagent directory, `.meta`). |
| project | Per D8/D9: normalized remote → repo root → cwd, via `ctx.fs` only. |
| `cost_usd` | Harness-reported only. |
| diagnostics | Fixed code + message, never content. A malformed record yields a diagnostic, not an exception. |

Invariant: per token field, Σ over `call` steps = the session's value.

## 5. SQLite schema

```sql
harnesses(id PK, display_name, adapter_version, capabilities)
projects(key PK, name, repo_root, worktree, identity)
models(id PK, name NOT NULL UNIQUE)            -- canonical model identity; name = exact raw harness string
sessions(id PK, harness_id → harnesses, project_key → projects, parent_id → sessions, relation, depth, agent_type, spawn_call_id,
         title, cwd, git_branch, git_commit, started_at, ended_at, duration_ms,
         model_primary_id → models, model_changes, mode_primary, mode_changes, effort,
         uncached_input, cached_input, cache_write, output, reasoning_output,
         turns, api_calls, tool_calls, compactions, cost_usd,
         initiator_kind, initiator_surface, initiator_automation, resumed, forked_from,
         harness_version_first, harness_version_last,
         source_id UNIQUE, source_locator,          -- effective source identity + physical locator (see §3); backfilled from source_path
         source_path UNIQUE, source_size, source_mtime)
steps(session_id → sessions, seq, at, kind, model_id → models, tool_category, tool_name, skill_name, call_id, child_id, duration_ms, error,
      uncached_input, cached_input, cache_write, output, reasoning_output,
      compaction_trigger, pre_tokens, post_tokens, from_value, to_value, PK (session_id, seq))
session_tool_counts(session_id → sessions, category, count, PK (session_id, category))
diagnostics(session_id → sessions, level, code, message, line, count)
rollups(session_id PK → sessions, uncached_input, cached_input, cache_write, output, reasoning_output,
        api_calls, tool_calls, compactions, descendants)          -- inclusive totals, recomputed by core after each import
```

| `steps.kind` | Columns used |
|---|---|
| `call` | `model_id`, `uncached_input` … `reasoning_output` |
| `tool` | `model_id`, `tool_category`, `tool_name`, `skill_name`, `call_id`, `child_id`, `duration_ms`, `error` |
| `turn` | `duration_ms` |
| `harness` | `tool_name` (event name, e.g. `hook:PreToolUse`) |
| `compaction` | `compaction_trigger`, `pre_tokens`, `post_tokens` |
| `model-change`, `mode-change` | `from_value`, `to_value` |

- Typed nullable columns, no JSON blobs: waste-pattern queries (D51) are plain SQL.
- `sessions` holds exclusive values only. Derivable data (`model.all`, `children[]`, `cwd.all`) is not stored.
- Model identity is normalized: `models.name` is the exact raw harness model string (the canonical key; reserved names such as `unknown`/`other` are stored as-is), and `steps.model_id` / `sessions.model_primary_id` are hard FKs to `models(id)`. The legacy text columns (`steps.model`, `sessions.model_primary`) no longer exist; a NULL model stays a NULL id.
- NULL is the empty state (D72).

## 6. Import flow

```text
importAll({ adapters, db, ctx }) — adapters come from the composition root (D76), never from core
for each adapter:
  known  = SELECT COALESCE(source_id, source_path), COALESCE(source_locator, source_path),
                  source_size, source_mtime FROM sessions WHERE harness_id = adapter.id
           -- keyed by the EFFECTIVE source id (sourceId ?? sourcePath); root-scoped by the PHYSICAL locator
  for await bundle of adapter.discover(ctx, known):
    validate → upsert project, models, session, steps, session_tool_counts, diagnostics   (one transaction per bundle)
    emitted.add(effectiveSourceId(bundle.session))
  remove    known-but-unemitted sources that no longer exist, with their steps/counts/diagnostics.
            The existence test is adapter-answered: adapter.sourceExists(ctx, {sourceId, sourceLocator})
            when present, else fs.stat(sourceLocator ?? sourceId) (the Claude filesystem heuristic).
            Removal is only computed after the discover stream completes without throwing — a mid-stream
            discover() throw keeps what was persisted and skips removal. A DB-backed sourceExists returns
            true (retain) on any DB open/read/stat error and false (delete) only on a CONFIRMED absent source,
            so a transient error or an unreadable store never mass-deletes.
  link      parent_id from bundles; for a flattened depth-2+ child, recover its immediate parent when exactly one
            agent step at depth N-1 in the same tree owns its spawn_call_id; steps.child_id = the child whose spawn_call_id equals that step's call_id
            depth as declared by the adapter; unresolved parent → diagnostic `orphan-child`, child kept as a root
  rollups   exclusive = the row; inclusive = row + all descendants (turns copied from the root, not summed)
  aggregates per project and per harness, from root sessions
```

Rollups are a table (`rollups`, §5) recomputed by core after each import: inclusive = own row + all descendants for the token fields, `api_calls`, `tool_calls`, `compactions`; `descendants` is a count; `turns` is not rolled up (read it from the root row). Aggregates are SQL views (`project_aggregates`, `harness_aggregates`) over root sessions joined with `rollups`. `importAll` returns an `ImportReport { perAdapter: { discovered, imported, skipped, removed, failed }, durationMs }`.

Foreign-key policy: `sessions.model_primary_id` and `steps.model_id` are hard FKs to `models(id)`, so every distinct raw model string is upserted into `models` by `name` inside the same persist transaction, before the session/step rows, and can never be missing at insert. `sessions.parent_id` and `steps.child_id` stay plain indexed columns with no foreign key: bundles stream in arbitrary order, so a child may be persisted before its parent and a self-referencing FK would reject a valid import. Migrating an existing store to this shape is a guarded one-transaction rebuild: it rebuilds `steps`/`sessions` only when they still carry the text columns (or lack the id columns), runs with `PRAGMA foreign_keys = OFF` (a no-op inside a transaction, so it is toggled outside and restored after), copies every row verbatim (text model resolved to `models.id`, NULL preserved), recreates the dropped indexes, and finally throws if `PRAGMA foreign_key_check` reports any violation rather than silently corrupting the store.

## 7. Privacy

| Mechanism | Rule |
|---|---|
| Allowlist as data | `allowlist: Projection` names the only keys kept from a raw record; applied before Zod validation. |
| Canary fixture | `fixtures/<harness>/canary/`: every content field = `RUNWIRE_CANARY_<n>`. The sentinel must appear in no bundle field. |
| Diagnostics | Fixed code + message (≤ 200 chars, no newlines); never record content. |
| Titles | Written only when `ctx.privacy.titles` at import; otherwise never on disk (D7, D71). |
| Skill name | Metadata only; only `message.content[].input.skill` is read — the rest of a tool_use `input` is never read. |
| Paths | `source_path` and `cwd` are metadata. |

## 8. Contract test kit

`@runwire/core/test-kit`. Every adapter must pass, on its fixtures:

| Check | Fails when |
|---|---|
| schema | a bundle does not validate against core's schema |
| canary | the sentinel appears in any bundle field |
| malformed | the malformed fixture throws instead of yielding diagnostics |
| stable ids | two runs give different `session.id`s, or `known` with matching size/mtime does not skip the source |
| totals | Σ `call` step tokens ≠ session tokens for any field |
| steps | `seq` is not contiguous from 0 in source order |
| capabilities | a capability is declared but never observed, or a field is emitted without its capability |

## 9. Commands

| Command | Does |
|---|---|
| `bun install` | install |
| `bun run test` | `bun test` in every package — never bare `bun test` at the root |
| `bun run typecheck` | `tsc --noEmit` per package |
| `bun run lint` | Biome + dependency-cruiser boundaries |
| `bun run runwire import [--adapter <id>] [--home <dir>] [--db <path>] [--no-titles] [--force]` | Imports every registered adapter (or just `--adapter`) into `~/.runwire/runwire.db` (`--db` overrides, `--db :memory:` allowed); `--force` bypasses the size/mtime cache and recomputes every source; prints the `ImportReport` to stderr; exits 1 if any adapter errored or a bundle failed validation, else 0. |
| `bun run runwire discover --adapter <id> [--home <dir>] [--json]` | Streams the named adapter's bundles read-only, without touching the store; `--json` writes one `SessionBundle` per line (NDJSON) to stdout and nothing else, so the output can be piped straight into a file or `jq`. |

## 10. Open items

- Second harness (Codex) and the contract changes it forces.

Closed in the 2026-09-04 build plan (`.forge/core-adapter-reset/plan.md`): rollups are a table (§6); the DB lives at `~/.runwire/runwire.db` (`runwire import --db <path>`, `:memory:` allowed); sessions whose source file disappeared are deleted on the next import (§6).
