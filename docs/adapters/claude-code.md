# Adapter: Claude Code

Status: being re-implemented against the 2026-09-04 contract (D68–D74); the mappings below are unchanged.

Based on structure-only inspection of CLI versions 2.1.22x–2.1.251 on macOS (2026-08-29). Validated on the reference machine (2026-08-30): 731 sources (367 root, 364 subagent), zero parse failures, cold scan 1.3 s / warm rescan 22 ms. Fields marked *(newer)* were only seen in the latest versions.

## Location and layout

| | Path |
|---|---|
| Root | `~/.claude/projects/` (Windows: `%USERPROFILE%\.claude\projects\`) |
| Project dir | `<root>/<cwd with path separators replaced by "-">/` — lossy; **never used as the project key** |
| Root session | `<projectDir>/<sessionId>.jsonl` |
| Subagent | `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl` + `agent-<agentId>.meta.json` |
| Ignored | `<projectDir>/sessions-index.json` (contains first prompt and summary), `<projectDir>/memory/`, `<sessionId>/tool-results/`, `~/.claude/history.jsonl`, `~/.claude/stats-cache.json`, `~/.claude/sessions/` |

`session.id`: `<sessionId>` for roots, `<sessionId>/<agentId>` for subagents. `parent_id` = `<sessionId>` from the directory nesting. `source_path` = the `.jsonl` path.

## Data flow

`discover(ctx, known)` yields one `SessionBundle` per source file:

1. Walk `~/.claude/projects/*/` with `readdir`/`stat`: `<sessionId>.jsonl` (root) and `<sessionId>/subagents/agent-*.jsonl` (subagent).
2. Skip a source whose `(size, mtime)` matches `known`. A subagent is reprocessed together with its parent.
3. Stream the file line by line: JSON-parse, project through the allowlist, schema-check. Content fields never leave the line.
4. Resolve the project from the first allowlisted `cwd` (D8/D9); fall back to decoding the directory name (diagnostic `cwd-from-dirname`).
5. Map records to `steps[]` in source order (table below). For a subagent, read `.meta.json` for the link fields.
6. Compute the `Session`: one usage per `requestId`, `model_primary` = model with most output tokens, token totals, `turns`, `api_calls`, `tool_calls`, `compactions`, `duration_ms` = last − first timestamp, `session_tool_counts` from step categories, initiator.
7. Emit `{ project, session, steps, diagnostics }`.

Core links parent/child over `child_id` ([ADR 0001](../adr/0001-exact-child-linking-via-viacallid.md)) and computes rollups; the adapter never sums across sessions. See [ARCHITECTURE.md §4](../ARCHITECTURE.md#4-what-an-adapter-computes).

## Record types and what is taken from them

Records are one JSON object per line. Top-level `type` drives the mapping.

| `type` | Produces | Fields used |
|---|---|---|
| `assistant` | `Step kind=call`, one per `requestId` (`model`, token columns) → token totals, `api_calls`, `model_primary`, `effort`; `Step kind=model-change` (`from_value`/`to_value`) → `model_changes`; `Step kind=tool` per `tool_use` block (`tool_name`, `tool_category`, `call_id = id`) → `tool_calls`, `session_tool_counts` | `requestId`, `timestamp`, `effort`, `message.model`, `message.stop_reason`, `message.usage.{input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens, output_tokens_details.thinking_tokens}`, `message.content[].{type, name, id}` |
| `user` | `Step kind=turn` → `turns` when not `isMeta` and no `tool_result` block; each `tool_result` block closes the `tool` step with the same `call_id` (`error = is_error`) | `timestamp`, `isMeta`, `isCompactSummary`, `message.content[].{type, tool_use_id, is_error}` |
| `system` / `subtype: compact_boundary` | `Step kind=compaction` (`compaction_trigger`, `pre_tokens`, `post_tokens`) → `compactions` | `compactMetadata.{trigger, preTokens, postTokens}` |
| `system` / `subtype: turn_duration` | `Step kind=turn` with `duration_ms` (replaces the `user`-derived turns when present) | `durationMs`, `timestamp` |
| `system` (other subtypes) | timestamps only (`started_at` / `ended_at`) | `timestamp` |
| `permission-mode` | `Step kind=mode-change` (`from_value`/`to_value`) → `mode_primary`, `mode_changes` | `permissionMode` |
| `cost-state` *(newer)* | `cost_usd` (last one wins) | `totalCostUSD` |
| `ai-title` | `title` (only when `privacy.titles`) | `aiTitle` |
| any record | `cwd` (first value → project identity), `git_branch`, `harness_version_first` / `harness_version_last`; `entrypoint` (first value wins) → initiator | `cwd`, `version`, `gitBranch`, `entrypoint` |
| `attachment` | `Step kind=harness` named `hook:<event>` for `attachment.type` ∈ `hook_success` / `hook_system_message`; `permission` for `command_permissions`; `plan-mode` / `plan-mode-exit` / `auto-mode` for `plan_mode` / `plan_mode_exit` / `auto_mode`. Other attachment types (`total_tokens_reminder`, `file`, `edited_text_file`, deltas…) ignored | `attachment.type`, `attachment.hookName` |
| `agent-setting` | nothing directly; its *presence* is the dispatch-marker signal for initiator — the payload is never read | `type` only |
| `last-prompt`, `agent-name`, `mode`, `atis-latch`, `bridge-session`, `queue-operation`, `file-history-*`, `summary` | nothing (known-ignored) | — |
| unknown `type` | one aggregated `unknown-record-type` diagnostic per file | — |
| `.meta.json` (subagent) | `parent_id` (directory nesting), `relation = subagent`, `agent_type`, `depth = spawnDepth`; `toolUseId` = `call_id` of the parent's spawning `tool` step, which receives `child_id` | `agentType`, `spawnDepth`, `toolUseId` |

`promptSource` is allowlisted (visible in diagnostics) but not read by any mapping — see "Initiator". `<synthetic>` as `message.model` is ignored for model tallies; its usage is kept (it carries real numbers). `.meta.json` `description` is not read. Teammate records (`toolUseResult.team_name`) are not parsed; teammates appear only if they have their own subagent files.

## Allowlist (projection)

Mirror of `src/allowlist.ts`; kept in step by hand.

```ts
{
  type: true, subtype: true, uuid: true, parentUuid: true, requestId: true,
  timestamp: true, cwd: true, version: true, gitBranch: true,
  isSidechain: true, isMeta: true, isCompactSummary: true, agentId: true,
  entrypoint: true, promptSource: true, effort: true,
  permissionMode: true, durationMs: true, totalCostUSD: true, aiTitle: true,
  compactMetadata: { trigger: true, preTokens: true, postTokens: true },
  message: {
    role: true, model: true, stop_reason: true,
    usage: { input_tokens: true, cache_read_input_tokens: true, cache_creation_input_tokens: true,
             output_tokens: true, output_tokens_details: { thinking_tokens: true } },
    content: [{ type: true, name: true, id: true, tool_use_id: true, is_error: true }],   // arrays: projection applied per element
  },
  attachment: { type: true, hookName: true },
}
```

Explicitly excluded: `message.content[].text|input|thinking|content` (content), everything in `attachment` except `type` and `hookName` (attachments embed file contents, hook stdout and injected context), `toolUseResult` (tool output), `lastPrompt`, `agentName`, `slug` (prompt-derived), `summary`, `agentSetting` (a user-authored agent name — only the *presence* of the `agent-setting` record is read).

`entrypoint` and `promptSource` are closed-ish enums the CLI emits — no user- or model-authored content, admissible under D7 like `model`/`mode`/`stop_reason`. The dev-only fixture redactor (`scout fixture`) keeps their value only when it is in `CLAUDE_CODE_ENTRYPOINTS` / `CLAUDE_CODE_PROMPT_SOURCES` (`src/initiator.ts`); anything else degrades to filler.

## Usage mapping

| Column | Source |
|---|---|
| `uncached_input` | `usage.input_tokens` |
| `cached_input` | `usage.cache_read_input_tokens` |
| `cache_write` | `usage.cache_creation_input_tokens` |
| `output` | `usage.output_tokens` (includes reasoning) |
| `reasoning_output` | `usage.output_tokens_details.thinking_tokens`; NULL when absent |

**Deduplication is mandatory.** One API response is written as several `assistant` records (text block, tool-use block…) that share `requestId` and repeat the same `usage`. Reference session: 782 assistant records, 386 distinct `requestId`s; naive `output` sum 1 117 279 vs deduped 438 086. One `call` step per `requestId`; records without `requestId` are treated as unique.

`cost_usd` = `totalCostUSD` of the last `cost-state` record (harness-reported). Whether it includes subagent usage is unverified.

## Initiator

`classifyInitiator` (`src/initiator.ts`) fills `initiator_kind`, `initiator_surface`, `initiator_automation`. Two signals, both allowlisted closed-ish enums:

- **`entrypoint`** — the surface the session came in on. First observed value wins (repeated on most records).
- **presence of an `agent-setting` record** — the dispatch marker Claude Code writes when another agent framework started the session. Orthogonal to `entrypoint`; payload never read.

| Machine surfaces (`initiator_kind = machine`) | `initiator_automation` |
|---|---|
| `sdk-cli`, `sdk-ts`, `sdk-py` | `sdk` |
| `claude-code-github-action` | `ci` |
| `mcp`, `bench`, `local-agent`, `local_agent`, `claude-security`, `remote`, `remote_baku`, `remote_cowork`, `remote_trigger`, `remote_cowork_trigger`, `remote_desktop`, `remote_mobile` | NULL |

| Human surfaces (`initiator_kind = human`) |
|---|
| `cli`, `claude-desktop`, `claude-desktop-3p`, `claude-vscode`, `ssh-remote`, `claude_in_slack`, `claude-in-slack`, `claude-in-teams`, `claude-coworker`, `claude-coworker-terminal` |

- Unrecognized `entrypoint` → `initiator_kind = unknown`, surface kept; never a failure.
- No `entrypoint`, no marker → all three columns NULL.
- No `entrypoint`, marker present → `machine` / `unknown` / `subagent-dispatch`.
- Marker on a non-machine verdict → `machine`, surface kept, `subagent-dispatch`. A machine `entrypoint` is never overridden.
- `promptSource` is not an input: its `sdk` value is emitted by both SDK sessions and the `claude-desktop` surface.

Measured (reference machine, 2026-09-01): 383 roots → 318 `machine` (308 by `entrypoint`, 10 by marker alone), 64 `human`/`cli`, 1 `human`/`claude-desktop`. Machine-started sessions are ~83 % of rows but ~2–3 % of token mass; this is row-count cleanup, not a cost view.

## Tool categories

`claudeCodeToolCategory(name)` (`src/tool-category.ts`, D31). Names observed in one large session: Bash 153, Agent 43, Read 38, Edit 28, `mcp__chrome-devtools__*` 41, SendMessage 16, AskUserQuestion 13, ToolSearch 6, Skill 5, Write 4.

| Category | Claude Code tool names |
|---|---|
| `read` | `Read`, `NotebookRead`, `LS` |
| `search` | `Grep`, `Glob`, `ToolSearch` |
| `write` | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` |
| `exec` | `Bash` |
| `plan` | `TodoWrite`, `EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion` |
| `agent` | `Agent`, `Task`, `SendMessage`, `ListAgents` |
| `web` | `WebFetch`, `WebSearch` |
| `mcp` | any `mcp__*` |
| `skill` | `Skill` |
| `other` | everything else (`Artifact`, `SendUserFile`, …) |

Harness event vocabulary (`claudeCodeHarnessEventNames`): `hook:<hookEvent>` (the part of `hookName` before `:`; e.g. `hook:PreToolUse`, `hook:Stop`, `hook:UserPromptSubmit`), `permission`, `plan-mode`, `plan-mode-exit`, `auto-mode`. The tool name after the colon is dropped so the vocabulary stays finite.

## Capabilities

`usage.perCall`, `usage.cacheWrite`, `usage.reasoning`, `timing`, `model`, `mode`, `effort`, `version`, `turns`, `toolCalls`, `compactions`, `subagents`, `cost` *(newer versions only — declared; absence in old files shows as NULL)*, `title`, `git` (branch only), `initiator`, `trace.blocks`, `trace.errors`, `trace.harnessEvents`.

## Known variations

- `version` changes inside one file (CLI upgraded mid-session) → `harness_version_first` ≠ `harness_version_last`.
- `cwd` changes inside one file (`cd` in the session; 7 distinct values observed) → first cwd is the project anchor; the others are not stored.
- ~3 % of files have no `cwd` in their first records → fall back to decoding the directory name; diagnostic `cwd-from-dirname`.
- `cost-state` and `turn_duration` exist only in newer versions (0/60 and 19/60 of older files sampled).
- Files up to 28 MB; one project directory reached 127 MB / 40 sessions.
- `isSidechain: true` appears only in subagent files; a root file with sidechain records is treated as a root and gets diagnostic `unexpected-sidechain`.
- Assistant content block types in one session: `tool_use` 358, `thinking` 229, `text` 195 — one block per record, so per-call block counts must be summed across `requestId` duplicates.
- `tool_result.is_error` was `true` on 8 of 358 results; `stop_reason` ∈ `tool_use`, `end_turn`, `stop_sequence`.
- Hook attachments are ~1 000 per large session (Pre/PostToolUse for every call); the timeline hides them by default.
- `PostToolUseFailure:<tool>` is a real hook event, alongside `PreToolUse`/`PostToolUse`.
- `agent-setting` (`{ type, agentSetting, sessionId }`) is a real top-level record type — a session-scoped setting marker, no timestamp or usage. Payload unread; presence is the dispatch-marker signal (see "Initiator").

## Fixtures

Generated from real sessions on the reference machine via `scout fixture` (the dev-only redactor), except `malformed/` and `canary/`, which are hand-written. `all/` is a generated union of the others, used only so the contract test kit's capability-consistency check sees the full repertoire in one `discover()` view.

| Fixture | Source | Purpose |
|---|---|---|
| `small/` | a short real session | one root, no subagents, no diagnostics |
| `medium/` | the reference session (`3666e64a…`) | the dedupe regression — deduped `output` must equal 438 086, not the naive 1 117 279 |
| `subagents/` | a real session with 2 subagents, a compaction, a version change and a model change | root + 2 subagents linked with `agent_type`/`depth`/`child_id`; rollups include both children. Both subagents are at `spawnDepth: 1`; nested-depth tree computation is proven in core, not here |
| `old-version/` | a real session on CLI 2.1.234 | no `cost-state`, no `turn_duration`; turns derived from user-message heuristics |
| `malformed/` | hand-written | a broken JSON line and a truncated final line, both mid-file so records before and after still parse. The oversized-line path is exercised in-memory in `index.test.ts`, not via an 8 MB fixture |
| `canary/` | hand-written | every content field = a unique `SCOUT_CANARY_<n>` sentinel, except `aiTitle` (a different, unchecked sentinel — the sanctioned D7 exception that legitimately reaches `title`) |
| `all/` | generated | union of every fixture above, for the contract test kit's capability-consistency check only (see `all/README.md`) |
