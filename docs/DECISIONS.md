# Decisions

Numbered `D<n>`; numbers are stable. Only decisions still in force are listed; the rest are summarized in one line at the end.

## In force (design review 2026-08-29/30 unless dated)

| # | Topic | Decision |
|---|---|---|
| 1 | Audience | Dogfood first (author's machine, all harnesses installed), designed for distribution. |
| 4 | Identity under resume/fork | One source file (or DB row) = one session. `resumed` / `forked_from` when the harness exposes them. |
| 5 | Token model | Canonical fields: `uncached_input`, `cached_input`, `cache_write`, `output`, `reasoning_output` (⊂ `output`). Each adapter documents its mapping; OpenAI-style (`cached ⊂ input`) adapters derive `uncached_input = input − cached`. |
| 7 | Titles | Harness-generated titles are the single content-derived exception to metadata-only. A privacy setting disables them. |
| 8 | Git metadata | Branch and commit hash are allowed. Remote URL is a grouping key only; the repo name is what gets displayed. |
| 9 | Project identity | Read-only fs checks outside harness dirs (find `.git`, read the remote URL) to group by repo/worktree. A setting disables it (fallback: cwd = project). |
| 11 | Antigravity | Out of scope. No local trajectory store found. |
| 12 | Windows | In scope. |
| 16 | Repo layout | Bun workspaces: `packages/core`, `packages/adapter-*` (updated 2026-09-04). |
| 17 | Fixtures | Redacted real sessions committed under `fixtures/<harness>/`. |
| 19 | Refresh | Manual rescan only. No file watching. |
| 21 | Schema strictness | Loose Zod schemas (optional fields, passthrough). Version-gated field maps inside one adapter. Unknown record types are counted, not errors. |
| 25 | Harness order | Claude Code → Codex → Grok Build → OpenCode → Pi. |
| 26 | Docs | Under `docs/`. |
| 27 | Name / license | Scout, MIT. |
| 31 | Tool categories | Each adapter maps tool names to `read`, `write`, `exec`, `search`, `plan`, `agent`, `web`, `mcp`, `skill`, `other`. Tool inputs/outputs never leave the adapter. |
| 47 | Initiator signal (2026-09-01) | Classify `human` \| `machine` \| `unknown` per session from Claude Code's record-level `entrypoint` and the presence of an `agent-setting` record (payload never read). `promptSource` is not classified on (`sdk` is ambiguous). |
| 48 | Initiator rule | `unknown` and absent both count as not machine-initiated; a filter may hide only sessions positively known to be machine-started. |
| 51 | Waste-pattern catalog (2026-09-03) | Target signals: (1) repeated automatic compaction; (2) mid-session model switching; (3) expensive model on cheap-category work (needs a relative model-cost notion — open); (4) heavy MCP usage; (5) no skill usage (neutral fact); (6) root never delegates and exhausts its own context. |
| 52 | Judgment principle | A flag reports scale and who/what controlled the outcome (e.g. compaction trigger) next to the number — never a bare threshold. Evidence, not verdict. |

## Tooling

| Topic | Decision | Why |
|---|---|---|
| Lint/format | Biome | One tool, fast, Bun-friendly. |
| Zod | v4 | Current major. |
| TypeScript | Pinned 6.0.3 | TS 7 removed `baseUrl` and `dependency-cruiser@18` lacks TS7 support (the boundary check silently cruised 0 modules). |
| Path aliases | `tsconfig.base.json` `paths` for `@scout/core` (no `baseUrl`) | Bun creates no `node_modules/@scout/*` symlinks; `tsc` and `dependency-cruiser` need the alias. |
| Nested subagent parent | Every Claude Code subagent attaches to the root; `depth` is recorded. Exact parent for depth > 1 is a later refinement. | Needs tool-result linkage; not needed for totals. |

## Reset (2026-09-04)

| # | Topic | Decision |
|---|---|---|
| 66 | Scope reset | Repo = `packages/core` + `packages/adapter-claude-code`. `web` (front) and `api` (backend) are future layers. Everything else deleted 2026-09-03 (`7e66735`). |
| 67 | Purpose | Scout makes the token/time waste of a developer's hand-built agent harness visible. D51/D52 stand. Analysis is global across all sessions (supersedes D53) because SQLite holds everything. |
| 68 | Responsibility inversion | The adapter discovers and returns fully computed per-session records conforming to core's contract; core never interprets raw harness data, and if it needs more, the adapter changes. Each adapter computes its own dedup, primary model, totals and project identity — no shared math library in core; the contract defines meaning, the test kit enforces it (supersedes D20). |
| 69 | Adapter interface | `id`, `displayName`, `adapterVersion`, `capabilities`, `allowlist`, `probe(ctx)`, `discover(ctx, known): AsyncIterable<SessionBundle>` with `known: Map<sourcePath, { size, mtime }>` = what core already stored, so the adapter skips unchanged sources (its call — a subagent is reprocessed with its parent). `SessionBundle = { project, session, steps[], diagnostics[] }`, streamed one at a time; project identity resolved by the adapter per D8/D9. |
| 70 | Core scope | Core = types, SQLite schema/store, import orchestrator (discover → persist → link → rollups → aggregates), contract test kit, read-only fs (`ScoutFs`, line streaming). Dropped: `ScoutEvent`, `reduce()`, `trace()`, in-memory store, scan pipeline — that logic moves into the Claude Code adapter. |
| 71 | SQLite now | `bun:sqlite`, no new deps. Eager full import; incremental via `known`. Titles (D7) are written only if privacy allows at import time — what is not on disk cannot leak. DB location decided in the build plan. |
| 72 | No confidence | Plain nullable columns; `Metric<T>`, `confidence`, `source`, `note` removed; NULL is the empty state. Diagnostics stay as data (code + message per session) and feed nothing. Supersedes D22, D36. |
| 73 | Naming | `SessionSummary` → `Session`; `SessionTrace`/`TraceStep` → `Step`; `SourceRef` folded into `Session` (`source_path`, `source_size`, `source_mtime`); `ScoutEvent` gone. D5 token names stay. `sessions` holds exclusive values only; rollups are core's. |
| 74 | Schema | Tables `harnesses`, `projects`, `sessions`, `steps`, `session_tool_counts`, `diagnostics` — typed nullable columns per step `kind`, no JSON blob, so waste-pattern queries are plain SQL ([ARCHITECTURE.md §5](ARCHITECTURE.md#5-sqlite-schema)). Step kinds: `call`, `tool`, `turn`, `harness`, `compaction`, `model-change`, `mode-change`. Derivable data (`model.all`, `children[]`, `cwd.all`) is not stored. |
| 75 | Docs reset | Obsolete docs deleted; remaining docs rewritten concisely around the new contract. |
| 76 | Composition root | A minimal `packages/cli` (`@scout/cli`) is the only package that imports adapters: it holds the adapter registry (`adapters: HarnessAdapter[]`) and the `scout` command(s), and core's import orchestrator takes `adapters` as a parameter. Boundaries: `cli` may import `core` and `adapter-*`; `core` still imports nothing from the repo; adapters still import only `core`. |
| 77 | `/sessions` query + pagination | `GET /sessions` supports `harness`/`startedAfter`/`model` filters (AND) and offset pagination (`limit` default 50, max 200; `offset` default 0). Unknown, duplicate, or invalid query params ⇒ `400` `{ error: 'invalid query parameter', parameter }`. Returns `{ items, total, limit, offset }` where `total` is the pre-pagination COUNT of the filtered root set; `model` matches the root OR any descendant; `startedAfter` is exclusive (`started_at > value`) and a `NULL` `started_at` never matches; `limit`/`offset` echo the effective values. `GET /sessions/{id}` unchanged. |

## Removed or superseded

D2–D3, D6, D10, D13–D15, D18, D20, D22–D24, D28–D46, D49–D50, D53–D65: removed with the web/server/CLI on 2026-09-03 or superseded by D66–D75; see git history before 7e66735.
