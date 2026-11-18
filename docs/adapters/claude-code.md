# Adapter: Claude Code

Status: implements the 2026-09-04 contract (D68–D74), `adapterVersion: '2.1.0'`. `discover(ctx, known)` computes every `SessionBundle` field itself (records.ts + compute.ts + project.ts); core only validates, persists, links and rolls up.

Based on structure-only inspection of CLI versions 2.1.22x–2.1.251 on macOS (2026-08-29). Validated on the inspected machine (2026-08-30): 731 sources (367 root, 364 subagent), zero parse failures, cold scan 1.3 s / warm rescan 22 ms. Fields marked *(newer)* were only seen in the latest versions.

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

`discover(ctx, known)` (`discover.ts`) yields one `SessionBundle` per source file:

1. Walk `~/.claude/projects/*/` with sorted `readdir`/`stat`: `<sessionId>.jsonl` (root) and `<sessionId>/subagents/agent-*.jsonl` (subagent).
2. **Known rule** (stat/readdir only, no parsing): for each root `R`, let `C` be the sorted `agent-*.jsonl` files under `<R minus .jsonl>/subagents/` (`[]` when the dir is missing). Skip `R` and every file in `C` **iff `R` and every file in `C`** match `known`'s `(size, mtime)`; otherwise emit `R` then every file in `C`, in sorted order, regardless of each child's own `known` state — a subagent is always reprocessed together with a changed parent (and vice versa). A `<id>/subagents/` directory whose own `<id>.jsonl` root is absent is emitted the same way, judged only by its children's own `known` state.
3. Read the file (`records.ts`): stream line by line, JSON-parse, project through the allowlist, schema-check. Content fields never leave the line. Yields `{ record, line }` plus line-level diagnostics (`malformed-json-line`, `invalid-record`, `oversized-line`, `source-truncated`, `unknown-record-type`).
4. Compute the bundle (`compute.ts`), folding every record in one pass: resolve the project from the first allowlisted `cwd` (D8/D9), falling back to decoding the directory name (diagnostic `cwd-from-dirname`) when no record carries one; map records to `steps[]` in source order (table below), pairing `tool_use`/`tool_result` **strictly by `tool_use_id`** (an unmatched result is not a step, counted in one aggregated `unpaired-tool-result` diagnostic); compute the `Session`: one usage per `requestId`, `model_primary` = model with most output tokens (ties → first seen), `mode_primary` = most frequent mode, token totals, `turns`, `api_calls`, `tool_calls`, `compactions`, `duration_ms` = last − first valid timestamp, initiator. For a subagent, `discover.ts` reads `.meta.json` first for the link fields (`parent_id`, `agent_type`, `depth`, `spawn_call_id`); a missing or unparseable file still yields a bundle, diagnosed `missing-agent-meta` / `invalid-agent-meta`.
5. Emit `{ project, session, steps, diagnostics }`. A per-source read failure (e.g. the file vanished after `stat`) yields a stub bundle with diagnostic `source-read-failed` instead of throwing.

Fail-closed walk: a root that vanished after `probe` and a directory the parent `readdir` returned that disappeared (`stat` undefined) or turned unreadable (EACCES/EIO, which `RunwireFs` rethrows — [ARCHITECTURE.md §3](../ARCHITECTURE.md#3-contract)) before its own listing make `discover` throw instead of silently skipping them. `importAll` then keeps stored history and clears the completion marker rather than pruning an incomplete tree. An absent optional `<id>/subagents/` dir or `.meta.json` stays tolerated. This is a point-in-time check, not an atomic filesystem snapshot.

Core links parent/child over `child_id` (matched by `spawn_call_id`) and computes rollups; the adapter never sums across sessions. See [ARCHITECTURE.md §4](../ARCHITECTURE.md#4-what-an-adapter-computes).

## Diagnostics

| Code | Level | Meaning |
|---|---|---|
| `malformed-json-line` | warn | A line did not parse as JSON. |
| `invalid-record` | warn | A line parsed but failed the record schema. |
| `oversized-line` | warn | One or more lines exceeded the size cap and were skipped (aggregated, `count`). |
| `source-truncated` | info | The final line had no trailing newline; the source may be incomplete. |
| `unknown-record-type` | info | One or more records had an unrecognized `type` (aggregated, `count`). |
| `unexpected-sidechain` | warn | A root source contained `isSidechain:true` records. |
| `cwd-from-dirname` | info | No record carried a `cwd`; it was decoded (lossily) from the project directory name. |
| `unpaired-tool-result` | info | One or more `tool_result` blocks had no matching pending `tool_use` (aggregated, `count`). |
| `invalid-agent-meta` | warn | A subagent's `.meta.json` did not parse. |
| `missing-agent-meta` | warn | A subagent source has no matching `.meta.json` file. |
| `source-read-failed` | error | The source could not be read; a stub bundle was emitted instead of throwing. |

Core adds `orphan-child` (a session's declared `parent_id` never resolved) and `bundle-invalid` (a bundle failed the contract schema) at persist time — not emitted by this adapter.

## Record types and what is taken from them

Records are one JSON object per line. Top-level `type` drives the mapping.

| `type` | Produces | Fields used |
|---|---|---|
| `assistant` | `Step kind=call`, one per `requestId` (`model`, token columns; `<synthetic>` models keep usage, `model` undefined) → token totals, `api_calls`, `model_primary`, `effort`; `Step kind=model-change` (`from_value`/`to_value`) on non-synthetic transitions → `model_changes`; `Step kind=tool` per `tool_use` block (`tool_name`, `tool_category`, `model` (the emitting message's model; absent for `<synthetic>`), `call_id = id`, `skill_name` when the tool is `Skill`, `mcp_server`/`mcp_tool` when the name is a proven `mcp__server__tool` — see "MCP identity"), emitted regardless of `requestId` dedup → `tool_calls`, `session_tool_counts` | `requestId`, `timestamp`, `effort`, `message.model`, `message.usage.{input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens, output_tokens_details.thinking_tokens}`, `message.content[].{type, name, id, input.skill}` |
| `user` | `Step kind=turn` → `turns` when not `isMeta` and no `tool_result` block (only when the file has no `system/turn_duration` records); each `tool_result` block pairs strictly by `tool_use_id` with the pending `tool` step (`error = is_error`, `duration_ms` from both timestamps); an unmatched result is not a step (diagnostic `unpaired-tool-result`) | `timestamp`, `isMeta`, `message.content[].{type, tool_use_id, is_error}` |
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
    content: [{ type: true, name: true, id: true, tool_use_id: true, is_error: true, input: { skill: true } }],   // arrays: projection applied per element
  },
  attachment: { type: true, hookName: true },
}
```

Explicitly excluded: `message.content[].text|thinking|content` (content) and the rest of `input` (`input.args|input.command|input.content` — `input.skill` is now the sole allowlisted `input` key), everything in `attachment` except `type` and `hookName` (attachments embed file contents, hook stdout and injected context), `toolUseResult` (tool output), `lastPrompt`, `agentName`, `slug` (prompt-derived), `summary`, `agentSetting` (a user-authored agent name — only the *presence* of the `agent-setting` record is read), and the record-level `attributionSkill` / `attributionMcpServer` / `attributionMcpTool` fields (unverified attribution; MCP identity is parsed from the tool *name* instead, see "MCP identity").

`entrypoint` and `promptSource` are closed-ish enums the CLI emits — no user- or model-authored content, admissible under D7 like `model`/`mode`/`stop_reason`. The dev-only fixture redactor (`runwire fixture`) keeps their value only when it is in `CLAUDE_CODE_ENTRYPOINTS` / `CLAUDE_CODE_PROMPT_SOURCES` (`src/initiator.ts`); anything else degrades to filler.

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

Measured (inspected machine, 2026-09-01): 383 roots → 318 `machine` (308 by `entrypoint`, 10 by marker alone), 64 `human`/`cli`, 1 `human`/`claude-desktop`. Machine-started sessions are ~83 % of rows but ~2–3 % of token mass; this is row-count cleanup, not a cost view.

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

A `Skill` tool step also carries `Step.skillName`, the value of `message.content[].input.skill` (metadata only — the rest of the tool_use `input` is never read, D7). Non-`skill` categories leave `skillName` undefined.

### MCP identity

A tool_use whose name is a **proven** `mcp__<server>__<tool>` identity additionally fills `Step.mcpServer` / `Step.mcpTool`. Identity is parsed by `parseMcpIdentity` (`@runwire/core`, ARCHITECTURE §3): exactly three nonempty `__`-separated segments with the fixed `mcp` prefix. Both fields are present together or both absent, and the raw `Step.toolName` is always preserved verbatim.

- `mcp__plugin_engram_engram__mem_save` → `plugin_engram_engram` / `mem_save`; `mcp__chrome-devtools__new_page` → `chrome-devtools` / `new_page`. Single underscores are ordinary segment content, not separators.
- Category stays `mcp` with **no** identity for anything else: fewer/more segments (`mcp__server`, `mcp__a__b__c`), an empty segment (`mcp____tool`, `mcp__server__`), or a name that does not start with `mcp__`.
- Identity comes from the tool *name* only — tool args and output are never read (D7). Claude Code's own `attributionMcpServer` / `attributionMcpTool` record fields are **not** read: like `attributionSkill` they are not on the allowlist, and the attribution is unverified.

`toolCalls` owns `Step.mcpServer`/`Step.mcpTool` in the contract (`CAPABILITY_FIELDS`), so the capability is unchanged from the tool-name mapping above.

Harness event vocabulary (`claudeCodeHarnessEventNames`): `hook:<hookEvent>` (the part of `hookName` before `:`; e.g. `hook:PreToolUse`, `hook:Stop`, `hook:UserPromptSubmit`), `permission`, `plan-mode`, `plan-mode-exit`, `auto-mode`. The tool name after the colon is dropped so the vocabulary stays finite.

## Capabilities

`usage.perCall`, `usage.cumulative`, `usage.cacheWrite`, `usage.reasoning`, `timing`, `model`, `mode`, `effort`, `version`, `turns`, `toolCalls`, `compactions`, `subagents`, `cost` *(newer versions only — declared; absence in old files shows as NULL)*, `title`, `git` (branch only), `initiator`, `steps.errors` (tool `error` flag), `steps.harness` (`harness` steps), `steps.toolDurations` (`tool.durationMs`). `toolCalls` now also gates `Step.skillName` for `skill`-category tool steps and `Step.mcpServer`/`Step.mcpTool` for proven MCP names. No `trace.*` successor (ARCHITECTURE §3 dropped it).

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

Generated from real sessions on the inspected machine via `runwire fixture` (the dev-only redactor), except `malformed/` and `canary/`, which are hand-written. `all/` is a generated union of the others, used only so the contract test kit's capability-consistency check sees the full repertoire in one `discover()` view.

Every case except `all/` has a committed `expected.json` snapshot (`packages/adapter-claude-code/src/expected.test.ts`): `{ sessions (sorted by id, sourcePath relative to home, sourceMtime omitted), stepCounts, toolCounts, diagnostics }`, compared with `toEqual` and rewritten with `UPDATE_EXPECTED=1 bun test packages/adapter-claude-code`.

| Fixture | Source | Purpose |
|---|---|---|
| `small/` | a short real session, with synthetic monotonic ISO timestamps (1 s apart) in place of the redacted ones | one root, no subagents, no diagnostics; the only generated fixture with real timestamps, so `timing`/`steps.toolDurations` are observable outside the hand-written `canary`/`malformed` |
| `medium/` | the reference session (`3666e64a…`) | the dedupe regression — deduped `output` must equal 438 086, not the naive 1 117 279; never regenerated |
| `subagents/` | a real session with 2 subagents, a compaction, a version change and a model change | root + 2 subagents linked with `agent_type`/`depth`/`child_id`; rollups include both children. Both subagents are at `spawnDepth: 1`; nested-depth tree computation is proven in core, not here |
| `old-version/` | a real session on CLI 2.1.234 | no `cost-state`, no `turn_duration`; turns derived from user-message heuristics |
| `dispatch/` | a real `cli`-entrypoint session dispatched by another agent framework | initiator classifies `machine`/`subagent-dispatch` on the `agent-setting` marker alone, since `entrypoint` says `cli` exactly as a human terminal session would |
| `malformed/` | hand-written | a broken JSON line and a truncated final line, both mid-file so records before and after still parse. The oversized-line path is exercised in-memory in `records.test.ts`, not via an 8 MB fixture |
| `canary/` | hand-written | every content field = a unique `RUNWIRE_CANARY_<n>` sentinel, except `aiTitle` (a different, unchecked sentinel — the sanctioned D7 exception that legitimately reaches `title`). Includes a proven `mcp__canary_server__canary_tool` name (identity emitted) and an ambiguous `mcp__canary_server__canary_tool__extra` (no identity), both with canary sentinels in `input` to prove tool input never reaches the bundle |
| `all/` | generated | union of every fixture above, for the contract test kit's capability-consistency check only (see `all/README.md`) |
