# Runwire

Local, read-only explorer of coding-agent sessions. Current brief; decisions in [DECISIONS.md](DECISIONS.md), design in [ARCHITECTURE.md](ARCHITECTURE.md).

## Purpose (D67)

Runwire makes the token and time waste of a developer's hand-built agent harness visible: repeated automatic compaction, mid-session model switches, expensive models doing cheap work, heavy MCP use, a root agent that never delegates and exhausts its own context (the catalog in D51). It reads local session data and keeps only operational metadata and usage metrics, across all sessions and harnesses.

## Principles

| Principle | Meaning |
|---|---|
| Local-first | Runs on the developer's machine. No account, API key, cloud service or telemetry. |
| Read-only | Never modifies logs, session databases or agent configuration. |
| Metadata only | Never displays, indexes or persists prompts, responses, code, tool output or reasoning. Harness-generated titles are the one exception (D7), and can be disabled. |
| Evidence, not verdict | Every signal reports scale and who/what controlled the outcome, next to the number (D52). |

## What exists now

| Layer | State |
|---|---|
| `packages/core` | Contract types, SQLite store (`bun:sqlite`), import orchestrator, contract test kit. |
| `packages/adapter-claude-code` | Discovers `~/.claude/projects` sessions and computes every field of the contract. |

## Later

- `web` — a front end over the SQLite data.
- `api` — a backend for it.
- More harnesses: Codex, Grok Build, OpenCode, Pi (D25).

## Non-goals

- Running agents, capturing live sessions, orchestration.
- Creating, running or grading evals.
- Transcript browsing, prompt/response search, code inspection, content analysis.
- Cloud sync, collaboration, accounts, team analytics, telemetry.
- Editing or deleting harness data.
