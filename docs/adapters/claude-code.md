# Adapter: Claude Code

Status: **MVP adapter (M2)**. Based on structure-only inspection of CLI versions 2.1.22x–2.1.251 on macOS (2026-08-29). Fields marked *(newer)* were only seen in the latest versions.

## Location and layout

| | Path |
|---|---|
| Root | `~/.claude/projects/` (Windows: `%USERPROFILE%\.claude\projects\`) |
| Project dir | `<root>/<cwd with path separators replaced by "-">/` — lossy; **never used as the project key** |
| Root session | `<projectDir>/<sessionId>.jsonl` |
| Subagent | `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl` + `agent-<agentId>.meta.json` |
| Ignored | `<projectDir>/sessions-index.json` (contains first prompt and summary), `<projectDir>/memory/`, `<sessionId>/tool-results/`, `~/.claude/history.jsonl`, `~/.claude/stats-cache.json`, `~/.claude/sessions/` |

`sourceId`: `<sessionId>` for roots, `<sessionId>/<agentId>` for children. `parentHint` = `<sessionId>` from the directory nesting.

## Record types and what is taken from them

Records are one JSON object per line. Top-level `type` drives the mapping.

| `type` | Emits | Fields used |
|---|---|---|
| `assistant` | `usage` (dedupeKey = `requestId`, `blocks` = counts of `text` / `thinking` / `tool_use` blocks in this record, summed across duplicates), `model`, `effort`, `observed`, `toolCall` per `tool_use` block (`name`, `category`, `callId = id`) | `requestId`, `timestamp`, `effort`, `message.model`, `message.stop_reason`, `message.usage.{input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens, output_tokens_details.thinking_tokens}`, `message.content[].{type, name, id}` |
| `user` | `observed`; `turn` when not `isMeta` and no `tool_result` block; `toolResult` per `tool_result` block (`callId = tool_use_id`, `error = is_error`) | `timestamp`, `isMeta`, `isCompactSummary`, `message.content[].{type, tool_use_id, is_error}` |
| `system` / `subtype: compact_boundary` | `compaction` | `compactMetadata.{trigger, preTokens, postTokens}` |
| `system` / `subtype: turn_duration` | `turn` (replaces the derived turn count when present) | `durationMs`, `timestamp` |
| `system` (other subtypes) | `observed` | `timestamp` |
| `permission-mode` | `mode` | `permissionMode` |
| `cost-state` *(newer)* | `cost` | `totalCostUSD` (last one wins) |
| `ai-title` | `meta.title` (only when `privacy.titles`) | `aiTitle` |
| any record | `cwd`, `version` on change | `cwd`, `version`, `gitBranch` |
| `attachment` | `harnessEvent` for `attachment.type` ∈ `hook_success` / `hook_system_message` (`name = hook:<hookName>`), `command_permissions` (`permission`), `plan_mode` / `plan_mode_exit` / `auto_mode` (mode markers); other attachment types (`total_tokens_reminder`, `file`, `edited_text_file`, deltas…) ignored | `attachment.type`, `attachment.hookName` |
| `last-prompt`, `agent-name`, `mode`, `atis-latch`, `bridge-session`, `queue-operation`, `file-history-*`, `summary` | nothing (counted as known-ignored) | — |
| unknown `type` | counted; one aggregated `unknown-record-type` diagnostic per file | — |

`<synthetic>` as `message.model` is ignored for model tallies and its usage is kept (it carries real numbers).

`.meta.json` → `link { parentSourceId: sessionId, relation: 'subagent', agentType, depth: spawnDepth, viaCallId: toolUseId }`. `description` is not read. Teammate records (`toolUseResult.team_name`) are not parsed in MVP; teammates appear only if they have their own subagent files.

## Allowlist (projection)

Generated from `src/allowlist.ts` in M2. Draft:

```ts
{
  type: true, subtype: true, uuid: true, parentUuid: true, requestId: true,
  timestamp: true, cwd: true, version: true, gitBranch: true,
  isSidechain: true, isMeta: true, isCompactSummary: true, agentId: true, effort: true,
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

Explicitly excluded and why: `message.content[].text|input|thinking|content` (content), everything in `attachment` except `type` and `hookName` (attachments embed file contents, hook stdout and injected context), `toolUseResult` (tool output), `lastPrompt`, `agentName`, `slug` (prompt-derived), `summary`.

## Usage mapping

| Canonical | Source | Confidence |
|---|---|---|
| `uncachedInput` | `usage.input_tokens` | high |
| `cachedInput` | `usage.cache_read_input_tokens` | high |
| `cacheWrite` | `usage.cache_creation_input_tokens` | high |
| `output` | `usage.output_tokens` | high |
| `reasoningOutput` | `usage.output_tokens_details.thinking_tokens` | high when present; absent otherwise |

**Deduplication is mandatory.** One API response is written as several `assistant` records (text block, tool-use block…) that share `requestId` and repeat the same `usage`. In the reference session: 782 assistant records, 386 distinct `requestId`s; naive `output` sum 1 117 279 vs deduped 438 086. `usage.dedupeKey = requestId`; records without `requestId` are treated as unique.

`cost` comes from the last `cost-state` record and is labeled `harness-reported`. Whether it includes subagent usage is an open question; until verified, sessions with children carry note `may include subagents`.

## Tool categories

`toolCategory(name)` for the timeline (D31). Names observed in one large session: Bash 153, Agent 43, Read 38, Edit 28, `mcp__chrome-devtools__*` 41, SendMessage 16, AskUserQuestion 13, ToolSearch 6, Skill 5, Write 4.

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
| `other` | everything else (`Skill`, `Artifact`, `SendUserFile`, …) |

Harness event vocabulary (`harnessEventNames`): `hook:<hookEvent>` (the part of `hookName` before `:`; e.g. `hook:PreToolUse`, `hook:Stop`, `hook:UserPromptSubmit`), `permission`, `plan-mode`, `plan-mode-exit`, `auto-mode`. The tool name after the colon is dropped so the vocabulary stays finite.

## Capabilities

`trace.blocks`, `trace.errors`, `trace.harnessEvents`, `usage.perCall`, `usage.cacheWrite`, `usage.reasoning`, `timing`, `model`, `mode`, `effort`, `version`, `turns`, `toolCalls`, `compactions`, `subagents`, `cost` *(newer versions only — declared; absence in old files shows as "missing in this session")*, `title`, `git` (branch only).

## Known variations

- `version` changes inside one file (CLI upgraded mid-session) → `flags.versionChanged`.
- `cwd` changes inside one file (`cd` in the session; 7 distinct values observed) → first cwd is the project anchor; all are listed.
- ~3 % of files have no `cwd` in their first records → resolver falls back to decoding the directory name, low confidence, diagnostic `cwd-from-dirname`.
- `cost-state` and `turn_duration` exist only in newer versions (0/60 and 19/60 of older files sampled).
- Files up to 28 MB; one project directory reached 127 MB / 40 sessions.
- `isSidechain: true` appears only in subagent files; a root file with sidechain records would be treated as a root and get a diagnostic.
- Assistant content block types in one session: `tool_use` 358, `thinking` 229, `text` 195 — one block per record, so `blocks` must be summed across `requestId` duplicates.
- `tool_result.is_error` was `true` on 8 of 358 results; `stop_reason` ∈ `tool_use`, `end_turn`, `stop_sequence`.
- Hook attachments are ~1 000 per large session (Pre/PostToolUse for every call); the timeline hides them by default.

## Fixtures (M2)

| Fixture | Purpose |
|---|---|
| `small/` | one short session, no subagents |
| `medium/` | the dedupe regression: expected deduped `output` recorded in the snapshot |
| `subagents/` | root + 3 subagents (one nested `spawnDepth: 2`) + a compaction + a version change + a model change; the snapshot records which `Agent` call step links to which child |
| `old-version/` | no `cost-state`, no `turn_duration` |
| `malformed/` | broken JSON line, oversized line, truncated final line |
| `canary/` | every content field = `SCOUT_CANARY_<n>` |
