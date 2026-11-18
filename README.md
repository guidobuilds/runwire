# Runwire

**Local, read-only visibility into coding-agent sessions.** Runwire reads the session files your
harness already writes to disk, keeps only operational metadata and token usage, and stores it in
SQLite so you can see where a hand-built agent setup burns tokens and time.

> [!WARNING]
> **Runwire is early beta (0.x).** The data contract, SQLite schema, CLI flags and HTTP API may
> change without notice between releases. It is a local analysis tool, not production
> infrastructure. Back up `~/.runwire/runwire.db` before upgrading.
>
> **The web UI is incomplete.** Some panels are placeholders or still being designed. The import
> path and the database are the stable part today.

[![CI](https://github.com/guidobuilds/runwire/actions/workflows/test.yml/badge.svg)](https://github.com/guidobuilds/runwire/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: beta](https://img.shields.io/badge/status-beta-orange.svg)](#project-status)

## What it does

- **Reads only.** It never modifies harness logs, harness databases or your configuration.
- **Metadata only.** Prompts, responses, reasoning, code, tool input and tool output are never
  stored. A per-adapter allowlist decides which fields survive; everything else is dropped before
  validation. Harness-generated titles are the single opt-in exception.
- **Local only.** No account, no API key, no cloud service, no telemetry.
- **Harness-agnostic.** One package per harness; the same contract and test kit for all of them.

What ends up in the database: one row per session with token totals (uncached input, cached input,
cache write, output, reasoning), timing, model and mode history, compactions, tool calls by
category, subagent lineage and an ordered timeline. See
[docs/usage/what-runwire-knows.md](docs/usage/what-runwire-knows.md).

## Supported harnesses

| Harness | Status | Data source |
|---|---|---|
| Claude Code | supported | `~/.claude/projects/**` (JSONL) |
| OpenCode | supported | `~/.local/share/opencode/*.db` (SQLite, read-only) |
| Pi | supported | `~/.pi/agent/sessions/**` (JSONL) |
| Gentle Shell | supported | isolated home plus `gentle-agents/sessions` trees |
| Codex | planned | — |
| Grok Build | planned | — |

Unavailable signals stay `NULL`; nothing is inferred. Coverage per signal is in
[docs/usage/what-runwire-knows.md](docs/usage/what-runwire-knows.md#harness-coverage).

## Requirements

- [Bun](https://bun.sh) **1.3 or newer**.
- macOS, Linux or Windows.
- At least one supported harness, with sessions already on disk.

There is no global install and no npm package yet: run everything from a clone.

## Quick start

```sh
git clone https://github.com/guidobuilds/runwire.git
cd runwire
bun install

bun run runwire import     # read sessions into ~/.runwire/runwire.db
bun run dev                # API on :8787 + web UI on :5173
```

`bun run dev` starts both halves under one process; `Ctrl-C` stops both. Use
`./scripts/dev.sh --import` to refresh the database before starting, `--db <path>` to pick another
store, and `--port <n>` for another API port.

To inspect sessions without writing anything:

```sh
bun run runwire discover --adapter claude-code --json > inventory.ndjson
```

## Commands

```text
runwire import   [--adapter <id>] [--home <dir>] [--db <path>] [--no-titles] [--force]
runwire discover --adapter <id> [--home <dir>] [--json] [--no-titles]
runwire serve    [--db <path>] [--host <host>] [--port <n>] [--no-titles] [--expose]
```

The default database is `~/.runwire/runwire.db`. `--db :memory:` is supported. Adapter ids:
`claude-code`, `opencode`, `pi`, `gentle-shell`. Full reference:
[docs/usage/commands.md](docs/usage/commands.md).

`runwire serve` binds to loopback only. `--expose` allows a non-loopback bind and prints a warning:
the API has no authentication and serves session metadata plus `POST /api/scan`.

## Development

```sh
bun run lint        # Biome + import-boundary check
bun run typecheck   # tsc --noEmit in every package
bun run test        # bun test per package, Vitest in packages/web
```

Never run a bare `bun test` at the repo root: `bunfig.toml` excludes `packages/web`, so it would
silently skip the web suite. Architecture and import boundaries are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); decisions are recorded in
[docs/DECISIONS.md](docs/DECISIONS.md).

## Project status

Runwire is **beta** and maintained as a spare-time project. Expect rough edges. The most useful
contributions right now are bug reports, new harness adapters, and documentation fixes. See
[CONTRIBUTING.md](CONTRIBUTING.md).

Roadmap, without dates:

- Stabilize the data contract and publish the first tagged release.
- Finish the session-profile UI.
- Add Codex and Grok Build adapters.
- Publish installable packages.

## Security

Runwire is local-first, but it still reads sensitive session metadata. Do not expose the API
publicly. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in a
public issue.

## License

[MIT](LICENSE) © 2026 Guido Caffa.
