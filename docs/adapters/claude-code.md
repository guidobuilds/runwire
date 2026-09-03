# Adapter: Claude Code

Status: **Built (M2)**, validated against real sessions on the reference machine (2026-08-30): 731 sources (367 root, 364 subagent) parsed with zero failures, cold scan 1.3 s / warm rescan 22 ms, well under the 5 s budget. Based on structure-only inspection of CLI versions 2.1.22x–2.1.251 on macOS (2026-08-29). Fields marked *(newer)* were only seen in the latest versions.

## Location and layout

| | Path |
|---|---|
| Root | `~/.claude/projects/` (Windows: `%USERPROFILE%\.claude\projects\`) |
| Project dir | `<root>/<cwd with path separators replaced by "-">/` — lossy; **never used as the project key** |
| Root session | `<projectDir>/<sessionId>.jsonl` |
| Subagent | `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl` + `agent-<agentId>.meta.json` |
| Ignored | `<projectDir>/sessions-index.json` (contains first prompt and summary), `<projectDir>/memory/`, `<sessionId>/tool-results/`, `~/.claude/history.jsonl`, `~/.claude/stats-cache.json`, `~/.claude/sessions/` |

`sourceId`: `<sessionId>` for roots, `<sessionId>/<agentId>` for children. `parentHint` = `<sessionId>` from the directory nesting.

## Data flow: from JSONL line to `SessionSummary`

This section is the concrete version of the "one record's journey" walkthrough in ARCHITECTURE.md's "Start here" section — how this specific adapter's three functions (`discover`, `parse`, and `core`'s `reduce`) turn files under `~/.claude/projects/` into the fields on `SessionSummary` (ARCHITECTURE.md §2.3). Two examples cover the two kinds of mapping this adapter does: a plain field lookup (usage) and a structural one (linking a subagent to its parent).

**1. Discovery.** `discover()` walks `~/.claude/projects/**` with `readdir`/`stat` only — it never opens a file. For every `<sessionId>.jsonl` it yields a `SourceRef{ sourceId: sessionId, kind: 'root' }`; for every `agent-<agentId>.jsonl` under a session's `subagents/` directory, a `SourceRef{ sourceId: '<sessionId>/<agentId>', kind: 'child', parentHint: sessionId }`. Nothing here is parsed yet — this step exists purely so a rescan (ARCHITECTURE.md §5) can skip files whose size/mtime haven't changed.

**2. Parsing — a usage record.** `parse(ref, ctx)` streams the file line by line. This raw `assistant` record (content fields omitted — they're never even copied out of the line, ARCHITECTURE.md §6):

```json
{ "type": "assistant", "requestId": "req_1", "timestamp": "2026-08-30T10:00:00Z",
  "message": { "model": "claude-opus-5",
    "usage": { "input_tokens": 1200, "cache_read_input_tokens": 300, "output_tokens": 84 } } }
```

becomes, per the mapping table below (§ "Record types"):

```ts
{ kind: 'usage', dedupeKey: 'req_1', model: 'claude-opus-5', at: '2026-08-30T10:00:00Z',
  uncachedInput: 1200, cachedInput: 300, output: 84 }
```

`core.reduce()` (ARCHITECTURE.md §3.2) then dedupes by `dedupeKey` — necessary here because one API call is written as several `assistant` records sharing one `requestId` (see "Usage mapping" below) — and writes the result straight onto `SessionSummary.usage.uncachedInput = { value: 1200, confidence: 'high', source: 'claude-code/assistant.usage#requestId' }`. The adapter never sums or dedupes; it only looked up `input_tokens` and named the key it repeats on.

**3. Parsing — linking a subagent.** A subagent's own file sits at `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl`, alongside `agent-<agentId>.meta.json`:

```json
{ "sessionId": "sess_1", "agentId": "ag_1", "agentType": "Explore", "spawnDepth": 1, "toolUseId": "toolu_9" }
```

`parse()` turns that into one `link` event when it processes the child source:

```ts
{ kind: 'link', parentSourceId: 'sess_1', relation: 'subagent', agentType: 'Explore', depth: 1, viaCallId: 'toolu_9' }
```

`core`'s linking step (ARCHITECTURE.md §3.4) — not this adapter — resolves `parentSourceId` against the parent's already-reduced summary, sets `SessionSummary.parentId`/`relation` on the child, and appends the child's id to the parent's `children: string[]`. The adapter only ever states *who its parent is and how it was spawned*; building the tree, computing `depth` from it, and rolling up usage across it (ARCHITECTURE.md §2.4) all happen in `core`.

Every other record type in the table below follows the same pattern: a direct field lookup (or, for `initiator`, a small classification — see "Initiator" below) into one `ScoutEvent`, never more than one hop from the raw JSON.

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
| any record | `cwd`, `version` on change; `entrypoint` (first observed value wins — session-wide fact repeated on most records) feeds `initiator` (see "Initiator" below) | `cwd`, `version`, `gitBranch`, `entrypoint` |
| `attachment` | `harnessEvent` for `attachment.type` ∈ `hook_success` / `hook_system_message` (`name = hook:<hookName>`), `command_permissions` (`permission`), `plan_mode` / `plan_mode_exit` / `auto_mode` (mode markers); other attachment types (`total_tokens_reminder`, `file`, `edited_text_file`, deltas…) ignored | `attachment.type`, `attachment.hookName` |
| `agent-setting` | nothing directly; its mere *presence* in the file (via the already-allowlisted `type`) is the dispatch-marker signal fed into `initiator` — the record's own payload is never read | `type` only |
| `last-prompt`, `agent-name`, `mode`, `atis-latch`, `bridge-session`, `queue-operation`, `file-history-*`, `summary` | nothing (counted as known-ignored) | — |
| unknown `type` | counted; one aggregated `unknown-record-type` diagnostic per file | — |

`promptSource` is allowlisted (kept in memory, visible in diagnostics) but is not read by any mapping above — see "Initiator" below for why.

`<synthetic>` as `message.model` is ignored for model tallies and its usage is kept (it carries real numbers).

`.meta.json` → `link { parentSourceId: sessionId, relation: 'subagent', agentType, depth: spawnDepth, viaCallId: toolUseId }`. `description` is not read. Teammate records (`toolUseResult.team_name`) are not parsed in MVP; teammates appear only if they have their own subagent files.

## Allowlist (projection)

Generated from `src/allowlist.ts` in M2; hand-maintained here, so this block must be kept byte-for-byte in step with the source file rather than actually generated. Draft:

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

Explicitly excluded and why: `message.content[].text|input|thinking|content` (content), everything in `attachment` except `type` and `hookName` (attachments embed file contents, hook stdout and injected context), `toolUseResult` (tool output), `lastPrompt`, `agentName`, `slug` (prompt-derived), `summary`, `agentSetting` (a user-authored agent name — only the *presence* of the `agent-setting` record is read, via the already-allowlisted `type`, never its payload).

`entrypoint` and `promptSource` are closed-ish enums the CLI itself emits (the surface a session arrived on, and the kind of a prompt) — fixed vocabularies with no user- or model-authored content, admissible under D7 on the same grounds as `model`/`mode`/`stop_reason`. They also survive the dev-only fixture redactor (`apps/scout/src/fixture.ts`) only when their observed value is in `CLAUDE_CODE_ENTRYPOINTS` / `CLAUDE_CODE_PROMPT_SOURCES` (`src/initiator.ts`); an unrecognized value degrades to filler, the same rule the redactor applies to `type`-adjacent enum fields, so free text can never leak into a committed fixture through either field.

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

## Initiator

Classifies who or what started a session (`src/initiator.ts`, `classifyInitiator`), feeding `SessionSummary.initiator?: Metric<Initiator>` (ARCHITECTURE.md §2.2). Two signals, both allowlisted, both closed-ish enums with no user- or model-authored content:

- **`entrypoint`** — a record-level field naming the *surface* the session came in on. The first observed value on the file wins (it is a session-wide fact repeated on most records).
- **the presence of an `agent-setting` record** — the dispatch marker Claude Code writes when the session was dispatched by another agent framework rather than opened by a person. Orthogonal to `entrypoint`; only the record's *presence* is read, never its payload (`agentSetting` itself is not allowlisted).

`entrypoint` values classify as follows:

| Machine surfaces (`kind: 'machine'`, confidence `high`) | `automation` |
|---|---|
| `sdk-cli`, `sdk-ts`, `sdk-py` | `sdk` |
| `claude-code-github-action` | `ci` |
| `mcp`, `bench`, `local-agent`, `local_agent`, `claude-security`, `remote`, `remote_baku`, `remote_cowork`, `remote_trigger`, `remote_cowork_trigger`, `remote_desktop`, `remote_mobile` | — |

| Human surfaces (`kind: 'human'`, confidence `medium`, always) |
|---|
| `cli`, `claude-desktop`, `claude-desktop-3p`, `claude-vscode`, `ssh-remote`, `claude_in_slack`, `claude-in-slack`, `claude-in-teams`, `claude-coworker`, `claude-coworker-terminal` |

Any other observed value classifies `kind: 'unknown'` at `low` (an adapter version that does not yet recognize a new surface) rather than breaking. If no `entrypoint` was observed at all: no dispatch marker → `initiator` is left absent (the session predates the signal, or it genuinely carries none); dispatch marker present → `kind: 'machine'`, `surface: 'unknown'`, `automation: 'subagent-dispatch'`, `medium` (the marker alone says "some agent framework", not which surface). The dispatch marker only ever *upgrades* a non-machine verdict — applying it over an already-machine `entrypoint` would replace a more specific, `high`-confidence automation with a weaker one.

**Confidence asymmetry, and why it's real, not a bug:** `human` can never be better than `medium`, because a harness reports the *surface* a session arrived on, not who typed — a scripted `claude -p` in CI reports `cli`, the exact same value a person types at a terminal. A machine surface can be `high` because no interactive human is possible there (no person runs `sdk-py`). This asymmetry is modeled explicitly (`InitiatorKind`'s doc comment, ARCHITECTURE.md §2.2) rather than flattened into one confidence per kind.

**`promptSource` is deliberately not an input to the classification**, though it is allowlisted for diagnostics. Its `sdk` value is emitted both by genuine SDK sessions and by the `claude-desktop` surface, so it cannot separate the two — using it would misclassify the one real `claude-desktop` root observed on the reference machine as machine-started. `entrypoint` and the dispatch marker are the only two signals read.

`initiator` is a declared `Capability` (ARCHITECTURE.md §4), enforced bidirectionally by the adapter contract kit like every other capability.

**Measured, reference machine, real `~/.claude/projects` (2026-09-01):** 383 root sessions → 318 classified `machine` (308 by `entrypoint`, 10 by the dispatch marker alone), 64 `human`/`cli`, 1 `human`/`claude-desktop`. That is 83 % of *rows* — the machine-started sessions are noise in a session list, not a meaningful share of spend: measured separately, they account for roughly 2–3 % of total token mass on the same machine. This feature is documented and shipped as row-count/provenance cleanup, not as a cost or savings view.

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
| `skill` | `Skill` |
| `other` | everything else (`Artifact`, `SendUserFile`, …) |

Harness event vocabulary (`harnessEventNames`): `hook:<hookEvent>` (the part of `hookName` before `:`; e.g. `hook:PreToolUse`, `hook:Stop`, `hook:UserPromptSubmit`), `permission`, `plan-mode`, `plan-mode-exit`, `auto-mode`. The tool name after the colon is dropped so the vocabulary stays finite.

## Capabilities

`usage.perCall`, `usage.cacheWrite`, `usage.reasoning`, `timing`, `model`, `mode`, `effort`, `version`, `turns`, `toolCalls`, `compactions`, `subagents`, `cost` *(newer versions only — declared; absence in old files shows as "missing in this session")*, `title`, `git` (branch only), `initiator` (see "Initiator" below), `trace.blocks`, `trace.errors`, `trace.harnessEvents`.

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
- `PostToolUseFailure:<tool>` is a real hook event, alongside `PreToolUse`/`PostToolUse` — found running the full machine-wide cold scan, not the earlier structure-only sample.
- `agent-setting` (`{ type, agentSetting, sessionId }`) is a real top-level record type — a session-scoped setting marker, no timestamp or usage — first found in the same cold scan. Its payload (`agentSetting`) stays unread; only its presence is now read, as the dispatch-marker signal for `initiator` (see "Initiator" above).

## Fixtures (M2)

Generated from real sessions on the reference machine via `scout fixture` (`apps/scout/src/fixture.ts`), except `malformed/` and `canary/`, which are hand-written. `all/` is a generated union of the others, used only so the adapter contract kit's capability-consistency check sees the full repertoire in one `discover()` view.

| Fixture | Source | Purpose |
|---|---|---|
| `small/` | a short real session | one root, no subagents, no diagnostics |
| `medium/` | the reference session (`3666e64a…`) | the dedupe regression — deduped `output` must equal 438 086, not the naive 1 117 279 |
| `subagents/` | a real session with 2 subagents, a compaction, a version change and a model change | root + 2 subagents linked with `agentType`/`depth`/`viaCallId`; rollups include both children. Both subagents are at `spawnDepth: 1` — no real session on the reference machine combined a small subagent count with nesting at `spawnDepth: 2`; nested-depth tree computation itself is proven at the core level (`link.test.ts`), not re-proven here |
| `old-version/` | a real session on CLI 2.1.234 | no `cost-state`, no `turn_duration`; turns still derived from user-message heuristics |
| `malformed/` | hand-written | a broken JSON line and a truncated final line, both mid-file so records before and after still parse. The oversized-line path is exercised separately, in-memory, in `index.test.ts` — not via an 8 MB fixture file |
| `canary/` | hand-written | every content field = a unique `SCOUT_CANARY_<n>` sentinel, except `aiTitle` (a different, unchecked sentinel — it is the sanctioned D7 exception and legitimately reaches `meta.title`) |
| `all/` | generated | union of every fixture above, for the contract kit's capability-consistency check only (see `all/README.md`) |
