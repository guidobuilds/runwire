# Adapter: OpenCode

Status: implements the 2026-09-04 contract (D68–D74), `adapterVersion: '1.1.0'`. Reads both the current and legacy OpenCode SQLite stores **read-only, WAL-aware** (`bun:sqlite` `readonly`; never `immutable=1`, which ignores the WAL and shows an empty database). `discover(ctx, known)` computes every `SessionBundle` field itself (records.ts + compute.ts + project.ts); core only validates, persists, links and rolls up. The package also exposes a **metadata-only, CORE-representable** connector surface (`inventorySessions` / `retrieveSession` / `retrieveSessionParts`) that returns exactly the non-sensitive data the bundle path produces, for one session on demand — it never bypasses the CORE allowlist and never persists into CORE.

## Location and layout

| | Path |
|---|---|
| Data dir | `~/.local/share/opencode/` (Windows: `%USERPROFILE%\.local\share\opencode\`) |
| Current store | `<data_dir>/opencode.db` — `session_v2` + `session_message` |
| Legacy store | `<data_dir>/opencode-tui-v2.db` — V1 `session` + its own `session_message` |
| Project | `project` table (`id`, `worktree`, `vcs`) — `worktree` = repo root |
| Schema detection | `PRAGMA user_version` is 0 for both, so `sqlite_master` table presence decides: `session_v2` → current; `session` (no `session_v2`) → legacy; neither → not-an-OpenCode DB (diagnostic, zero bundles) |

`sourceId = opencode:<origin>:<id>` (`origin ∈ current|legacy`), e.g. `opencode:current:ses_abc`. `sourcePath = sourceId` (keeps `source_path` UNIQUE). `sourceLocator` = the DB file path (many sessions share one). The current and legacy stores are both inventoried; id overlap is 0 on a real machine, so the union is independent sessions.

## Data flow

`discover(ctx, known)` (`discover.ts`) yields one metadata-only `SessionBundle` per session, current then legacy, sorted by id within each origin:

1. `probe(ctx)`: `installed` iff at least one origin DB file exists; `roots = [opencodeDataDir(ctx)]`; `notes` lists which DBs were found plus session counts.
2. **Known rule** (read-only, no content): per origin, `readOrigin` projects + schema-checks every `session`/`session_v2` row and every `session_message` `data` blob. A source is skipped iff `known.get(sourceId)` matches `{size: messageCount, mtime: time_updated}`.
3. Compute the bundle (`compute.ts`): resolve the project from `session.directory` (cwd) with `project.worktree` as the round-trip repo-root hint (D8/D9, via `ctx.fs` only); map messages to `steps[]` in source order with `seq` reindexed 0..n-1 (table below); compute the `Session`: token fields as **Σ of `call`-step tokens** (never `session_v2.tokens_*` directly, with a `token-total-drift` diagnostic when the harness aggregate differs), `model_primary` = model with the most `output` tokens, `turns` = count of `user` messages (`synthetic` is not a turn), `api_calls`/`tool_calls`/`compactions` from step-kind counts, `depth` from the parent chain, `cost_usd` = harness-reported `session.cost`.
4. Emit `{ project, session, steps, diagnostics }`. A bad row is carried as a content-free diagnostic, never a throw. A DB-level read failure yields an empty origin plus `source-read-failed` (which the `sourceExists` path treats as retain).

`sourceExists(ctx, {sourceId, sourceLocator})` returns `false` (delete) only when the origin DB file is **confirmed absent** (`fs.stat(sourceLocator)` is undefined) or when the session id is confirmed absent in a successfully read DB, and `true` (retain) on any DB open/read/stat error — so a transient error or an unreadable store never mass-deletes. This delete path is only reached after a full successful discovery (`importAll` skips removal on a mid-stream `discover` throw).

## Record types and what is taken from them

`session_message.type` (a column) drives the mapping. `data` is the JSON blob.

| `type` | Produces | Fields used (from `data`) |
|---|---|---|
| `user` | `Step kind=turn` → `turns` | `time.created`, `text` (dropped) |
| `assistant` | `Step kind=call` per message with `tokens` (`model`, token columns) → token totals, `api_calls`, `model_primary`; `Step kind=tool` per tool part (`tool_name = content[].name`, with legacy `tool` fallback; `tool_category`, `model = model.id, absent → NULL`, `call_id = part.id`, `error = state.status === 'error'`, part-local `duration_ms = completed − created`) → `tool_calls`, `session_tool_counts`. An explicit subagent `state.metadata.sessionID` matching a child whose declared parent owns the call supplies that child's `spawn_call_id`; because CORE stores one spawn call per child, the first explicit match in source order is retained and later matches remain agent tool steps. | `model.id`, `time.{created,completed}`, `tokens.{input,output,reasoning,cache.{read,write}}`, `content[].{type,id,name,tool,time.{created,completed},state.status,state.metadata.sessionID}` |
| `model-switched` | `Step kind=model-change` (`from_value = previous.id`, `to_value = model.id`) → `model_changes` | `time.created`, `model.id`, `previous.id` |
| `compaction` | `Step kind=compaction` (`compaction_trigger = reason`) → `compactions` | `time.created`, `reason` (content `summary` dropped) |
| `agent-switched` | `Step kind=harness` (`tool_name = 'agent-switched'`) | `time.created` |
| `system` | `Step kind=harness` (`tool_name = 'system'`) | `time.created` |
| `location-switched` | `Step kind=harness` (`tool_name = 'location-switched'`) | `time.created` |
| `synthetic` | skipped (injected content, not a turn) | — |
| (other) | timestamps only; diagnostic `unknown-record-type` | `time.*` |

`session` / `session_v2` columns read: `id`, `project_id`, `parent_id`, `fork_session_id`, `directory`, `title`, `agent`, `model`, `version`, `cost`, `time_created`, `time_updated`, `time_suspended`, `tokens_*`. `parent_id` set → `relation='subagent'`; an explicitly matching parent subagent tool part supplies `spawn_call_id`; `fork_session_id` set (no parent) → `relation='fork'`, `forkedFrom = opencode:<origin>:<fork_session_id>`. `resumed = time_suspended != null`. `harness_version_first/last = version`. `mode`/`effort`/`git`/`initiator` are not stored per OpenCode session → those capabilities are not declared.

## Tool categories (OpenCode names are lowercase)

`read`→read, `glob`/`grep`→search, `edit`/`write`/`patch`→write, `shell`/`execute`→exec, `webfetch`/`websearch`→web, `subagent`→agent, `skill`→skill, `question`→plan, else `other`.

## Allowlist (projection)

`allowlist` (`opencodeAllowlist`) is the only projection both the bundle path and the connector use. It keeps `type`, `role`, `model.id`, `previous.id`, `time.{created,completed,streamed}`, `tokens.{input,output,reasoning,cache.{read,write}}`, `content[].{type,id,name,tool,time.{created,completed},state.status,state.metadata.sessionID}` and `reason`. The narrowly projected `sessionID` is an opaque causal identifier; no other metadata key is retained. It drops `text` (prompt/reasoning), `content[].text`, all of `content[].state.input`, `content[].state.{content,error.message,reasoningEncryptedContent}`, every other `state.metadata` key, `snapshot`, `summary`, `recent`, top-level `metadata`, `share_url`, `revert`, `instruction_*` values. `sessionRowAllowlist` keeps only the metadata `session`/`session_v2` columns (also dropping `summary_diffs`, `metadata`, `share_url`, `revert`).

## Capabilities

Declared (observed on the `all` fixture): `usage.perCall`, `usage.cumulative`, `usage.cacheWrite`, `usage.reasoning`, `timing`, `model`, `version`, `turns`, `toolCalls`, `compactions`, `subagents`, `cost`, `title`, `steps.errors`, `steps.harness`, `steps.toolDurations`. Not declared (no OpenCode data): `mode`, `effort`, `git`, `initiator`.

## Diagnostics

| Code | Level | Meaning |
|---|---|---|
| `invalid-record` | warn | A session/message row did not match the loose schema. |
| `unknown-record-type` | info | One or more messages had an unrecognized `type` (aggregated, `count`). |
| `token-total-drift` | info | `session_v2.tokens_*` differs from the Σ of `call`-step tokens (the contract invariant is computed, never read from the harness aggregate). |
| `source-read-failed` | error | An origin DB could not be read; that origin yields zero bundles (which `sourceExists` treats as retain). |

Core adds `orphan-child` and `bundle-invalid` at persist time — not emitted by this adapter.

## Fixtures

`fixtures/opencode/<case>/home/.local/share/opencode/` contains real SQLite fixture DBs. `small`, `subagents`, `canary`, `malformed` use the current store (`opencode.db`); `legacy` uses only the legacy store (`opencode-tui-v2.db`); `all` contains **both** stores and observes every declared capability (call tokens, model-change, compaction, tool.error, tool.durationMs, harness step, subagent fields, title, costUsd non-zero, version non-null, timing). The `canary` case plants `RUNWIRE_CANARY_<n>` in content that the allowlist must drop (asserted by the contract kit). Adapter tests that touch SQLite use `createBunFs()` against a real fixture DB — `createMemoryFs().openSqliteReadonly` throws.

## Connector API (metadata-only, CORE-representable)

```ts
import { inventorySessions, retrieveSession, retrieveSessionParts, type SessionSummary, type SessionDetails } from '@runwire/adapter-opencode';

for await (const summary of inventorySessions(ctx)) { ... }        // bounded memory stream
const details: SessionDetails = await retrieveSession(ctx, sourceId); // project + session + steps + diagnostics
for await (const page of retrieveSessionParts(ctx, sourceId, { pageSize: 200 })) { ... } // Step[] pages, seq-ordered
```

Every field is a CORE type (`Project`, `Session`, `Step`, `Diagnostic`) or a thin projection of CORE `Session` fields. There is **no** content-bearing `CanonicalPart`/`rawBase64`, **no** `sensitive`/`enrich` option, and **no** HTTP enrichment — the connector is a read-only on-disk store reader and returns only non-sensitive CORE-representable data.
