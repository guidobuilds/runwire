# Product

Runwire is a local, read-only explorer for coding-agent sessions. This document defines what the
product is for and what it deliberately does not do. Design decisions are numbered in
[DECISIONS.md](DECISIONS.md); the technical contract is in [ARCHITECTURE.md](ARCHITECTURE.md).

> **Status: beta.** The product is usable for local analysis, but the schema and interfaces may
> change between 0.x releases.

## Problem

A developer running a hand-built agent harness accumulates sessions, tokens, compactions, model
switches and subagents with no easy way to see the cost of any of it. The harness shows the current
conversation; it does not answer:

- Where did the context go, and what triggered each compaction?
- Which model did most of the work, and did a cheap task run on an expensive model?
- Did the root agent delegate, or did it exhaust its own context?
- How much did a session and all of its subagents cost in tokens and time?

Runwire answers those questions from data the harness already leaves on disk.

## Principles

| Principle | Meaning |
|---|---|
| Local-first | Runs on your machine. No account, API key, cloud service or telemetry. |
| Read-only | Never modifies session logs, harness databases or agent configuration. |
| Metadata only | Never displays, indexes or persists prompts, responses, code, tool output or reasoning. Harness-generated titles are the one opt-in exception (D7) and can be disabled. |
| Evidence, not verdict | Every signal reports scale and who or what controlled the outcome, next to the number (D52). |
| Harness-owned mapping | Each adapter owns all knowledge of its harness and computes every field. Core validates, stores and aggregates (D68). |

## Scope

| In scope | Out of scope |
|---|---|
| Importing historical sessions from supported harnesses | Running agents, capturing live sessions or orchestration |
| Token, time, tool, compaction and model analytics | Creating, running or grading evals |
| Subagent lineage and per-tree rollups | Transcript browsing, prompt search, code inspection |
| A local HTTP API and a web explorer | Cloud sync, accounts, team analytics, telemetry |
| Read-only discovery for inspection and export | Editing or deleting harness data |

## Current state

| Layer | State |
|---|---|
| `packages/core` | Contract types, SQLite store, import orchestrator, contract test kit |
| `packages/adapter-*` | Claude Code, OpenCode, Pi and Gentle Shell adapters |
| `packages/cli` | `runwire import`, `runwire discover`, `runwire serve`; the adapter registry |
| `packages/server` | Local HTTP API over SQLite |
| `packages/web` | Web explorer (beta) |

The next milestones are tracked in the README's roadmap. No dates are promised.
