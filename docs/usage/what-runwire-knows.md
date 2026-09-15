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

What a session can carry depends on the harness. Sessions from either adapter below can be imported today.

| Signal | Claude Code | OpenCode |
|---|---|---|
| Per-call tokens (incl. cache write, reasoning) | yes | yes |
| Timing (first/last, duration) | yes | yes |
| Model / mode / effort tracking | model, mode, effort | model only |
| Turns, tool calls, compactions | yes | yes |
| Subagents (linked, with depth) | yes | yes |
| Forks | via subagent linkage | explicit (`fork_session_id`) |
| Harness-reported cost | newer CLI versions | yes |
| Git branch / commit | branch | not stored |
| Human vs machine initiator | yes (`entrypoint` + dispatch marker) | not stored |
| Tool error flags, tool durations | yes | yes |
| Titles (privacy-controlled) | yes (`ai-title`) | yes |

How each harness maps to these fields: [adapters/claude-code.md](../adapters/claude-code.md), [adapters/opencode.md](../adapters/opencode.md).
