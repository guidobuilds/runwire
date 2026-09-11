# Adapter: Pi — feasibility and mapping analysis

Status: **implemented (v1, 2026-09-10)** — see `packages/adapter-pi/`. This file remains the
mapping reference for the Pi adapter, written against the same contract as the Claude Code and
OpenCode adapters ([README](README.md), [ARCHITECTURE §3–§8](../ARCHITECTURE.md)). It answers
three questions: where Pi keeps its information, what Scout can obtain from it, and what Scout
would be missing.

Evidence base:

- Pi CLI `0.85.1` (`@earendil-works/pi-coding-agent`), its shipped `docs/session-format.md`,
  `docs/sessions.md`, `docs/compaction.md`, `docs/usage.md` and the `.d.ts` in
  `dist/core/session-manager.d.ts` and `@earendil-works/pi-ai/dist/types.d.ts`.
- Structure-only inspection of the real session data on the reference macOS machine
  (2026-09-08): 1 session file, 371 records, keys and numeric aggregates only — no content read
  or retained. Appendix A has the numbers.
- Pi is last in the harness order (D25). `docs/harness-survey.md` "Pi" was rewritten in task 12
  and is now current; this file remains the detailed mapping reference.

## 1. What the two existing adapters actually do

Both adapters are the same seven modules with a different reader underneath
([adapters/README.md](README.md) step 2). Everything that differs is *where bytes come from* and
*what the harness's own semantics are*:

| Module | Claude Code (`adapter-claude-code`) | OpenCode (`adapter-opencode`) |
|---|---|---|
| `index.ts` / `adapter.ts` | `createClaudeCodeAdapter(): HarnessAdapter` — identity, `capabilities`, `allowlist`, `probe`, `discover` | same, plus `sourceExists` |
| `paths.ts` | `~/.claude/projects` + the filename ↔ session-id codecs; `path.posix.join` everywhere so `createMemoryFs` works on Windows too | data dir + the two DB paths + `opencode:<origin>:<id>` source-id codec + `detectDbKind` |
| reader | `records.ts`: `ctx.fs.openStream` → `readLinesRaw` → `JSON.parse` → `project()` → Zod | `records.ts`: `ctx.fs.openSqliteReadonly` → projected rows per origin |
| `allowlist.ts` | one `Projection` for every record type | two: `opencodeAllowlist` (the `data` blob) + `sessionRowAllowlist` (metadata columns) |
| `compute.ts` | one fold over records → `{project, session, steps[], diagnostics[]}` | same fold, over pre-grouped rows |
| `project.ts` | `resolveProject({cwd}, {fs})` — walk up for `.git`, read the origin remote, normalize (D8/D9). Verbatim the shared pattern | same, with the harness's `project.worktree` as a repo-root hint |
| `discover.ts` | sorted walk; `known` = `(size, mtime)` per file; parent+children reprocessed as a unit | `known` = `(messageCount, time_updated)` per row; `sourceExists` retains on any error, deletes only on a confirmed-absent row |

The contract they both satisfy, and that a Pi adapter must satisfy identically:

- **Nothing off-allowlist survives.** `project()` runs before validation, so content keys never
  reach a schema, a step or a diagnostic (ARCHITECTURE §7).
- **Σ over `call` steps = the session's value** for each of the five token fields (§4 invariant).
  Session totals are *computed*, never copied from a harness aggregate — OpenCode proves the
  discipline by emitting `token-total-drift` when the harness's own sum disagrees.
- **`seq` contiguous from 0 in source order**; harness-native ordering is never trusted
  (OpenCode reindexes because `session_message.seq` is not contiguous).
- **Stable ids across imports**, and `known` skips a source whose `(size, mtime)` is unchanged.
- **Diagnostics, never exceptions** — a malformed record yields a `{level, code, message}` row
  with a fixed code and no content.
- **Declared capabilities must be observed** (test kit), and every emitted field must be gated by
  a declared capability. This is what forces each adapter to state honestly what its harness
  cannot report.

Two precedents from those adapters matter a lot for Pi, and are referenced below:

- Claude's `<synthetic>` model: usage is **kept** on the `call` step while `Step.model` stays
  `undefined` (`compute.ts`). Pi needs exactly this for usage that has no model of its own.
- Claude treats records with no `requestId` as unique, and OpenCode projects **only**
  `content[].state.metadata.sessionID` out of an otherwise content-bearing metadata bag. Pi's
  `details` field needs the same surgical treatment (or, more likely, total exclusion).

## 2. Where Pi keeps its information

| | Path |
|---|---|
| Agent dir | `~/.pi/agent/`, overridable by `PI_CODING_AGENT_DIR` |
| Session root | `~/.pi/agent/sessions/`, overridable by `PI_CODING_AGENT_SESSION_DIR`, overridden by `--session-dir <dir>` |
| Project dir | `<sessions>/<encoded cwd>/` where `<encoded cwd>` = `--` + `cwd.replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')` + `--` |
| Session | `<projectDir>/<name>_<uuidv7>.jsonl` where `<name>` is the creation ISO timestamp with every `:` and `.` replaced by `-` |
| Format version | header `version`, `CURRENT_SESSION_VERSION = 3`; **absent ⇒ v1** |
| Ephemeral | `pi --no-session` writes nothing at all — invisible to Scout, by construction |

Observed: `sessions/--Users-guido-orca-workspaces-scout-session-profile-dynamic--/2026-09-08T15-34-04-313Z_01a081a7-ab18-…-….jsonl`.

The encoding is **lossy in the same way Claude's is** (a literal `-` in a path segment is
indistinguishable from an encoded separator, and Windows adds a drive letter), so the decoded
dirname may only be used as a `cwd` *value* with a diagnostic, never as the project key. Pi's own
`session-cwd.ts` (`getMissingSessionCwdIssue`, `assertSessionCwdExists`) exists because Pi itself
cannot rely on stored cwds; `SessionInfo.cwd` is documented as "empty string for old sessions".

One source directory per project, one JSONL per session, append-only, no index, no lock file, no
WAL — **Pi's on-disk shape is the closest match to Claude Code's of any surveyed harness.**

### 2.1 What is *not* session data (do not walk it)

`~/.pi/agent/` is a mixed directory. Only `sessions/` is in scope:

| Entry | Why it must stay out |
|---|---|
| `agents/*.md`, `subagents.json`, `chains/*.chain.md` | user-authored agent/chain **prompts** (content) |
| `auth.json` (0600), `models-store.json` | credentials; a model catalog with pricing |
| `settings.json` | config, incl. `lastChangelogVersion` — machine-global, not per-session |
| `skills/`, `extensions/`, `npm/node_modules`, `pi-pretty/`, `intercom/` | resources and third-party state |
| `gentle-agents/sessions/*.jsonl`, `gentle-agents/tasks/*.json` | an **extension's** session store and its own usage ledger — see §6.1 |

A recursive `**/*.jsonl` scan under `~/.pi/agent` would therefore pick up extension-run child
sessions and attribute them to Pi. The default root must be `<agentDir>/sessions` **only**, and
that boundary must be stated in `paths.ts`.

### 2.2 The record model

Every line is a JSON object with `type`. The header carries `id` (the session uuid) but no tree
`parentId`; every other entry is a node in the tree (each entry has `id` + `parentId`):

```ts
SessionEntryBase = { type: string; id: string /* 8-hex */; parentId: string | null; timestamp: string /* ISO */ }
```

| `type` | Payload that matters to Scout | Content that must never be read |
|---|---|---|
| `session` (header) | `version`, `id` (uuidv7), `timestamp`, `cwd`, `parentSession?` (a path) | — |
| `message` | `message.role` and per-role metadata (§3) | all text/thinking/tool args/tool output/`details` |
| `model_change` | `provider`, `modelId` | — |
| `thinking_level_change` | `thinkingLevel` (`off|minimal|low|medium|high|xhigh|max`) | — |
| `compaction` | `tokensBefore`, `usage?`, `fromHook?`, `firstKeptEntryId`/`retainedTail` (presence) | `summary` (a whole conversation summary), `details.readFiles/modifiedFiles`, `retainedTail` (full messages) |
| `branch_summary` | `usage?`, `fromHook?` — `fromId` is not allowlisted: the entry's presence is the fact, the tree pointer is not followed in v1 | `summary`, `details` |
| `custom` | *presence only* — `customType` is deliberately not read (§3.3) | `data` — arbitrary extension state |
| `custom_message` | *presence only* | `content` — extension-injected context, and `customType` |
| `label` | *presence only* | `label` (user-authored bookmark text), `targetId` (a tree pointer Scout does not follow) |
| `session_info` | presence | `name` (user-authored display name) |

Message roles (`AgentMessage` union, verified against `pi-ai/dist/types.d.ts` +
`dist/core/messages.d.ts`): `user`, `assistant`, `toolResult`, `bashExecution`, `custom`,
`branchSummary`, `compactionSummary`.

```ts
Usage = { input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens,
          cost: { input, output, cacheRead, cacheWrite, total } }

AssistantMessage = { role:'assistant', content:(Text|Thinking|ToolCall)[], api, provider, model,
                     responseModel?, responseId?, providerThinkingLevel?, usage, stopReason,
                     rawStopReason?, errorMessage?, diagnostics?, endTurn?, timestamp /* ms */ }
ToolResultMessage = { role:'toolResult', toolCallId, toolName, content, details?, usage?,
                      addedToolNames?, isError, timestamp /* ms */ }
UserMessage       = { role:'user', content, timestamp /* ms */ }
StopReason = 'pending'|'stop'|'length'|'toolUse'|'error'|'aborted'|'deferred'
ToolCall   = { type:'toolCall', id, name, arguments /* content */ }
```

`pending` cannot appear in a persisted session: pi replaces it before writing the terminal message.

### 2.3 Pi is deliberately feature-poor — and that shapes what Scout sees

`docs/usage.md`, Design Principles: *"It intentionally does not include built-in MCP, sub-agents,
permission popups, plan mode, to-dos, or background bash."* The built-in tool set is closed and
tiny:

```ts
ToolName = 'read'|'bash'|'powershell'|'edit'|'write'|'grep'|'find'|'ls'   // dist/core/tools/index.d.ts
```

Everything else in a real session comes from `pi.registerTool()` in a third-party package, so the
tool vocabulary is **open** (observed on the reference machine: `todo`, `subagent_run`,
`subagent_list_agents`, `read_symbol`, `lens_diagnostics`, `module_report`, `mem_save`,
`mem_session_summary`, `gentle_review`, `project_report`). Consequences: no `mcp` tool category
from core data, no `mode`, no `subagents`, and a `tool-category.ts` that must degrade unknown
names to `other` without failing.

## 3. What Scout can obtain

### 3.1 Token and cost semantics (verified, not assumed)

The D5 mapping is a rename — **no derivation needed**, which is the best outcome of the three
harnesses surveyed:

| Scout column | Pi field | Evidence |
|---|---|---|
| `uncached_input` | `usage.input` | `totalTokens === input + output + cacheRead + cacheWrite` on 170/170 messages → `input` and `cacheRead` are **disjoint** (unlike OpenAI-style `cached ⊂ input`, so no `input − cached` subtraction, and unlike Codex) |
| `cached_input` | `usage.cacheRead` | reference session: 22 227 968 cache-read vs 584 156 uncached input (97.4 % hit) |
| `cache_write` | `usage.cacheWrite` | present in the type; 0 in the reference file (`openai-codex` reports none) — must be observed on an Anthropic-backed fixture before declaring `usage.cacheWrite` |
| `output` | `usage.output` | |
| `reasoning_output` | `usage.reasoning` | documented as "a subset of `output`"; `undefined` for providers with no breakdown → NULL (1/170 in the sample) |
| `cost_usd` | Σ `usage.cost.total` | Pi computes cost from its own `ModelCost` pricing table (`$`/million tokens, with tiers) and writes the result per message. That is *harness-reported* in exactly the sense Claude Code's `totalCostUSD` is (also CLI-computed), so it is admissible. `cost.total === sum(cost parts)` on 170/170. **Caveat:** cost is 0 for models with no pricing entry, so Σ under-reports custom/local models |

**There is no deduplication problem, and that inverts the Claude risk.** Claude writes one API
response as several records sharing a `requestId`, so a naive sum over-counts 2.5× (438 086 vs
1 117 279). Pi appends **one `message` entry per API call**, and its `responseId` was unique on
170/170 messages. Pi's risk is the opposite: usage that is *not* on an assistant message
(`compaction.usage`, `branch_summary.usage`, `toolResult.usage`). Pi itself includes all three in
its own totals — `getUsageCostBreakdown()` buckets them under `"Tools/summaries"` — so ignoring
them would make Scout's numbers disagree with what `pi /session` shows the user. That is §5.2.

### 3.2 `Session` fields

| Scout field | Source | Notes |
|---|---|---|
| `id` | `pi:<id>` with `<id>` from the **filename** | not from the header — §5.3 |
| `harnessId` | `pi` | |
| `projectKey` | `resolveProject({ cwd: header.cwd })` | no `remoteHint`/`repoRootHint` exist, so it is the pure `fs` walk (identical to the Claude adapter's fallback path) |
| `cwd` | `header.cwd` | fallback: decode the project dirname, diagnostic `cwd-from-dirname`. Unlike Claude (where any record may carry a `cwd`), the header is Pi's only cwd anchor — and it can be `""` on old files |
| `startedAt` / `endedAt` / `durationMs` | min/max of every `timestamp` in the file (header + entries) | reference session: 153 min wall clock. Idle time inflates it exactly as it does for Claude — a known, comparable limitation |
| `modelPrimary` | model with the most `output` tokens over `call` steps | value = `responseModel ?? model` (Pi's own precedence; **D80**: bare, no provider prefix, for cross-harness comparability); `modelChanges` = transitions in source order, derived from call steps for parity with Claude, *not* from `model_change` entries (§5.4) |
| `effort` | last `thinking_level_change.thinkingLevel` wins | Claude parity with `effort`; the vocabulary is a closed enum ⇒ metadata, admissible under D7 |
| `turns` | count of `role:'user'` messages | `custom`, `bashExecution` and extension-injected messages are **not** turns. Pi has `turn_start`/`turn_end` events in `--mode json` but persists none of them, so turn *durations* are unavailable (§6.5) |
| `apiCalls` | `call` steps (assistant + extra-context calls, §5.2) | |
| `toolCalls` | `toolCall` content blocks; equals `toolResult` count when every call is answered | 191/191 paired in the reference session |
| `compactions` | `type:'compaction'` entries | |
| `relation` / `forkedFrom` | `header.parentSession` → `relation:'fork'`, `forkedFrom:'pi:<id>'` where `<id>` is the uuid in the *parent's* filename | mirrors OpenCode's `fork_session_id` handling; do **not** set `parentId`, or every fork whose parent file was deleted becomes a core `orphan-child` |
| `depth` | `0` | Pi core has no parent/child sessions (§6.1) |
| `title` | `session_info.name` — only behind a decision (§6.4) | |
| `sourcePath` / `sourceSize` / `sourceMtime` | the file and its `stat` | `sourceId`/`sourceLocator` stay undefined: a filesystem source reduces to `sourcePath` in core, as for Claude |
| `gitBranch`, `gitCommit`, `modePrimary`, `harnessVersion*`, `initiator*`, `resumed`, `agentType`, `spawnCallId`, `parentId` | **unavailable** | §6 |

### 3.3 `Step` fields

| Pi record | Step | Fields |
|---|---|---|
| `message` + `role:'assistant'` with `usage` | `call` | `at` = entry ISO `timestamp`; `model` = `responseModel ?? model`; the five token columns |
| `toolCall` block inside that message | `tool` | `toolName = block.name`, `callId = block.id`, `toolCategory` (§4); emitted per block, independently of the call step (parallel calls: 191 blocks across 170 messages) |
| `message` + `role:'toolResult'` | *patches the pending `tool` step* | paired **strictly** by `toolCallId ↔ toolCall.id`; `error = isError`; `durationMs = toolResult.message.timestamp − assistant.message.timestamp` (ms, both on the same clock). Measured: p50 7.2 s, p90 21.1 s — consistent with pure tool execution, because Pi stamps the assistant message at stream end. Parallel calls share one assistant timestamp, so their durations overlap and each includes the batch wait — same caveat Claude's pairing has. An unmatched result is not a step → aggregated `unpaired-tool-result` |
| `message` + `role:'user'` | `turn` | no `durationMs` (Pi stores none) |
| `type:'compaction'` | `compaction` | `preTokens = tokensBefore`; `compactionTrigger` = `fromHook ? 'extension' : null`; `postTokens` unavailable |
| `type:'compaction'`/`branch_summary` **with `usage`** | additionally one `call` step | §5.2 |
| `message` + `role:'toolResult'` **with `usage`** | additionally one `call` step | §5.2 |
| assistant `stopReason ∈ {error, aborted}` | `harness` with `toolName:'call-error'` / `'call-aborted'` | there is no `error` column on `call` steps; this keeps the fact visible and SQL-queryable without a contract change (§6.5) |
| `type:'model_change'` | *no step* | folded into `effort`/model resolution (§5.4) |
| `type:'thinking_level_change'` | `harness` `'thinking-level-change'` | |
| `type:'branch_summary'` | `harness` `'branch-summary'` | |
| `type:'label'` / `session_info` / `custom` / `custom_message` | `harness` `'label'` / `'session-info'` / `'custom'` / `'custom-message'` | the entry `type` only — **never** `customType`, to keep the vocabulary finite the way Claude drops the part after `hookName`'s colon |
| `type:'session'` (header) | *no step* | timestamps + project + fork link |

`harness` steps are the honest place for all of Pi's non-conversation events. It is also a
reminder of how much *quieter* Pi is than Claude Code: no hook stream (Claude sees ~1 000 hook
records per large session), so a Pi timeline needs no "hide harness events by default" treatment.

## 4. Tool categories

`piToolCategory(name)` (`src/tool-category.ts`), D31. Names are already lowercase.

| Category | Built-in | Extension names observed on the reference machine |
|---|---|---|
| `read` | `read`, `ls` | `read_symbol` |
| `search` | `grep`, `find` | — |
| `write` | `edit`, `write` | — |
| `exec` | `bash`, `powershell` | — |
| `plan` | — | `todo` |
| `agent` | — (Pi has none, §2.3) | `subagent_run`, `subagent_list_agents` |
| `web` | — | (from packages such as `pi-web-access`, if installed) |
| `mcp` | — (never: no built-in MCP) | unreachable unless an extension emulates MCP |
| `skill` | — (**unreachable**, §6.3) | — |
| `other` | everything else | `lens_diagnostics`, `module_report`, `mem_save`, `mem_session_summary`, `gentle_review`, `project_report` |

Because extensions own the vocabulary, the map is a best-effort prefix table, `other` is a normal
outcome and never a diagnostic, and no extension name may ever be *required* by a test.

## 5. The four things that make Pi a new design problem, and the chosen answers

### 5.1 A session file is a **tree**, not a list

Pi's headline structure: every entry has `parentId`, `/tree` branches **in place** inside one file,
and `/fork`+`/clone` create new files. So one file can contain several roots and several live
leaves, i.e. mutually exclusive conversation paths, one of which the model actually saw.

Scout's `steps[]` is a linear, 0-based sequence. Options:

| Option | Effect |
|---|---|
| (a) **file/append order** *(chosen)* | every billed API call is counted; matches [ARCHITECTURE §4](../ARCHITECTURE.md#4-what-an-adapter-computes)'s "source order"; matches what the user spent |
| (b) the active branch (`buildSessionPath` to the last leaf) | matches what the model saw, silently discards the tokens that abandoned branches really cost |
| (c) one Scout session per branch | breaks D4 ("one source file = one session") and re-counts shared prefix usage |

Chosen: **(a) file order**, because Scout's purpose is making waste visible (D67) and an abandoned
branch is spend, not noise. The active-path view is *derivable later* from `parentId`, which is
why (a) does not foreclose anything. Two consequences must be documented, not hidden:

- `turns` counts user messages on **all** branches, so a heavily branched session reports more
  turns than the user perceived as separate prompts.
- Usage counted this way can exceed what any single model context contained. `cached_input` is the
  tell: after `/tree` rewinds, Pi rebuilds context and the cache mostly misses, so a
  cache-write/miss spike *is* the branching signal.

To make the shape queryable without a contract change, emit one aggregated diagnostic:
`branched-tree` (info, `count` = extra entries with `parentId: null`; `leaves` recorded in the
message as a number, never as content). Reference session: 1 root, 1 leaf → no diagnostic.

### 5.2 Usage that is not attached to an assistant message

`compaction.usage`, `branch_summary.usage` and `toolResult.usage` are real API spend that Pi
counts in its own totals but that Scout's schema cannot hang off a `compaction`/`tool` step
(`Step` has token columns only on `call`; `compaction` has `pre/postTokens`).

Chosen: **emit an additional `call` step** for each such usage record — `at` = the entry
timestamp, all five token fields, and `model` **left undefined**, exactly the shape Claude Code
uses for `<synthetic>` usage. Rules:

1. The Σ-per-`call`-step invariant then holds against totals that match `pi /session`.
2. `apiCalls` counts them (they *were* requests).
3. They are excluded from `modelPrimary` tallies, since they have no model — mirroring Claude's
   `<synthetic>` handling.
4. `compaction` and `tool` steps are still emitted for the structural facts.
5. Each of those calls is counted by `usage-on-non-assistant` (info, `count`), so the number of
   steps created outside assistant messages stays visible — and a `toolResult.usage` on a tool that
   is not agent- or summary-shaped is what makes a semantic drift detectable later.

Alternative (rejected): drop them and match only "main context accounting". Rejected because the
reference machine runs extensions whose tools call models (`gentle_review`,
`mem_session_summary`, `subagent_run`), and silently dropping their cost would understate exactly
the harness-layer waste Scout exists to find. Note `toolResult.usage` is declared but **not
observed** in the reference data — verify against more sessions before trusting it.

### 5.3 Identity stability (the "stable ids" contract check is the trap)

Two of Pi's own behaviors break a naive `id` derivation:

- `_loadEntries()`: a file **without** a `session` header gets `newSession()` — a *fresh random*
  uuid on every open. A headerless legacy file therefore has no stable id at all.
- `migrateV1ToV2()` **synthesizes `id`/`parentId` in place** (`generateId()` = random 8-hex), so
  for a v1 file the entry ids are not even load-stable, let alone import-stable.
- `forkFrom`/`createBranchedSession` assign a new uuid to the copy, and a headerless file opened by
  Pi gets a brand-new random uuid written as its header — after which `header.id` no longer equals
  the uuid in the file's own name. The filename is the only identifier Pi never regenerates.

Chosen, in `paths.ts`:

```ts
export function sessionIdFromRootFile(entry: string): string {
  return entry.slice(0, -'.jsonl'.length).replace(/^.*?_/, ''); // <ts>_<uuid> → <uuid>
}
```

- `session.id = 'pi:' + <uuid from filename>`, `sourcePath` = the file (no explicit `sourceId`, so
  `known` keys by path, as Claude does).
- v1 files: never key a step by entry `id`; `seq` is file order, which is stable regardless.
- `header.id` is used for nothing but a consistency check: if it differs from the filename uuid,
  emit `session-id-mismatch` (info). This is the only cheap way to notice Pi's migration rewrote
  a header.

### 5.4 `model_change` entries vs per-message models

Pi persists configuration transitions (`model_change` with `provider`+`modelId`) *and* the model
that actually answered each call (`message.model`, `message.responseModel`), and they can disagree
(provider aliases, per-attempt fallbacks after an error). Using the entries for `model_changes`
and the messages for `Step.model` would produce a step sequence that contradicts its own call
steps.

Chosen: derive `model-change` steps and `model_changes` from the **call steps' resolved models**
(Claude parity, and keeps `ARCHITECTURE §4`'s definition meaningful), and let `model_change`
entries only seed the "current model" before the first call. If a `model_change` target never
appears on any call, emit `unused-model-change` (info, count) — cheap evidence that the two
sources disagree, per D52.

## 6. What we would be missing

Pi is the least informative of the three surveyed harnesses: **six of the twenty capabilities are
unavailable** — three because Pi deliberately does not have the feature, three because Pi does not
persist data it already computes.

### 6.1 Subagents — the biggest loss (capability `subagents` **not** declarable)

`SessionHeader.parentSession` is only written by `/fork`, `/clone`, `createBranchedSession()` and
`newSession({parentSession})` — it is **lineage, not delegation**. Pi core has no subagent tool
(§2.3), so there is no `.meta.json` analogue, no nested directory, no `spawn_call_id`, no
`agent_type`, no `depth`.

In practice this is worse than it looks, because the reference machine *does* run
extension-dispatched subagents: `subagent_run` (from an installed package) writes child sessions
into its own tree (`~/.pi/agent/gentle-agents/sessions/`) whose headers carry **no**
`parentSession`, and the parent's `toolResult.details` exposes only
`gentleAgents[].{agent,mode,status,taskId}` — no child session locator. So the two sides cannot be
linked from Pi data.

The only bridge that exists is the extension's own ledger: `gentle-agents/tasks/<taskId>.json`
contains `parentSessionId`, `sessionPath`, `cwd`, `agent`, `mode`, `turns`, `toolCalls`, `tokens`,
`cost`, `createdAt/startedAt/endedAt`. Recommendation for v1: **do not read it.** It is third-party
state, not Pi's store, its schema is not versioned, and its `prompt`/`result` fields are content.
Reading it would make the adapter an adapter of an extension. Instead: (i) keep the children out
of scope by scanning only `<agentDir>/sessions`, (ii) record `subagent_run` calls as ordinary
`agent`-category tool steps so delegation is *counted* even when it cannot be *linked*, and
(iii) leave a documented seam: a later `PiLinkSource` interface that, given a `taskId`, supplies
`{parentId, sourcePath, agentType}`, so linkage can be added without touching `compute.ts`.

Shipped in v1 as **D81**: only `<agentDir>/sessions` is scanned; `subagent_run`/
`subagent_list_agents` are emitted as ordinary `agent`-category `tool` steps (delegation counted,
not linked); `subagents` stays undeclared. The `PiLinkSource` seam is recorded, not implemented.

Cost of the gap: `rollups.descendants`, inclusive token totals and D51 signal #6 ("root never
delegates and exhausts its own context") all degrade for Pi sessions.

### 6.2 Harness version (`version` **not** declarable)

`header.version` is the **session format** version (`3`), not the Pi CLI version, and Pi records no
CLI version anywhere in the session stream. Writing it into `harnessVersionFirst/Last` would
corrupt the field's meaning (`ARCHITECTURE §4`: "First and last version seen"). So Pi rows will
have NULL `harness_version_*`, and a mapping break in a new Pi release cannot be attributed to the
release that caused it. **Upstream ask:** one extra header field `piVersion` (Pi knows its own
version, and the header is written exactly once) — trivial to add, and it removes this whole class
of blindness for every consumer.

### 6.3 Skills (`skill` category and `Step.skillName` **not** reachable)

Pi implements the Agent Skills standard, but a skill is *not a tool*: skills are listed in the
system prompt and the model loads `SKILL.md` with `read` (or `bash`), or the user forces it with
`/skill:<name>`, which expands into a **user message containing the skill's text**. So the only
trace is a file path inside `toolCall.arguments` — which is tool input, and Scout never reads tool
input (D7, D31: "Tool inputs/outputs never leave the adapter").

Options: (a) leave `skillName` unreachable — honest, and D51 signal #5 ("no skill usage") is then
neutral-not-broken for Pi; (b) match `read` argument paths against the skill directory names
Scout can enumerate from `<agentDir>/skills` and the project's `.pi/skills`/`.agents/skills`,
keeping the skill *name* and dropping the rest of the path. (b) is a real D7 extension — it reads
one argument key — so it must be an explicit numbered decision before it is implemented, not a
convenience in `compute.ts`. Recommendation for v1: **(a)** — shipped as **D79** (`skill` not declarable), with option (b)
recorded as the documented future path that requires its own explicit D7-extending decision.

### 6.4 Title — a decision, not a fact

`session_info.name` is set by `/name`, `--name` or `pi.setSessionName()`: it is **user-authored
text**. D7's exception is specifically for *harness-generated* titles, and the Claude allowlist
excludes `agentSetting`/`agentName` for exactly this reason ("a user-authored agent name"), while
OpenCode's `title` is auto-generated. So storing Pi's name would be the first user-authored string
in the DB. Options: exclude it (consistent with Claude; `title` **not** declarable — the
recommended default), or include it gated on `ctx.privacy.titles` and record a new decision that
widens D7 to user-authored titles. Note that Pi's `/resume` picker shows this name *instead of* the
first message, which is the same trade-off D7 already adjudicated. Shipped as **D78**: excluded; `title` undeclared.

### 6.5 The rest

| Missing | Why | Impact / mitigation |
|---|---|---|
| `mode` | no permission popups, no plan mode in core (§2.3) | `modePrimary`/`modeChanges` NULL; D51 signals 2/3 unaffected |
| `git` (`gitBranch`, `gitCommit`) | not in the session stream; Pi reads the branch *live* in `footer-data-provider.ts` | NULL. **Deliberately do not** read `.git/HEAD` at import time: it reports today's branch, not the branch the session ran on — a silently wrong row is worse than a NULL one. Ask upstream for `git.{branch,commit}` in the header |
| `initiator` | `-p/--print`, `--mode json`, `--mode rpc` and SDK use leave **no** on-disk trace. The nearest thing (`--name`) is optional; `PI_CODING_AGENT=true` is inherited by child processes but never persisted | all three columns NULL, so a machine-dispatched Pi fleet is indistinguishable from terminal use (Claude measures this at ~83 % of rows). **Upstream ask:** persist the invocation surface in the header — a closed enum, no content, and it would also make Pi the only harness whose dispatch volume we can measure *and* attribute |
| `resumed` | `pi -c`/`pi -r` append to the same file with no marker | NULL (D4 is unaffected: one file = one session) |
| turn / API-latency durations | `turn_start`/`turn_end` exist as runtime events only, never persisted. Entry `timestamp` and message `timestamp` agree at p50 (Δ 0 ms), so a Pi file carries one clock and no sub-turn resolution | `turn.durationMs` stays NULL; `timing` is still declarable, and per-call latency cannot be separated from generation time |
| `compaction.compactionTrigger` | Pi computes `reason ∈ {'manual','threshold','overflow'}` for its `session_before_compact` event but does **not** persist it, and `CompactionDetails` only carries `{readFiles, modifiedFiles}` | D51 signal #1 ("repeated *automatic* compaction") degrades to "repeated compaction". `fromHook` does distinguish extension-authored. **Upstream ask:** persist the reason you already compute |
| `compaction.postTokens` | `CompactionResult.estimatedTokensAfter` is not written to the entry | only `preTokens` available |
| `Step.error` on a failed call | `error` is gated for `tool` steps only (`CAPABILITY_FIELDS['steps.errors']`) | workaround chosen in §3.3 (`harness` step `call-error`); the clean fix is widening `error` to `call` steps |
| `provider` | Scout has no provider column, and Pi's cost per token varies by provider as well as model | decide whether `modelPrimary` carries `provider/model`; see D-"decisions" below |
| `usage.cacheWrite1h` | Anthropic's 1 h-retention split, a subset of `cacheWrite` | outside the contract; a future cache-cost signal |
| `--no-session` runs | nothing written | invisible, and unfixable from disk |
| custom `--session-dir` runs | written outside `<agentDir>/sessions` | invisible unless extra roots are configured; do not hardcode extension dirs |

**Net capability statement for a v1 Pi adapter: 14 of 20 declarable** (`usage.perCall`,
`usage.cumulative`, `usage.cacheWrite`, `usage.reasoning`, `timing`, `model`, `effort`, `turns`,
`toolCalls`, `compactions`, `cost`, `steps.errors`, `steps.harness`, `steps.toolDurations`);
**6 unavailable** (`mode`, `version`, `subagents`, `title`, `git`, `initiator`) — three because Pi
does not have the feature, three because Pi does not persist data it already has.

## 7. Proposed allowlist

```ts
// src/allowlist.ts — the ONLY projection, mirroring the two existing adapters.
export const piAllowlist: Projection = {
  // header
  type: true, version: true, id: true, parentId: true, timestamp: true,
  cwd: true, parentSession: true,
  // entry-level metadata
  thinkingLevel: true, provider: true, modelId: true,
  tokensBefore: true, fromHook: true,
  // usage on a compaction / branch_summary entry (NOT inside `message`) — §5.2
  usage: {
    input: true, output: true, cacheRead: true, cacheWrite: true,
    reasoning: true, totalTokens: true,
    cost: { input: true, output: true, cacheRead: true, cacheWrite: true, total: true },
  },
  firstKeptEntryId: true, retainedTail: [{}],   // presence only: the empty projection keeps nothing
  // message envelope
  message: {
    role: true, api: true, provider: true, model: true, responseModel: true,
    responseId: true, providerThinkingLevel: true, stopReason: true, timestamp: true,
    toolCallId: true, toolName: true, isError: true,   // toolResult pairing + error flag
    usage: {
      input: true, output: true, cacheRead: true, cacheWrite: true,
      reasoning: true, totalTokens: true,
      cost: { input: true, output: true, cacheRead: true, cacheWrite: true, total: true },
    },
    content: [
      { type: true, id: true, name: true },   // toolCall blocks: type/id/name only
    ],
  },
};
```

Excluded, and why — each of these is a **content hazard demonstrated on the reference machine**,
not a theoretical one:

| Key | Contains |
|---|---|
| `message.content[].text`, `thinking`, `textSignature` | prompts, answers, reasoning text |
| `message.content[].arguments` | **all** tool input — paths, commands, edit payloads, and the *only* place skill names appear (§6.3) |
| `message.details` | tool output metadata: `edit` puts `diff` **and** `patch` here; `todo` puts `gentleTodo.tasks[].{title,note}`; `gentle_review` puts prose (`next_action`, `risk`, `reason`, `rddLine`, `reasons[].detail`) |
| `message.errorMessage` | provider error text |
| `message.diagnostics` | extracted `Error` objects |
| `summary`, `retainedTail[*]`, `custom.data`, `custom_message.content`, `label.label`, `session_info.name` | compaction/branch summaries, materialized context, extension state, user bookmark/name text |
| `content[].mimeType`, `data` (images) | base64 image payloads |
| `addedToolNames` | kept out of v1: metadata, but it can name extension tools per result and buys nothing yet |

Two projection idioms worth noting: `[{}]` (an array whose element projection keeps nothing) is how
`retainedTail` presence is kept without its content, and `content: [{ … }]` is the per-element
projection Claude and OpenCode already rely on. Everything Scout needs from a Pi session is
reachable **without** touching a single content-bearing key — which is the strongest argument that
Pi is a safe harness to add.

## 8. Proposed diagnostics

| Code | Level | Meaning |
|---|---|---|
| `malformed-json-line` | warn | a line did not parse as JSON |
| `invalid-record` | warn | a line parsed but failed the loose record schema |
| `oversized-line` | warn | lines over the size cap were skipped (aggregated) |
| `source-truncated` | info | final line had no trailing newline |
| `unknown-entry-type` | info | unrecognized `type` (aggregated) — Pi's extension surface makes this *expected*, so `info` not `warn` |
| `unknown-message-role` | info | a role outside the known union (aggregated), e.g. a future `AgentMessage` member |
| `missing-session-header` | warn | file has no `session` header (identity taken from the filename) |
| `session-id-mismatch` | info | `header.id` ≠ the uuid in the filename |
| `unused-model-change` | info | a `model_change` target never appears on any `call` step (aggregated) — §5.4 |
| `legacy-format` | info | v1/v2 file (absent `version`, no `id`/`parentId`, or `firstKeptEntryIndex`) read without migration |
| `cwd-from-dirname` | info | header `cwd` empty/absent; decoded (lossily) from the project dirname |
| `unpaired-tool-result` | info | `toolResult` with no pending `toolCall` (aggregated) |
| `unanswered-tool-call` | info | `toolCall` never answered — branch abandoned mid-turn (aggregated) |
| `branched-tree` | info | file has >1 root or >1 leaf (count = extra roots) |
| `usage-on-non-assistant` | info | `call` step created from compaction/branch/tool usage (count) — §5.2 |
| `unpriced-model` | info | a call with tokens but `cost.total === 0` (aggregated) — cost under-reports |
| `session-read-failed` | error | the file could not be read; a stub bundle was emitted instead of throwing |

Core continues to add `orphan-child` and `bundle-invalid` at persist time.

## 9. Package plan

```text
packages/adapter-pi/
  src/index.ts          createPiAdapter(): HarnessAdapter  (id 'pi', displayName 'Pi', adapterVersion '1.0.0')
  src/paths.ts          agentDir(ctx) → env PI_CODING_AGENT_DIR ?? <home>/.pi/agent ;
                        sessionsRoot(ctx) → env PI_CODING_AGENT_SESSION_DIR ?? <agentDir>/sessions;
                        sessionIdFromRootFile(); projectDirnameEncode/Decode()   [path.posix.join only]
  src/schema.ts         loose Zod (optional fields, .passthrough()) for header + each entry type
  src/allowlist.ts      §7
  src/records.ts        openStream → readLinesRaw → JSON.parse → project → safeParse; per-file diagnostics
  src/compute.ts        the fold: §3.2 + §3.3 + §5.1–§5.4; TOKEN_FIELDS sums; token-total sanity vs totalTokens
  src/project.ts        verbatim reuse of the Claude Code resolveProject/normalizeRemoteUrl pattern
  src/tool-category.ts  §4 (+ a finite harness-event vocabulary)
  src/discover.ts       probe + walk + known rule
  src/*.test.ts         adapterContract(...) + per-fixture expected.json snapshots
fixtures/pi/<case>/home/.pi/agent/sessions/--home-u-pi--/<ts>_<uuid>.jsonl
```

- **No `sourceExists`.** Pi sources are files, so core's fallback (`fs.stat(sourceLocator ??
  sourceId)` → `sourcePath`) is the right existence test — the same path the Claude adapter takes.
  This is the one place the OpenCode complexity does *not* have to be repeated.
- **Fork vs the subagents gate (test-kit).** Pi does not declare `subagents`, but the contract
  kit's `subagents` gate observes the session-level `relation` field
  (`packages/core/src/contract/capabilities.ts`). A `relation: 'fork'` session inside the kit's
  observed `all/` union would therefore fail the both-directions capability check, so the `fork/`
  fixture is excluded from `fixtures/pi/all/` and covered by per-case tests instead.
- **`probe(ctx)`**: `installed` iff `sessionsRoot(ctx)` exists and is a directory; `roots =
  [sessionsRoot]`; `notes` = project-dir count and `*.jsonl` count. No parsing.
- **`discover(ctx, known)`**: sorted `readdir` of the session root → sorted `readdir` per project
  dir → per `*.jsonl` file, `stat`; skip iff `(sizeBytes, mtimeMs)` matches `known`; else
  read → compute → yield. Files are independent, so — unlike Claude's parent+child coupling —
  there is no group rule. Sort by project dir then filename; the uuidv7 ids make that order
  chronological, so the stream is deterministic (the "stable ids" test needs it).
- **Boundaries**: `@scout/core` only; register in `packages/cli/src/adapters.ts` (D76).
- Pi can rewrite a whole file during migration (`_rewriteFile`), which jumps both `size` and
  `mtime` → one full re-import of that session. Correct, not a bug, but worth a line in the docs.

### Fixtures

| Case | Purpose |
|---|---|
| `small/` | one linear root, synthetic monotonic timestamps: `timing`, `steps.toolDurations`, zero diagnostics |
| `tree/` | >1 leaf plus an unanswered `toolCall` and a `branch_summary`: `branched-tree`, `unanswered-tool-call`, and file-order linearization |
| `subagents/` | `subagent_run` as an `agent` tool step **plus** an unlinkable sibling file outside the scanned root — the fixture that *documents* the §6.1 gap instead of pretending away the capability |
| `extra-usage/` | `compaction.usage`, `branch_summary.usage`, `toolResult.usage`: the Σ-vs-`call`-step invariant for §5.2, and `usage-on-non-assistant` |
| `legacy/` | v1 (no `id`/`parentId`, no header `version`, `firstKeptEntryIndex`) and a v2 `hookMessage` role: `legacy-format`, stable ids from the filename |
| `fork/` | `parentSession` → `relation:'fork'`, `forkedFrom`, and **no** `parentId` (no `orphan-child`) |
| `malformed/` | hand-written: a broken line and a truncated final line, mid-file |
| `canary/` | hand-written: `SCOUT_CANARY_<n>` in **every** content key, especially `content[].arguments`, `details.diff`, `details.patch`, `details.gentleTodo.tasks[].title`, `summary`, `retainedTail`, `errorMessage`, `custom.data`, `label.label`, `session_info.name`, `diagnostics` |
| `all/` | generated union, for the kit's capability-consistency check (must observe `cacheWrite` and `compactions`, which the real machine's single file does not) |

Real sessions may be redacted into fixtures with `scout fixture` as for Claude Code; `malformed/`
and `canary/` are hand-written. The `expected.json` convention and
`UPDATE_EXPECTED=1 bun test packages/adapter-pi` apply unchanged.

## 10. Verdict

**Build it, and build it in the shape above.** Ranking the work: Pi is the *cheapest* adapter this
contract has to gain — one JSONL per session like Claude Code, no subagent trees, no requestId
dedup, no SQLite/WAL handling, no `sourceExists` policy — while being the harness whose data most
directly answers D67, because a Pi session is nearly pure model spend with no hook or permission
chatter.

What Scout gains that the current pair does not give: a third, *minimal* harness to compare
against. Pi is the control group. Only Claude Code reports `mode`, `git` and `initiator` today,
because only Claude Code persists them; a Pi row's NULLs are harness truth, not adapter laziness —
and the difference between "this harness did not do that work" and "this harness did not tell us
about it" is exactly the ambiguity Scout has to be able to query.
`usage.totalTokens === input+output+cacheRead+cacheWrite` also gives Scout a self-check no other
adapter offers: a per-record arithmetic invariant (a `token-arithmetic-drift` diagnostic, the
direct analogue of OpenCode's `token-total-drift`).

What Scout loses, honestly: delegation structure (`subagents`), version attribution (`version`),
git context (`git`), machine-vs-human attribution (`initiator`), permission/plan mode (`mode`) and
skill usage — six of twenty capabilities. Three are Pi's design (it ships without sub-agents, plan
mode or MCP by intent) and cannot be fixed by any adapter; three are missing persisted fields that
Pi already computes (§6.2 version, §6.5 compaction reason, §6.5 invocation surface) and that are
worth asking upstream for, precisely because they are cheap and content-free.

## 11. Resolved decisions

All decided and shipped in v1 (2026-09-10):

1. **`title`** → **D78**: exclude `session_info.name` as user-authored; `title` undeclared.
2. **`modelPrimary` shape** → **D80**: bare `responseModel ?? model`, no provider prefix.
3. **Skill attribution** → **D79**: `skill` unreachable/undeclared; §6.3(b) recorded as a future
   option needing its own D7-extending decision.
4. **Extension subagent bridge** → **D81**: `gentle-agents/tasks/*.json` stays out of scope; scan
   only `<agentDir>/sessions`; `PiLinkSource` recorded as the documented seam.
5. **Contract, not adapter** — widen `Step.error` to `call` steps: **proposed, not implemented**
   (DECISIONS.md "Proposed"); v1 keeps the `harness` `call-error`/`call-aborted` workaround. A
   tree-shaped source needs nothing more than the `branched-tree` diagnostic.
6. **Docs** — completed: `docs/harness-survey.md` Summary + Pi, and D25's order note.

## Appendix A — reference-machine measurement (2026-09-08)

Single session file, `openai-codex/gpt-5.5`, thinking level `medium`, structure-only inspection:

| | |
|---|---|
| Records | 371 = 1 `session` + 1 `model_change` + 1 `thinking_level_change` + 368 `message` |
| Messages | 170 assistant, 191 toolResult, 7 user |
| Tool calls | 191 blocks, all answered (10 `isError`), 0 `unpaired` |
| stopReason | `toolUse` 163, `stop` 6, `error` 1 |
| Tokens | input 584 156 · cacheRead 22 227 968 · cacheWrite 0 · output 35 099 (reasoning 6 226) · total 22 847 223 |
| Cost | 15.0877 USD across 170 calls |
| Timing | 15:34:04.313Z → 18:07:07.571Z (153 min); entry − message timestamp Δ p50 0 ms, p90 9.6 s; tool duration p50 7.2 s, p90 21.1 s, max 305.7 s |
| Tree | 1 root, 1 leaf (linear) |
| Extension tools seen | `todo`, `subagent_run`, `subagent_list_agents`, `read_symbol`, `lens_diagnostics`, `module_report`, `mem_save`, `mem_session_summary`, `gentle_review`, `project_report` |
| Not observed here | `compaction`, `branch_summary`, `custom`, `label`, `session_info`, `toolResult.usage`, non-zero `cacheWrite` |
