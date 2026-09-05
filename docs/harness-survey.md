# Harness data survey

Structure-only inspection (keys, record types, counts) of the harness data present on the reference macOS machine on 2026-08-29. No content was read or retained. Every adapter starts from its section here; update the section when a new version changes the layout.

## Summary

| Harness | Store | Sessions here | Usage granularity | Subagents | MVP |
|---|---|---|---|---|---|
| Claude Code | JSONL per session under `~/.claude/projects/` | 731 files, 607 MB | per API call (dedupe by `requestId`) | separate files in `<session>/subagents/` | **M2** |
| Codex | JSONL rollouts under `~/.codex/sessions/YYYY/MM/DD/` | 167 files, 160 MB | cumulative `token_count` events | separate rollouts with `parent_thread_id` | M5 |
| Grok Build | per-session directory under `~/.grok/sessions/<url-encoded cwd>/<uuid>/` | 14 | per turn in `updates.jsonl` | `subagents/<id>/meta.json` | later |
| OpenCode | SQLite `~/.local/share/opencode/{opencode.db, opencode-tui-v2.db}` (WAL) | 73 (59 current + 14 legacy) | per API call (from `session_message.data.tokens`) | `session_v2.parent_id` / `session.parent_id` | **M?** (adapter built 2026-09-05) |
| Pi | `~/.pi/agent/` (no sessions on this machine) | 0 | unknown | unknown | later |
| Antigravity | no local trajectory store found | — | — | — | dropped (D11) |

## Claude Code

See [adapters/claude-code.md](adapters/claude-code.md) for the full mapping. Key facts:

- Top-level record keys: `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `version`, `gitBranch`, `isSidechain`, `agentId`, `requestId`, `effort`, `entrypoint`, `slug`, `userType`, `message`, `attachment`, `toolUseResult`.
- `type` distribution in one large session: `attachment` 1281, `assistant` 782, `user` 453, then per-session state records (`last-prompt`, `bridge-session`, `permission-mode`, `mode`, `atis-latch`, `ai-title`, `agent-name`, `queue-operation`, `system`, `file-history-*`, `cost-state`).
- `message.usage` keys: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens`, `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `service_tier`, `speed`, `server_tool_use`, `iterations[]`.
- `system.subtype` values: `compact_boundary` (with `compactMetadata.{trigger, preTokens, postTokens, cumulativeDroppedTokens, durationMs}`), `turn_duration` (`durationMs`, `messageCount`), `away_summary`, `stop_hook_summary`.
- `permission-mode` values seen: `auto`, `plan` (also `default`, `acceptEdits`, `bypassPermissions` per CLI docs). `mode` record values: `normal`.
- `cost-state` *(newer)*: `totalCostUSD`, `totalAPIDuration`, `totalToolDuration`, `totalLinesAdded/Removed`, `totalDuration`, `startTime`, `modelUsage` per model (`inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`).
- Subagent `.meta.json`: `{ agentType, description, toolUseId, spawnDepth }`; `toolUseId` matches the `id` of the parent's `Agent` tool-use block.
- Per-step signals for timelines: assistant `message.content[].type` ∈ `text`, `thinking`, `tool_use` (one block per record); `tool_use` blocks carry `id` and `name`; user `tool_result` blocks carry `tool_use_id` and `is_error`; `attachment.type` ∈ `hook_success`/`hook_system_message` (with `hookName` like `PreToolUse:Bash`, `Stop`, `UserPromptSubmit`), `command_permissions`, `plan_mode`, `plan_mode_exit`, `auto_mode`, `total_tokens_reminder`, `file`, `edited_text_file`, `*_delta`.
- Live sessions registry: `~/.claude/sessions/<pid>.json` (`sessionId`, `cwd`, `startedAt`, `version`, `kind`) — not used (status dropped, D10).
- `sessions-index.json` exists in only 8 of 215 project directories and contains `firstPrompt`/`summary` — ignored.
- Content hazards: `attachment.content` (full file contents, hook stdout), `message.content[].text/input/thinking`, `toolUseResult`, `lastPrompt`, `aiTitle` (D7 exception), `slug`, `agentName`, meta `description`.

## Codex

- Layout: `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO ts>-<uuid>.jsonl`. `~/.codex/history.jsonl` (`session_id`, `text`, `ts`) is content. `logs_2.sqlite`, `goals_1.sqlite` are not session stores.
- Record: `{ timestamp, type, payload }`. `type` ∈ `session_meta`, `turn_context`, `response_item`, `event_msg`, `compacted`, `inter_agent_communication_metadata`, `world_state`.
- `session_meta.payload` — **five shapes** between `cli_version` 0.98.0 and 0.150.1. Common: `id`, `timestamp`, `cwd`, `originator` (`codex-tui`, `codex_sdk_ts`…), `cli_version`, `source`, `model_provider`, `base_instructions` (content). Newer: `session_id`, `thread_source` (`user` | `subagent` | `guardian_review`), `parent_thread_id`, `forked_from_id`, `agent_nickname`, `agent_role`, `agent_path`, `multi_agent_version`, `history_mode`, `context_window`, `git.{commit_hash, branch, repository_url}`.
- `turn_context.payload`: `cwd`, `model`, `effort`, `approval_policy`, `sandbox_policy.{type, network_access, …}`, `collaboration_mode`, `personality`, `summary`, `truncation_policy`, `turn_id`, `workspace_roots`, `timezone`; `developer_instructions`/`user_instructions` are content.
- `event_msg.payload.type`: `token_count` (`info.total_token_usage.{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens}`, `info.last_token_usage`, `info.model_context_window`, `rate_limits`), `agent_message`, `agent_reasoning`, `user_message` (content), `context_compacted`, `sub_agent_activity` (`agent_thread_id`, `kind`, `occurred_at_ms`), `thread_settings_applied`.
- `response_item.payload.type`: `message`, `function_call`, `function_call_output`, `reasoning`, `custom_tool_call(_output)`.
- Semantics: `cached_input_tokens ⊂ input_tokens`; `reasoning_output_tokens ⊂ output_tokens`. `token_count.info` is `null` in ~0.6 % of events — skip those.
- Subagents: 87 rollouts with `thread_source: subagent` vs 39 `user` on this machine. `agent_path` like `/root` suggests a hierarchy; `parent_thread_id` is the link.
- Counts: 167 rollouts; `cli_version` spread 0.98 → 0.150 (most 0.145–0.147).
- Per-step signals: `function_call.name` and `function_call_output` (error markers) — to verify in M5 for `toolCategory` and `toolResult.error`.

## Grok Build

- Layout: `~/.grok/sessions/<URL-encoded absolute cwd>/<uuid>/` with `summary.json`, `updates.jsonl`, `events.jsonl`, `chat_history.jsonl` (content), `system_prompt.txt` (content), `plan_mode.json`, `prompt_context.json`, `subagents/<uuid>/{meta.json, output.json}`, `terminal/`, `hunk_records.jsonl`, `rewind_points.jsonl`. Also `~/.grok/sessions/session_search.sqlite` and `<cwd>/prompt_history.jsonl` (content), `~/.grok/active_sessions.json`, `~/.grok/worktrees.db`.
- `summary.json` keys: `info.{id, cwd}`, `created_at`, `updated_at`, `last_active_at`, `num_messages`, `num_chat_messages`, `current_model_id`, `reasoning_effort`, `sandbox_profile`, `agent_name`, `git_root_dir`, `git_remotes`, `head_branch`, `head_commit`, `chat_format_version`; `generated_title`, `session_summary` are content.
- `updates.jsonl`: JSON-RPC `{ method: "_x.ai/session/update", params: { sessionId, update: { sessionUpdate, … } } }`. `sessionUpdate: "turn_completed"` carries `usage.{inputTokens, outputTokens, totalTokens, cachedReadTokens, cacheCreationTokens, reasoningTokens, modelCalls, apiDurationMs, costUsdTicks, modelUsage per model}` and `stop_reason`.
- `events.jsonl`: `phase_changed`, `tool_started`/`tool_completed` (`tool_name`, `duration_ms`, `outcome`), `permission_requested`/`permission_resolved`, `loop_started`, `first_token`, MCP lifecycle.
- Open question: whether `inputTokens` includes `cachedReadTokens` (needed for `uncachedInput`). `costUsdTicks` unit to verify (likely micro-dollars ×10).

## OpenCode

- Two SQLite stores under `~/.local/share/opencode/`, both in WAL mode. Open with `bun:sqlite` `readonly`; **do not** use `immutable=1` (it ignores the WAL and shows an empty database).
- **Current store** `opencode.db`: `session_v2` (59 sessions) + `session_message` (1578 rows) + `project` (9) + `worktree` (4). `session_v2` has `id`, `project_id`, `parent_id`, `fork_session_id`, `directory`, `title`, `version`, `cost`, `tokens_*`, `agent`, `model`, `time_created`, `time_updated`, `time_suspended`.
- **Legacy store** `opencode-tui-v2.db` (frozen): the **V1 `session` table** (14 sessions) — a strict subset of `session_v2` (no `fork_session_id`/`time_suspended`) — plus its own `session_message` (284 rows). Its `message`/`part` tables are empty.
- `session_message` columns (both stores): `id`, `session_id`, `type`, `seq`, `time_created`, `time_updated`, `data` (JSON). Message types: `user`, `assistant`, `model-switched`, `compaction`, `agent-switched`, `system`, `location-switched`, `synthetic`.
- `message.data` is a JSON blob (time, model, tokens, content[], reason…). Content lives in `data.text` / `content[].text` / `content[].state.{input,content,error.message,reasoningEncryptedContent}` — all excluded by the adapter's allowlist.
- Id overlap between current and legacy = 0 (73 independent sessions). `PRAGMA user_version` is 0 for both → discriminate the schema by **table presence** (`session_v2` vs `session`).
- `session_message.seq` is not contiguous from 0 (a 12-message session has min 4 / max 177) — the adapter reindexes to 0..n-1 in source order. One live session reports `tokens_input=160768` while the per-message sum is 159340 (Δ 1428) — the adapter always computes session token fields as Σ of `call`-step tokens and emits a `token-total-drift` diagnostic when the harness aggregate differs.

## Pi

Installed (`~/.pi/agent/{extensions, skills}`) but no session directory present. Expected layout (to verify): `~/.pi/agent/sessions/<encoded cwd>/<timestamp>_<id>.jsonl` with per-message `usage`. Survey pending.

## Antigravity

`~/.antigravity/` holds extensions and CLI binaries; `~/.gemini/antigravity/` has `brain/` (empty), `knowledge/`, `implicit/*.pb`, `daemon/` logs; `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb` has `antigravityUnifiedStateSync.trajectorySummaries` with an empty value. No per-session usage data found locally. Dropped from MVP (D11); revisit if a local trajectory store appears.

## Toolchain on the reference machine

Bun 1.3.10, Node 24.17, SQLite 3.51, jq 1.7.1, git 2.54.
