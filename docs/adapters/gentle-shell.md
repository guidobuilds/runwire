# Adapter: Gentle Shell — mapping and implementation

Status: **implemented (2026-10-22)**. `createGentleShellAdapter()` in `packages/adapter-pi`
is registered after Pi in the CLI. This file is the mapping reference for the `gentle-shell`
adapter, written against the same contract as the Claude Code, OpenCode and Pi adapters ([README](README.md), [ARCHITECTURE §3–§8](../ARCHITECTURE.md)).
It answers three questions: where Gentle Shell keeps its information, what Runwire can obtain
from it, and what Runwire would be missing.

Evidence base:

- Reference machine, 2026-10-22: `gentle-pi` **4.3.0** + **Pi 1.2.0**, installed as a bundled
  standalone home (`~/.gentle-shell`), plus a second, older install inside the user's Pi home
  (`~/.pi/agent`). GitHub: <https://github.com/Gentleman-Programming/gentle-shell>.
- Installed package read locally: `~/.gentle-shell/versions/4.3.0-1.2.0/node_modules/gentle-pi`
  (launcher, `lib/`, `extensions/`, `docs/`) and `.../@earendil-works/pi-coding-agent/docs/`
  (`session-format.md`, `message-types.md`).
- Structure-only inspection of the real data on the inspected machine: 30 session files in the
  isolated home, 332 in the Pi home, plus the task ledgers. Only keys, record types, counts and
  numeric aggregates were read; no prompt, response, code, tool I/O or reasoning was retained.
  Appendix A has the numbers.
- Delta scan, 2026-11-10: `gentle-pi` **4.7.0** + **Pi 1.5.0** on the same machine. Structure-only
  again — entry types, `customType` names, ledger `task` key sets, counts and boolean metadata;
  no prompt, response, state prose or tool I/O retained. §3.1 is the delta.
- The existing Pi adapter (`docs/adapters/pi.md`) targets Pi **0.85.1**. Pi 1.2.0 keeps the same
  session format version (`3`) but adds record types and message fields; §3 lists the delta.

## 1. What Gentle Shell is

Gentle Shell (`gentle-shell`, npm package `gentle-pi`) is a **Pi-native shell**: it does not
fork Pi and does not define a new session format. It pins an upstream
`@earendil-works/pi-coding-agent` (1.2.0 at the 2026-10-22 investigation, 1.5.0 in the
2026-11-10 delta scan) and adds an extension layer
(focused subagents, native review, ODD workflow, todos, profiles, permission modes, skills) on
top of Pi's own session store.

Consequences that matter for Runwire:

- **The bytes are Pi v3 JSONL.** A session file is a header plus a typed tree
  (`id`/`parentId`), exactly as documented by Pi. The Pi adapter already parses Gentle Shell
  files successfully (verified: 14 bundles from the isolated home with today's `adapter-pi`).
- **The harness identity is not in the file.** The Pi session header carries format `version`,
  `id`, `timestamp` and `cwd` — no harness name and no CLI version. Nothing in a Gentle Shell
  session says "Gentle Shell" unless its extensions happened to append a `custom` entry.
- **The distinctive data is extension state**, not a new format: `custom`/`custom_message`
  entries, child sessions written by the subagent runner, and a task ledger.
- **Where the session lives is deployment-dependent** (§2), and that is the only reliable
  attribution signal without reading content.

### 1.1 Deployment shapes on disk

| Shape | Agent home (`<agent>`) | Parent sessions | Notes |
|---|---|---|---|
| **A. Isolated (default)** | `~/.gentle-shell/agent` | `<agent>/sessions` | Launcher creates it on first run; marker file `<agent>/.gentle-shell-home` (`createdBy: "gentle-shell"`). The bundled Pi lives in `~/.gentle-shell/versions/<gentle>-<pi>/`, not in `<agent>`. |
| **B. Installed into an existing Pi** | `~/.pi/agent` | `~/.pi/agent/sessions` | `pi install npm:gentle-pi`; sessions are interleaved with plain-Pi sessions. |
| **C. `--link`** | the user's Pi home (`~/.pi/agent`, or `GENTLE_SHELL_USER_PI_HOME`) | same root | “Reuse your pi sign-ins, models and chats”; identical to B from disk's point of view. |

In all three shapes the subagent tree and the ledger live **under the active agent home**
(`<agent>/gentle-agents/`), so a child session is always attributable to Gentle Shell even when
its parent is not.

Machine-level (not session) data: `~/.gentle-shell/config.json` (launcher config: optional
`home` mode, `provisioned` versions), `~/.gentle-shell/versions/`, `~/.gentle-shell/runtime/`,
and the shared `~/.gentle-ai/state.json` (Gentle AI preset/selection state). None of these is a
per-session store; the adapter does not read these machine-level files.

## 2. Where Gentle Shell keeps its information

| Path (under `<agent>`) | What it is | In scope |
|---|---|---|
| `sessions/<encoded cwd>/<ts>_<uuidv7>.jsonl` | Parent sessions, one append-only Pi v3 JSONL per session. Same project-dir encoding as Pi. | **yes** (parents) |
| `gentle-agents/sessions/<ts>_<uuidv7>.jsonl` | Child sessions written by the subagent runner. **Flat** directory (no encoded-cwd level), same Pi v3 format, header has no `parentSession`. | **yes** (children) |
| `gentle-agents/tasks/<taskId>.json` | One JSON per finished task: `{ task, thread }`. The only bridge from a parent to a child session. | **yes** (metadata only) |
| `gentle-agents/presence/*.json`, `catalog/*.json`, `transport/` | Live cross-session coordination (15 s heartbeat, bounded sidecars). Ephemeral, stale after exit, no history. | no |
| `gentle-agents/transcripts/<taskId>.md` | Rendered child transcript. | no (content) |
| `agents/*.md`, `subagents.json`, `chains/`, `skills/`, `gentle-ai/` | Agent/chain prompts, routing config, skills, Gentle AI assets. | no (prompts/config) |
| `auth.json`, `mcp-auth.json`, `models-store.json`, `settings.json`, `mcp.json` | Credentials, model catalog, machine-global settings. | no |
| `extensions/`, `npm/`, `pi-pretty/`, `web-search-cache/`, `intercom/` | Extension code and third-party state. | no |

Gentle Shell's own `/gentle:stats` rule (`extensions/gentle-stats.ts`, `statsSessionRoots`)
combines the active home's `sessions` and the original Pi home's `sessions`. Runwire deliberately
differs (D88): only Gentle-home parents belong to this adapter; shared Pi-home parents remain
Pi-owned. Children from both homes' `gentle-agents/` trees are included.

### 2.1 The record model

Entries are Pi v3 (`id`, `parentId`, `timestamp`, `type`). Observed `type`s in real data
(2026-11-10 scan): `session`, `message`, `model_change`, `thinking_level_change`, `custom`,
`custom_message`, `context_edit`, `compaction` and `session_info`. The Pi 1.5.0 model also defines
`usage`, `branch_summary` and `label`; none of the three has been observed yet.

| `type` | Payload that matters to Runwire | Content that must never be read |
|---|---|---|
| `session` (header) | format `version` (3), `id` (uuidv7), `timestamp`, `cwd`, `parentSession?` (a fork link only when its uuid is imported, D89) | — |
| `message` | `role`, per-role metadata (§4), `stopReason`, Pi 1.5.0 `rawStopReason`, usage and its `cost.totalFromProvider` flag | text, thinking, tool args, tool output, `details`, images |
| `model_change` | `provider`, `modelId` | — |
| `thinking_level_change` | `thinkingLevel` | — |
| `custom` | *presence + `customType` namespace* for fingerprinting; the only projected payload is the bounded marker in §7 (published-state `schema`/`recordedAt`/`authority`, alias presence, receipt `source`/`taskId`/`toolCallId`) | the rest of `data` (todo titles, session-change diffs, curated state prose, search results) |
| `custom_message` | *presence + `customType`*; Pi 1.5.0 `display` (boolean) | `content`, `details` (except the allowlisted `gentleAgents` identity, §5) |
| `usage` (Pi 1.2) | `kind`, `provider`, `model`, `usage` — spend outside an assistant message (e.g. cache warm). Still unobserved. | — |
| `context_edit` | *presence only*; observed in 4.7 data (2026-11-10) | `replacement` (context content), the `targetId` pointer |
| `compaction` | `tokensBefore`, `usage?`, `fromHook?`, `firstKeptEntryId`; observed in 4.7 data | `summary`, `details`, `systemMessage` |
| `branch_summary` | `usage?`. Still unobserved. | `summary`, `details` |
| `label` | *presence only*. Still unobserved. | `label` |
| `session_info` | *presence only*; observed in 4.7 data (3 entries in the scan) | `name` (user-authored, D78) |

Message roles: `system` (new in Pi 1.2), `user`, `assistant`, `toolResult`, plus the
coding-agent ones (`bashExecution`, `custom`, `branchSummary`, `compactionSummary`).

### 2.2 The task ledger

`gentle-agents/tasks/<id>.json` is `{ task: TaskRecord, thread: TaskThread }`.

`TaskRecord` keys (metadata vs content):

| Metadata (allowlisted) | Content / behaviour (excluded) |
|---|---|
| `id`, `agent`, `mode` (`task`/`background`), `status`, `cwd`, `parentSessionId`, `sessionPath`, `model`, `modelSource`, `thinking`, `createdAt`, `startedAt`, `endedAt`, `lastActivityAt` | `prompt`, `result`, `error`, `label`, `lastStep`, `sddPreflightContext`, `sddRemediation`, and the whole `thread.items[]` (`text`, tool `args`, `output`) |
| | `tokens`, `cost`, `turns`, `toolCalls` — **duplicated aggregates, excluded**, see §5.3 |

**4.7 key set (2026-11-10 scan, S4).** The keys a `task` record actually carries:
`agent, cost, createdAt, cwd, endedAt, error, id, label, lastActivityAt, lastStep, mode, model,
modelSource, parentSessionId, prompt, result, sessionPath, startedAt, status, thinking, tokens,
toolCalls, turns`. `modelSource` is present; `sddRemediation` and `sddPreflightContext` are
**absent** — they are optional additive keys that the shape reader tolerates by construction (it
reads `id`, `agent`, `parentSessionId`, `sessionPath` and nothing else), not keys this adapter
expects. Link metadata stays identity-only (S9).

The ledger is capped: `history_max_tasks` defaults to **200** and is global, pruned on every
task save. It is the *only* structural link from a child session to its parent and its task id;
pruned entries cannot be reconstructed from the disk after the fact.

## 3. Format delta vs the adapter's Pi target (0.85.1 → 1.2.0)

Historical comparison from the investigation: the Gentle Shell implementation now handles all
of the Pi 1.2 metadata below. The plain Pi adapter remains unchanged at its 0.85.1 target.

The session format **version stays 3**, so the Pi adapter's version gate does not see this
change. What is new:

| Addition | Where | Effect on Runwire |
|---|---|---|
| `message.role: "system"` with `sections`, `toolsAdded`, `toolsRemoved` | messages | Today the Pi adapter counts it in `unknown-message-role`. `sections` is prompt content — never read. Metadata worth nothing per session; recognise and ignore (or a `harness` step). |
| `usage` entry type | entries | Real spend that is not attached to an assistant message (e.g. `kind: "cache_warm"`). The Pi adapter currently reports `unknown-entry-type` and **undercounts**. Must become an extra `call` step, like Pi 0.85's `compaction.usage`/`toolResult.usage` (§5.2 of `pi.md`). Not observed on the inspected machine. |
| `context_edit` entry type | entries | Append-only context rewrite; `replacement` is content. Presence only. Not observed on the inspected machine. |
| `assistant.durationMs`, `toolResult.durationMs` | messages | Provider/tool durations measured with a monotonic clock and **persisted**. Tool durations become direct (§4.3) instead of a timestamp delta; assistant duration has no contract column. |
| `toolResult.nestedCalls` | tool results | Bounded metadata for calls a tool made to other tools (observed only for `codemode`). `arguments` and `error` are content; `name`/`status`/`durationMs` are metadata. |
| `assistant.thinkingLevel` | messages | Per-response level; `effort` can use it as a fallback. |
| `compaction.systemMessage` | compaction | Content (prompt checkpoint) — excluded. |

The Pi adapter's current behaviour on Gentle Shell data was verified: it yields bundles and
parses every file; it only reports the expected informational diagnostics
(`unknown-message-role`, `unused-model-change`, `unpriced-model`).

### 3.1 The 4.7.0 / Pi 1.5.0 delta (2026-11-10)

Structure-only rescan of the same machine after Gentle Shell moved to `gentle-pi` **4.7.0** with
**Pi 1.5.0**. The session format version is still `3`. What the scan found and what the adapter
does about it:

| Finding (counts and key names only) | Adapter response |
|---|---|
| Entry types observed for the first time: `context_edit` (≥ 11 in isolated-home parents), `compaction`, `session_info` (3). `usage`, `branch_summary` and `label` are still unobserved. | `context_edit` and `session_info` are *known* types: one `harness` step carrying the entry type, no payload, never `unknown-entry-type` (§4.3). `compaction` gains nothing beyond the Pi 1.2 fold. The three unobserved types keep their Pi 1.2 handling and require no fixture. |
| Three metadata fields in live records: assistant `message.rawStopReason` (string), `message.usage.cost.totalFromProvider` (boolean), `custom_message.display` (boolean). | All three are in the allowlist (§7) and in neither `capabilities` nor a step: they are metadata, not text. `rawStopReason` is the provider's own stop-reason string; the other two are booleans. `providerThinkingLevel` was already projected before this delta and is left untouched — nothing was invented for it. |
| Pi 1.5.0 headers may carry `parentSession` (fork/clone). Zero live occurrences in the scan — children still write no parent — so this is tolerance only. | A `parentSession` whose basename uuid names an **imported** session becomes `relation: "fork"` + `forkedFrom` (D89). Anything else imports as a root with an info `unresolved-parent-session` and no relation; the referenced path is never echoed into a bundle. |
| `gentle-agents.published-state` (`custom`): `data` keys `schema, sessionId, recordedAt, cwd, source, ownerReply, authority, state, aliases`. | A bounded orchestrator-state marker (D90): `schema`, `recordedAt`, `authority` are projected as values; `aliases` survives as an object with every alias id collapsed, i.e. presence without the values. `state` prose, `ownerReply`, `sessionId` and `cwd` are never read. |
| `gentle-pi.review-reminder-receipt/v1` (`custom`, `source: 'subagent'`) carries `taskId` + `toolCallId`. | Secondary spawn-linkage source (D90, §5.1): it fills `spawnCallId` only where no `gentleAgents` `toolResult` supplied one, and such a resolution emits an info `receipt-spawn-link` (count only). The toolResult identity always wins. |
| `gentle-pi.exploration-budget` (`custom_message` with `details`). | Presence only, like every other extension `custom_message`: `customType` and `display` survive, `content` and `details` do not. |
| The other live `customType`s are unchanged: `gentle-pi.session-worktree/v1`, `gentle-pi.session-change/v1`, `gentle-agents.stale-result`, `gentle-agents.result`, `gentle-agents.message`, `gentle-todo-state`. | Presence only. |
| Ledger `task` key set (S4). | §2.2 records the observed keys and the two absent optional ones. |
| `items[].kind` ∈ `text\|thinking\|note\|tool` in the task thread; `limits {maxItems: 400, maxOutputChars: 16000}`. | Unchanged: the thread is never read (§2.2, §5.3). |

**Caveat: the projection is per key, not per `customType`.** `project()` cannot express "inside
`gentle-agents.published-state`, `schema` is metadata and `state` is content" — a key is
projectable only when it is metadata under *every* observed `customType`. That is why
`data.aliases` is an empty rule (presence-only; the mechanism cannot turn a string leaf into a
boolean, and alias ids have unknown length) and why `data.state` stays out entirely. §7 lists each
surviving key next to its hazard; a per-`customType` projection is the follow-up if a future
`customType` reuses one of those key names for content.

## 4. What Runwire can obtain

### 4.1 Capabilities

**16 of 20 declarable** — the 14 Pi declares plus `subagents` and `initiator`:

`usage.perCall`, `usage.cumulative`, `usage.cacheWrite`, `usage.reasoning`, `timing`, `model`,
`effort`, `turns`, `toolCalls`, `compactions`, **`subagents`**, `cost`, **`initiator`**,
`steps.errors`, `steps.harness`, `steps.toolDurations`.

**4 unavailable**: `mode`, `version`, `title`, `git`.

### 4.2 `Session` fields

| Runwire field | Source | Notes |
|---|---|---|
| `id` | `gentle-shell:<uuid>` from the **filename** | Header `id` matched the filename uuid on 331/331 files; a mismatch is a diagnostic |
| `harnessId` | `gentle-shell` | |
| `projectKey` | `resolveProject({ cwd: header.cwd })` | Same pure walk as Pi; children have their own header `cwd` (their launch dir, possibly a worktree) |
| `cwd` | `header.cwd` | Flat child dirs have no project dirname fallback; absent → diagnostic `missing-cwd` |
| `startedAt` / `endedAt` / `durationMs` | min/max of every ISO `timestamp` | Session wall clock; idle time included, as everywhere |
| `modelPrimary` | model with the most `output` over `call` steps | Bare `responseModel ?? model`, D80 parity |
| `modelChanges` | transitions over call steps | Not from `model_change` entries (same rationale as `pi.md` §5.4) |
| `effort` | last `thinking_level_change`, else last `assistant.thinkingLevel` | Closed enum; metadata |
| `turns` | `role: "user"` messages | `system`, `bashExecution`, `custom` are not turns |
| `apiCalls` | `call` steps | assistant calls + extra-usage calls |
| `toolCalls` | `toolCall` blocks | equals `toolResult` count when all are answered (1,460/1,460 paired in the isolated home) |
| `compactions` | `type: "compaction"` | 0 in the sampled data; fixtures must synthesise it |
| `costUsd` | Σ `usage.cost.total` | Harness-reported; 0 for unpriced models (nan) → `unpriced-model` |
| `relation` / `parentId` / `agentType` / `spawnCallId` / `depth` | task ledger + parent tool results | §5 |
| `initiatorKind` / `initiatorAutomation` | child sessions only | `machine` / `subagent-dispatch`; parents stay NULL (unknown) |
| `forkedFrom` | `header.parentSession` | Fork of an **imported** session: `gentle-shell:<uuid>` with `relation: "fork"`, never `parentId`. Optional in Pi 1.5.0; a `parentSession` that names no imported session leaves a root plus `unresolved-parent-session` (D89) |
| `sourcePath` / `sourceSize` / `sourceMtime` | the file and its `stat` | `sourceId`/`sourceLocator` stay undefined (filesystem source, as Pi) |
| `title`, `modePrimary`, `harnessVersion*`, `gitBranch`, `gitCommit`, `resumed` | **unavailable** | §6 |

### 4.3 `Step` fields

| Gentle Shell / Pi record | Step | Fields |
|---|---|---|
| `message` + `assistant` + `usage` | `call` | `at` = entry ISO; `model`; five token columns |
| `toolCall` block | `tool` | `toolName`, `callId`, `toolCategory` (§4.4) |
| `message` + `toolResult` | patches the pending `tool` step | `error = isError`; `durationMs = toolResult.durationMs` (Pi 1.2) with a timestamp-delta fallback; paired strictly by `toolCallId` |
| `message` + `user` | `turn` | no duration (not persisted) |
| `type: "compaction"` | `compaction` | `preTokens`, `compactionTrigger = fromHook ? "extension" : null`; `postTokens` unavailable |
| `usage` entry / `compaction.usage` / `branch_summary.usage` / `toolResult.usage` | extra `call` | §5.2 of `pi.md`; `usage-on-non-assistant` diagnostic |
| assistant `stopReason ∈ {error, aborted}` | `harness` `call-error` / `call-aborted` | same workaround as Pi |
| `system` message | *no step* (v1) | prompt/tool loadout, content-bearing; recognised so it is not reported as unknown |
| `type: "model_change"` | *no step* | folded into model resolution |
| `type: "thinking_level_change"` | `harness` `thinking-level-change` | |
| `custom` / `custom_message` / `label` / `session_info` / `branch_summary` / `context_edit` | `harness` with the **entry type only**; the bounded `custom.data` marker (§3.1) is projected but never becomes a step | never `customType` payload, `data` beyond that marker, `content` or `replacement` |
| `session` header | *no step* | timestamps + project |

Pi 1.2 persists per-message `durationMs`, so `steps.toolDurations` no longer depends on a
timestamp subtraction. Assistant `durationMs` has no contract column; it is a candidate for a
future `call.durationMs` widening (out of scope).

### 4.4 Tool categories

Observed vocabulary: 23 tool names in the isolated home, 44 in the Pi home, 46 in the union.
Closed built-ins as in Pi, plus the Gentle Shell extension surface:

| Category | Names |
|---|---|
| `read` | `read`, `ls`, `read_symbol`, `mem_get_observation`, `mem_context`, `mem_current_project`, `mem_timeline`, `project_report`, `module_report` |
| `search` | `grep`, `find`, `codegraph`, `mem_search` |
| `write` | `edit`, `write` |
| `exec` | `bash`, `bash_background`, `codemode` |
| `plan` | `todo`, `gentle_odd_phase` |
| `agent` | `subagent_run`, `subagent_continue`, `subagent_send_message`, `subagent_parent_message`, `subagent_list_agents`, `subagent_list_tasks`, `subagent_result`, `subagent_status`, `orchestrator_session_id` |
| `web` | `fetch_content`, `web_search`, `get_search_content`, `web_enable` |
| `mcp` | the literal Pi 1.2 tool `mcp` (no `mcp__server__tool` identity to parse; category only) |
| `skill` | unreachable (Pi semantics: a skill is not a tool, D79) |
| `other` | `mem_save`, `mem_update`, `mem_doctor`, `mem_review`, `mem_session_summary`, `gentle_review`, `lens_diagnostics`, `lens_diagnostic_mark`, `pi_lens_activate_tools`, `session_worktree_register`, `ask_user_question`, `ask_user_choice`, unknown names |

As with Pi, extension names may never be *required* by a test: unknown → `other`, no diagnostic.

`codemode` results carry `nestedCalls` (`calls[].{name,status,durationMs,argumentsBytes}`,
`complete`). These are not model-issued tool calls, so they do not become `tool` steps; emit one
aggregated `nested-tool-calls` diagnostic (info, count) so the activity stays visible without
inflating `tool_calls`.

### 4.5 Token and cost semantics (verified)

- One `message` per API call; `responseId` unique across 14,777 calls in both homes (**0
  duplicates**) — no request dedup problem, unlike Claude Code.
- `totalTokens === input + output + cacheRead + cacheWrite` on every assistant message in both
  homes (**0 arithmetic drift**), so `input` and `cacheRead` are disjoint and the D5 mapping is
  a rename: `uncached_input = input`, `cached_input = cacheRead`, `cache_write = cacheWrite`,
  `output = output`, `reasoning_output = reasoning` (⊂ `output`).
- `cacheWrite` was 0 everywhere on the inspected machine (the nan/codex providers report none); the
  capability must be observed on an Anthropic-backed fixture before it is trusted.
- `cost.total` is harness-computed from Pi's pricing table. Models without a pricing entry
  (`nan/*` here) report **0** for every call — 10,516 of 14,777 in the Pi home, 617 of 1,101 in
the isolated home. The
  existing `unpriced-model` diagnostic is the honest treatment; Σ under-reports cost.
- Extra usage: Pi 1.2 adds `usage` entries and keeps `toolResult.usage`; both count toward the
  session's own totals. Emit an extra `call` step for each (model undefined when the record has
  none), exactly as Pi does for compaction/branch/tool usage.

## 5. Subagents — the reason this is a separate harness

Gentle Shell is the first Pi-family harness that can declare `subagents`. The link is entirely
in the ledger, not in the child header.

### 5.1 Deriving the link

For each `gentle-agents/tasks/<id>.json`:

| Contract field | Source |
|---|---|
| child session | `task.sessionPath` → the absolute child file (must exist) |
| `parentId` | `task.parentSessionId` → the parent **header** uuid; render as `gentle-shell:<uuid>` when the parent is in a Gentle Shell parent root, or `pi:<uuid>` when it lives in the user's Pi parent root (§6) |
| `agentType` | `task.agent` — a closed-ish vocabulary of `agents/*.md` names (`gentle-ai-explore`, `gentle-ai-verify`, `gentle-ai-worker`, `review-*`, …) |
| `relation` | `"subagent"` |
| `depth` | parent depth + 1; resolve the `parentSessionId` graph transitively (a child can itself be a parent) |
| `spawnCallId` | the parent's `toolResult` for `subagent_run` whose `details.gentleAgents.taskId === task.id`, using that message's `toolCallId`; secondarily a `review-reminder-receipt` entry (D90, below) |

`spawnCallId` is the only field that requires reading the **parent** session file: the task
record does not store the spawn call id. It is what lets core fill `steps.child_id` and connect
the parent's `subagent_run` tool step to the child. **Decision (2026-10-22 challenge):** the
scanner runs only against parents this adapter owns. When the parent lives in the user's Pi
parent root (shape B/C, labelled `pi:`), `spawnCallId` stays NULL and the gentle-shell adapter
never opens another adapter's files; the upstream ask in §5.4.1 is the real fix.

`subagent_run` results without `details.gentleAgents` (failed launches) carry no task id and are
counted as ordinary `agent`-category tool steps. `subagent_list_agents`,
`subagent_continue`, `subagent_send_message`, etc. are also ordinary `agent`-category steps.

**Secondary source (2026-11-10, D90).** A `gentle-pi.review-reminder-receipt/v1` custom entry in
the same parent can still name the spawn: with `data.source === 'subagent'` it carries `taskId` and
`toolCallId`. The adapter uses it only when the `toolResult` identity supplied nothing for that
task id — the primary source always wins — and reports the resolution with an info
`receipt-spawn-link` (count only; the receipt is never named). Every other receipt key (`root`,
`id`, `toolName`, `writerModelId`, `writerEffort`) and every other `custom.data` field stays
unread. The no-cross-read rule is unchanged: a Pi-owned parent is never opened, so a child of a
`pi:` parent keeps `spawnCallId` NULL either way.

### 5.2 What the ledger cannot give, and the measured gap

The ledger is capped (`history_max_tasks`, default 200, global) and pruned. A child whose task
was pruned has:
- no `parentSessionId` → no `parentId`, no `agentType`, no `spawnCallId`, no `depth`;
- still **full token usage**, so it must be imported as a root session, not dropped.

Measured on the inspected machine:

| Home | Children on disk | Ledger tasks | Linkable | Unlinked |
|---|---|---|---|---|
| Isolated (`~/.gentle-shell/agent`) | 16 | 15 | 15 | 1 |
| Pi home (`~/.pi/agent`) | 315 | 200 | 200 | 115 |

These are historical ledger-match counts, not guaranteed imported links: a ledger entry can
also point to a missing parent. The implementation validation below measures resolved links.
`unlinked-subagent` makes missing/pruned tasks visible rather than silently dropping children.

### 5.3 The ledger's aggregates must not be used

`TaskRecord.tokens`, `cost`, `turns` and `toolCalls` are aggregates of the child session. They
duplicate exactly what the child file reports: one verified task had `tokens = 1,780,555`, and
its child session's Σ `totalTokens` was `1,780,555`. Using them would double-count every linkable
subagent. The ledger is read for **linkage metadata only** (§5.1).

### 5.4 Upstream asks (cheap, content-free)

1. Write `parentSession` (absolute path or uuid) into the child header when the runner creates
   the child. Pi's own `newSession({ parentSession })` / `/fork` machinery already does this;
   it would make the link survive ledger pruning and remove the need for `task.sessionPath`.
2. Persist the spawn `toolCallId` (or `taskId`) in a child `custom` entry, or add a
   `gentle-pi.task/v1` entry `{ taskId, parentSessionId, agent, mode }` to the child at start.
3. Either raise/parameterise the ledger cap or write a per-session manifest of task ids; 200
   entries is smaller than the real history.

## 6. Attribution: the hard problem

Runwire identifies a harness by adapter id, and each adapter owns a disjoint source universe.
That maps cleanly to shape A but not to B/C, where Gentle Shell sessions and plain-Pi sessions
share one directory. Measured on the inspected machine:

Pre-implementation snapshot (2026-10-22); the previously missing stores now import as
`gentle-shell`, while shared-home parents still import as `pi` (D88).

| Store | Files | Assistant calls | Tokens (Σ totalTokens) | Cost | Pre-implementation Runwire label |
|---|---|---|---|---|---|
| `~/.gentle-shell/agent/sessions` | 14 | 706 | 83.6 M | $3.95 | **not imported** |
| `~/.gentle-shell/agent/gentle-agents/sessions` | 16 | 395 | 23.2 M | $6.58 | **not imported** |
| `~/.pi/agent/sessions` | 17 | 4,128 | 658.6 M | $168.19 | `pi` — 13 of 17 files carry explicit Gentle Shell `custom` entries (3,890 calls, 630.7 M tokens); 3 older files show only indirect tool-name signs (237 calls, 28.0 M); 1 is a plain 1-call session |
| `~/.pi/agent/gentle-agents/sessions` | 315 | 10,649 | 684.7 M | $49.10 | **not imported** (D81 excludes `gentle-agents/`) |

The children are the single biggest blind spot — larger than the parent store — and they are
unambiguous: only Gentle Shell writes `gentle-agents/`.

Fingerprinting a shared parent root is *possible* but not free:

- Reliable evidence: a `custom`/`custom_message` entry in the Gentle Shell namespace
  (`gentle-pi.*`, `gentle-agents.*`, `gentle-todo-state`, `gentle-jobs.*`,
  `gentle-ai-elapsed-timing/v1`). On this machine 13 of 17 Pi-home files have one (≈96 % of the
  tokens); 3 older files (Sep 8–11, ≈28 M tokens) show only indirect tool-name signs; 1 is a
  plain 1-call session.
- Unreliable evidence: tool names. `subagent_run`, `mem_*`, `gentle_review`, `lens_*` existed in
  plain Pi installs before Gentle Shell (third-party packages), so they must not decide
  ownership.
- Cost of splitting: each adapter's `known` cache is per harness, so the adapter that does *not*
  own a fingerprinted file would have to re-read it on every import to decide again. With a
  660 MB root that is real. Avoiding that permanent re-read needs B′'s negative cache, a
  harness-family contract, or an upstream header marker.

### 6.1 Options

| Option | What it does | Cost / risk |
|---|---|---|
| **A. Home-scoped v1 (implemented, D88)** | `gentle-shell` owns `<gentleHome>/sessions` + **all** `gentle-agents/sessions` trees (Gentle home and user Pi home). Pi keeps `<userPiHome>/sessions`. Shape B/C parents stay labelled `pi`. | No core change, no re-read cost, no double counting. Leaves the shared-home parent attribution as a documented gap. Children link to `pi:` parents where the ledger says so. |
| **B. Fingerprint split** | `gentle-shell` also claims fingerprinted sessions under `<userPiHome>/sessions`; `pi` skips them. | Exact for the 96 %, but needs a shared classifier, a one-time re-read of the whole Pi root, one-time row identity changes (`pi:` → `gentle-shell:`), and every subsequent run re-reads the non-owned fingerprinted files. Containment: a shared predicate module + an adapterVersion bump. |
| **B′. Fingerprint + negative cache** | Same as B, plus a per-adapter skip-decision cache keyed by path+mtime in the non-owning adapter, so fingerprinted files are not re-read on every run. | Exact for the 96 % without B's permanent re-read cost; needs adapter-local state outside the DB-derived `known` cache (a small core/adapter addition, much smaller than C). Considered in the 2026-10-22 challenge; the original analysis presented only A/B/C. |
| **C. Harness family contract** | One Pi-family adapter owns both identities; core accepts a declared set of harness ids with per-id capabilities/known/removal. | Cleanest end state with shared family ownership, but a real contract change (ARCHITECTURE §3/§6, schema, test kit, CLI report). Not justified until the product needs exact shared-home attribution. |

Decision (D88): **A implemented**, plus the upstream header marker ask. If exact re-attribution of
existing history becomes a product requirement, evaluate **B′** (fingerprint + negative cache,
no permanent re-read) before jumping to **C**; do not start with plain **B** and pay the
re-read forever. (Decision recorded 2026-10-22.)

## 7. Implemented allowlist

```ts
// Abridged: what the 4.7 delta adds on top of the Pi base in src/gentle-shell/allowlist.ts.
export const gentleShellAllowlist: Projection = {
  ...piAllowlist,                          // header, envelope, usage, toolCall blocks
  // entry-level metadata
  kind: true, customType: true,            // kind: usage entries
  display: true,                           // Pi 1.5.0 custom_message.display (boolean)
  usage: usageProjection,                   // the shared usage sub-projection, see below
  // custom entries: the ONLY data projection (bounded marker, per-key rule in §3.1)
  data: {
    schema: true, recordedAt: true, authority: true,   // gentle-agents.published-state
    aliases: {},                                       // presence only: every alias id collapses
    source: true, taskId: true, toolCallId: true,      // review-reminder-receipt spawn identity
  },
  // Pi 1.5.0 additions inside the Pi base envelope
  message: {
    ...piAllowlist.message,
    rawStopReason: true,                   // provider stop-reason string, not text
    usage: { ...usageProjection, cost: { ...usageProjection.cost, totalFromProvider: true } },
    nestedCalls: { calls: [{ name: true, status: true, durationMs: true, argumentsBytes: true }],
                   complete: true },
    // the ONLY details projection: subagent identity, no prompt/result/diff/todo text
    details: { gentleAgents: { taskId: true, agent: true, mode: true, status: true, cwd: true } },
  },
};
```

The envelope fields are spelled out in the source (shared `usage` sub-projection, `content`
limited to toolCall `{ type, id, name }`) so the Gentle Shell allowlist cannot silently diverge
from `piAllowlist`; the block above shows only what the 4.7 delta adds there.

The ledger gets its own projection (it is not a session record):

```ts
export const taskRecordAllowlist: Projection = {
  task: { id: true, agent: true, mode: true, status: true, cwd: true,
          parentSessionId: true, sessionPath: true, model: true, modelSource: true,
          thinking: true, createdAt: true, startedAt: true, endedAt: true, lastActivityAt: true },
  // never: prompt, result, error, label, lastStep, tokens/cost/turns/toolCalls, thread
};
```

Excluded hazards, each real in this data:

| Key | Contains |
|---|---|
| `system.content`, `system.sections`, `system.toolsAdded` | the full system prompt, rules, skills, project context, MCP servers and tool declarations |
| `message.content[].text / thinking / arguments` | prompts, answers, reasoning, all tool input |
| `message.content[].data` (images) | base64 image payloads |
| `toolResult.content`, `toolResult.details` | tool output; `edit` puts `diff` and `patch`; `todo` puts task titles/notes; `ask_user_*` puts question/options/custom response; `bash` puts truncation previews |
| `toolResult.errorMessage`, `diagnostics`, `nestedCalls[].arguments / error` | provider errors and nested tool input |
| `custom.data` | `gentle-todo-state` (task titles), `gentle-pi.session-change/v1` (path + before/after text = code diffs), `gentle-agents.published-state` (`state` prose, `ownerReply`, `sessionId`, `cwd`), `web-search-results` (answers/URLs), `gentle-jobs.notice`; also every receipt key except `source`/`taskId`/`toolCallId` |
| `custom_message.content / details` | `gentle-agents.result` (child answer), `gentle-agents.wake`, job notices, `gentle-pi.exploration-budget` `details` |
| `context_edit.replacement`, `compaction.summary / details / systemMessage`, `branch_summary.summary / details` | rewritten context, full summaries |
| `label.label`, `session_info.name` | user-authored text |
| ledger `prompt / result / error / label / lastStep / thread`; `transcripts/*.md` | child prompt/answer/transcript |

## 8. Diagnostics

| Code | Level | Meaning |
|---|---|---|
| `malformed-json-line`, `invalid-record`, `oversized-line`, `source-truncated` | warn/info | as Pi |
| `unknown-entry-type` | info | aggregated; Gentle Shell extensions and newer Pi types make it expected |
| `unknown-message-role` | info | e.g. `bashExecution`; `system` is *known* |
| `missing-session-header` | warn | identity taken from the filename |
| `session-id-mismatch` | info | header `id` ≠ filename uuid |
| `missing-cwd` | info | no header cwd and no project dirname fallback (flat children) |
| `legacy-format` | info | absent header version / v1-shaped entries |
| `unpaired-tool-result`, `unanswered-tool-call` | info | aggregated |
| `branched-tree` | info | >1 root or >1 leaf |
| `usage-on-non-assistant` | info | extra `call` steps from `usage`/tool/compaction/branch usage |
| `nested-tool-calls` | info | aggregated; `codemode` nested calls counted, not stepped |
| `unpriced-model` | info | tokens with `cost.total === 0` (nan here) |
| `unlinked-subagent` | info | child session with no matching ledger task (pruned or missing) |
| `orphan-parent` | info | ledger `parentSessionId` resolves to no imported parent file |
| `unresolved-parent-session` | info | header `parentSession` names no imported session: root session, no `forkedFrom` (D89) |
| `receipt-spawn-link` | info | `spawnCallId` resolved only from a `review-reminder-receipt` entry (D90) |
| `ledger-invalid` | info | unparseable/invalid task file, aggregated |
| `duplicate-child` | info | the same child uuid found under two homes; one bundle emitted |
| `session-read-failed` | error | stub bundle instead of throwing |

## 9. Package plan — outcome

**Shape 1 implemented (D84):** two factories in `packages/adapter-pi`, with plain Pi modules
under `src/pi/` and Gentle Shell modules under `src/gentle-shell/`. Both factories are
registered in the CLI. Pi behaviour and the core-only adapter import boundary are unchanged.
The full fixture suite and `adapterContract` pass on `fixtures/gentle-shell/all`.

Alternatives considered:

1. **Pi-family package (chosen).** `createPiAdapter()` and `createGentleShellAdapter()` expose
   distinct harness identities from one package. The Pi reader and parameterised compute fold
   are reused; no new shared-format dependency or core boundary is required.
2. **Shared format package.** `packages/pi-format` (`@runwire/pi-format`) with the reader,
   schemas and fold; `adapter-pi` and `adapter-gentle-shell` both depend on it. Requires a
   `.dependency-cruiser.cjs` change: adapters may import core + `@runwire/pi-format`. Cleaner
   package names, one extra concept and rule.
3. **Copy.** A standalone `packages/adapter-gentle-shell` copied from `adapter-pi`. Zero
   boundary work, but duplicates the Pi 1.2 delta and the token arithmetic, and the two will
   drift.

Files (shape 1):

```text
packages/adapter-pi/
  src/index.ts               createPiAdapter + createGentleShellAdapter
  src/pi/…                   today's Pi modules (unchanged behaviour)
  src/gentle-shell/paths.ts   agent-home and parent/child root resolution
  src/pi/compute.ts          shared parameterised fold (Pi 1.2 is opt-in)
  src/gentle-shell/index.ts   Gentle Shell factory and capabilities
  src/gentle-shell/allowlist.ts
  src/gentle-shell/ledger.ts  task projection, child uuid → linkage metadata
  src/gentle-shell/tool-category.ts
  src/gentle-shell/discover.ts probe + parents + children + dedupe + known + spawn/depth graph
fixtures/gentle-shell/<case>/home/.gentle-shell/agent/…
```

- **Roots:** parents `<gentleHome>/sessions`, children `<gentleHome>/gentle-agents/sessions`
  **and** `<userPiHome>/gentle-agents/sessions`. `gentleHome =
  env.GENTLE_PI_AGENT_HOME ?? <home>/.gentle-shell/agent`; `userPiHome =
  env.GENTLE_SHELL_USER_PI_HOME ?? <home>/.pi/agent`, mirroring Gentle Shell's own rule.
- **Never scan the same parent root as Pi.** When `gentleHome` resolves to `userPiHome` (shape
  C), skip the parent root; children remain in scope.
- **Probe roots must be the stable candidates**, not only the ones that currently exist:
  `loadKnown` scopes stored rows by `probe.roots`, so a root omitted on the day it disappears
  would leave its sessions in the DB forever. Return every candidate root; `installed` is true
  when any exists.
- **Dedupe** children across the two homes by filename uuid (the id Gentle Shell's own stats
  uses: more usage records, then most recent mtime); emit `duplicate-child` (info, count).
- **Order:** parents first, then children sorted by uuid; uuidv7 names keep the stream
  deterministic. Spawn indexes are read lazily from owned parent files when children need them.
- **Failure mode:** a root that vanished after enumeration throws (D83); a child whose parent
  cannot be resolved still yields a bundle (root + diagnostic), never an exception.
- **Product integration:** registered in `packages/cli/src/adapters.ts` after Pi (D25).
  `packages/web/src/components/harness-identity.tsx` explicitly documents the neutral fallback.

### Fixtures

| Case | Purpose |
|---|---|
| `small/` | one parent, linear, monotonic timestamps: `timing`, tool durations, zero diagnostics |
| `subagents/` | parent + child + ledger: `parentId`, `relation`, `agentType`, `spawnCallId`, `steps.child_id` after import; ledger aggregates ignored. The second child is linked only by a `review-reminder-receipt` entry, which must emit `receipt-spawn-link` while the toolResult-linked child stays quiet |
| `published-state/` | `gentle-agents.published-state` custom entry + `gentle-pi.exploration-budget` custom_message: `custom` harness steps, none of the `data`/`content` text in a bundle |
| `unlinked/` | child with no ledger task: root + `unlinked-subagent`; still counted |
| `cross-home/` | child under a Pi home whose parent is imported as `pi:<uuid>` (shape A's cross-link) |
| `extra-usage/` | `usage` entry, `toolResult.usage`, `compaction`/`branch_summary` usage: Σ-over-`call` invariant |
| `new-format/` | `system` message, `context_edit`, `durationMs`, `nestedCalls` (codemode), Pi 1.2 shape |
| `malformed/` | broken JSON line, truncated final line, invalid ledger file |
| `canary/` | `RUNWIRE_CANARY_<n>` in every content key (§7), including `system.sections`, `custom.data`, `custom_message.details`, `details.diff/patch`, ledger `prompt/result/thread` |
| `all/` | union for the capability check; unlike Pi, `fork/` may be included because this adapter declares `subagents` |

## 10. What is unavailable

| Missing | Why | Consequence |
|---|---|---|
| `mode` | Permission mode is a **machine-global policy file** (`permission-mode-policy.ts`), not persisted per session. Auto-permission decisions (`gentle-auto-permission`) are per tool call, not a session mode. | NULL; D51 signals 2/3 stay unaffected |
| `version` | The header carries the **format** version (3), not the Gentle Shell/Pi CLI version. Versions exist only machine-level (`config.json`, `versions/`, `lastChangelogVersion`). | NULL; a mapping break cannot be attributed to a release. Upstream ask: write `gentleVersion`/`piVersion` in the header. |
| `title` | Only Pi's `session_info.name` (user-authored) and the presence-label fallback exist. D7's exception is for harness-generated titles; D78 keeps user-authored names out. | NULL. A future opt-in would need a D7 widening decision. |
| `git` | Not persisted. The session-worktree entry stores a worktree **root**, not branch/commit; reading `.git/HEAD` at import time would report today's branch. | NULL. Upstream ask: `git.{branch,commit}` in the header. |
| `resumed` | `-c`/`-r` append to the same file with no marker. | NULL |
| Call latency | `assistant.durationMs` is persisted but the contract has no `call.durationMs`. | Available but unused; candidate contract widening |
| Skill usage | Skills are not tools (Pi semantics); only a `read` argument path would reveal one, and that is tool input. | `skill` not declarable (D79) |
| `--no-session` runs | Nothing written. | Invisible by construction |
| Origin of unlinked children | Ledger pruned; child header has no parent. | Root session + `unlinked-subagent`; upstream ask §5.4 |

## 11. Decided outcomes (2026-10-22)

1. **Attribution scope** — A (home-scoped) vs B′ (fingerprint + negative cache) vs C (harness
   family). Decided (2026-10-22): **A now**, upstream marker ask; B′ before C if history
   re-attribution is ever required.
2. **Subagents** — declared; child sessions import from every configured `gentle-agents/`
   tree, accepting the measured unlinked history and the ledger-pruning diagnostic (D85).
   Decided (2026-10-22): yes, and `spawnCallId` resolves only from gentle-shell-owned parents —
   NULL for `pi:` parents, no cross-read (§5.1).
3. **`initiator`** — declared: children `machine` / `subagent-dispatch`, parents NULL (D86).
   The contract kit accepts this mix on `fixtures/gentle-shell/all`; the fallback is unnecessary.
4. **Package shape** — shape 1 implemented: two factories in `packages/adapter-pi`, `src/pi/`
   and `src/gentle-shell/` (D84). No shared-format package or boundary change.
5. **Pi 1.2 refresh** — Gentle Shell handles Pi 1.2 now. Plain Pi behaviour is preserved;
   refreshing that adapter is separate follow-up work, not part of this adapter.
6. **Harness order and naming** — registered as `gentle-shell` after Pi (D25/D84), display
   name “Gentle Shell”. The web intentionally uses its neutral glyph with this display label.
7. **Unavailable signals** — `mode`, `version`, `title`, `git` stay undeclared (D87); header
   version 3 is a format version, not a CLI release.
8. **Fork links only to imported sessions (2026-11-10)** — a Pi 1.5.0 header `parentSession`
   becomes `relation: "fork"` only when its uuid is one of the sessions being imported; anything
   else is a root plus `unresolved-parent-session` (D89). This keeps the adapter from claiming a
   link to a `pi:` session it does not own.
9. **4.x metadata sources (2026-11-10)** — the receipt is a secondary spawn-linkage source and the
   toolResult identity always wins; `gentle-agents.published-state` is projected as a bounded
   presence marker, never its `state` prose (D90).

## Implementation validation (2026-10-22)

Counts only, from the registered CLI on the inspected machine. This later snapshot does
not replace the historical investigation in Appendix A.

| Store | Imported sessions | Resolved parent links | Agent type / positive depth | Spawn call ids |
|---|---|---|---|---|
| Gentle-home parents | 17 | 0 | 0 | 0 |
| Gentle-home children | 19 | 17 | 17 | 17 |
| Pi-home children | 315 | 154 | 154 | 0 |

`discover --adapter gentle-shell --json` emitted 351 valid NDJSON bundles (17 parents,
334 children), with 171 resolvable links. A fresh full import persisted all 351 with zero
failed bundles and a `harnesses` row declaring 16 capabilities. All 154 Pi-parent links have
NULL spawn call ids, as required by the no-cross-read rule.

For cross-harness links, import Pi as well: a Gentle-only import into an empty DB cannot
retain links to absent Pi rows (core clears orphan `parent_id`). Importing Pi later does not
restore a cleared link on an unchanged cached child; a fresh full import or forced reimport
is needed. The full-import check cleared the live Pi directory override so Pi owned its normal
home, rather than overlapping the isolated Gentle home.

## Appendix A — reference-machine measurement (2026-10-22)

Structure-only. Two homes, 362 session files and 215 ledger tasks inspected.

| | Isolated home | Pi home |
|---|---|---|
| Parent files | 14 (11 with usage) | 17 (17 with usage) |
| Parent assistant calls | 706 | 4,128 |
| Parent tokens (input + cacheRead + cacheWrite + output) | 83,553,298 | 658,640,190 |
| Parent cost reported | $3.95 | $168.19 |
| Child files | 16 | 315 |
| Child calls | 395 | 10,649 |
| Child tokens | 23,169,985 | 684,676,997 |
| Child cost reported | $6.58 | $49.10 |
| Ledger tasks | 15 | 200 |
| Linkable children | 15 / 16 | 200 / 315 |
| Session format | 3 | 3 |
| Header `id` vs filename uuid | match 100 % | match 100 % |
| `responseId` duplicates | 0 | 0 |
| `totalTokens` arithmetic drift | 0 | 0 |
| Zero-cost calls (unpriced `nan/*`) | 617 (of 1,101) | 10,516 (of 14,777) |
| Record types seen | message, custom, custom_message, model_change, thinking_level_change, session, context_edit | same |
| Pi 1.2 types not observed | `usage`, `compaction`, `branch_summary`, `label`, `session_info` | `usage`, `label`, `session_info` |
| `nestedCalls` | 21 (codemode only) | present |
| Custom types seen | `gentle-pi.review-reminder-receipt/v1`, `gentle-pi.session-change/v1`, `gentle-agents.published-state`, `gentle-todo-state`, `gentle-pi.session-worktree/v1`, `web-search-results`, `gentle-agents.result`, `gentle-jobs.notice`, `gentle-agents.wake` | same family + `gentle-ai-elapsed-timing/v1`, `gentle-agents.message`, `gentle-agents.stale-result`, `engram-effective-session`, `mcp-oauth-status` |
| Tool names | 23 | 44 (46 in the union of both homes) |
| Task ledger cap | `history_max_tasks = 200` (default) | same; 200 files, 250 `subagent_run` task ids in the two parents |
