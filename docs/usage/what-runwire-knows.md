# What Runwire knows — and what it never reads

An explanation of what ends up in `~/.runwire/runwire.db` after an import, at the level a user reasons about it. Field-by-field definitions live in [ARCHITECTURE.md §4](../ARCHITECTURE.md#4-what-an-adapter-computes); per-harness details in [docs/adapters/](../adapters/).

## One row per session

Each session the harness left on disk becomes one record with:

- **Identity** — a stable id, the harness, the project it ran in (resolved from the git remote, repo root or cwd), and how it started: a human, or a machine (SDK, CI, subagent dispatch).
- **Money and time** — token totals split into `uncached input`, `cached input`, `cache write`, `output` (with reasoning as a subset), the number of API calls, when the session started and ended, and how long it ran.
- **Shape** — human turns, tool calls, compactions, the primary model and how often it changed, the primary mode, the harness versions seen first and last, and the cost the harness itself reported (Runwire never computes cost).
- **Lineage** — parent sessions, subagents and forks, with depth; rollup totals that include a session's descendants.

Token counts are deduplicated: one API request counts once, even when the harness writes it into several records. Per session, the sum of the per-call steps equals the session total — the contract test kit enforces it.

## One timeline per session

Alongside the totals, each session carries ordered **steps**: API calls with their own tokens, tool calls categorized (`read`, `write`, `exec`, `search`, `plan`, `agent`, `web`, `mcp`, `skill`, `other`) with error flags and durations, compactions with their trigger and token drop, and model/mode transitions. Skill tool calls carry the skill name.

This timeline is what makes patterns visible rather than just totals: a session can show *many* compactions with *what triggered them*, an expensive model doing `read`-category work, or a root session that never delegated to a subagent and compacted repeatedly.

## Privacy model

| Rule | What it means |
|---|---|
| Local-only | Runs on your machine. No account, no API key, no network, no telemetry. |
| Read-only | Runwire never modifies session logs, harness databases or configuration. |
| Metadata only | Prompts, responses, reasoning, code, tool inputs and outputs are never read into storage. An allowlist decides, per field, what an adapter may keep — anything not on it is dropped before validation. |
| Titles | The one content-derived exception: the harness's generated session title. `--no-titles` keeps them out entirely. |
| Diagnostics without content | When a record is malformed or unknown, Runwire stores a fixed code and message — never the record itself. |

A canary test (fixtures whose every content field is a unique sentinel) verifies that no content survives into a stored bundle.

## What is NOT in the database

- No prompt, response, thinking, tool output or file content.
- No code, no diffs, no file contents.
- No computed cost — only what the harness reported.
- No continuous monitoring: the picture is as fresh as your last `runwire import`.

## Harness coverage

All four harnesses below can be imported today. Unavailable signals stay NULL, not inferred.

| Signal | Claude Code | OpenCode | Pi | Gentle Shell |
|---|---|---|---|---|
| Per-call tokens (incl. cache write, reasoning) | yes | yes | yes | yes |
| Timing (first/last, duration) | yes | yes | yes | yes |
| Model / mode / effort tracking | model, mode, effort | model only | model, effort | model, effort |
| Turns, tool calls, compactions | yes | yes | yes | yes |
| Subagents (linked, with depth) | yes | yes | not linked | via task ledger |
| Forks | via subagent linkage | explicit (`fork_session_id`) | `parentSession` | `parentSession` |
| Harness-reported cost | newer CLI versions | yes | yes | yes |
| Git branch / commit | branch | not stored | not stored | not stored |
| Human vs machine initiator | yes (`entrypoint` + dispatch marker) | not stored | not stored | children only |
| Tool error flags, tool durations | yes | yes | yes | yes (direct duration, timestamp fallback) |
| Titles (privacy-controlled) | yes (`ai-title`) | yes | not stored | not stored |
| CLI version | yes | yes | not stored | not stored (header 3 is format version) |

### Gentle Shell: scope and privacy

Gentle Shell reads Pi-format session metadata: tool names, usage and timings, model/effort,
turn counts and error flags. It reads **link metadata** from `gentle-agents/tasks` to connect
children to parents, including agent type and depth. Ledger aggregates (`tokens`, `cost`,
`turns`, `toolCalls`) are never used: totals come from the child session, never twice.

The isolated home's `sessions` and both homes' `gentle-agents/sessions` trees belong to
`gentle-shell`. Shared Pi-home parents remain `pi`; the Gentle Shell adapter never reads
those parent files. `spawnCallId` is available only from Gentle Shell-owned parents and stays
NULL for `pi:` parents. Import both harnesses to retain these cross-harness parent links;
a Gentle-only import into an empty DB leaves them orphaned. If Pi is imported later, force a
Gentle Shell reimport to restore links already cleared on cached children.
Pruned ledger entries leave children unlinked but fully counted. Ledger-backed children are
machine-initiated (`subagent-dispatch`); parents have no initiator signal.

Never stored: prompt/response/tool I/O content, reasoning, code, `custom.data` payloads,
ledger prompt/result/thread, rendered transcripts, user-authored names, or context replacements.
Only allowlisted metadata survives projection; custom records contribute presence, not payloads.
No per-session mode, CLI version, title or git state is available.

Mappings: [Claude Code](../adapters/claude-code.md), [OpenCode](../adapters/opencode.md),
[Pi](../adapters/pi.md), [Gentle Shell](../adapters/gentle-shell.md) (D84–D88).
