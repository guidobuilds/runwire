# Getting started

A tutorial: install Runwire, import your agent sessions once, and look at what landed in the database. Ten minutes, one machine. Concepts (what Runwire measures and why) are in [what-runwire-knows.md](what-runwire-knows.md); the exact command reference is in [commands.md](commands.md).

> **Beta:** expect the schema and commands to change between 0.x releases.

## Prerequisites

- [Bun](https://bun.sh) 1.3 or newer.
- At least one supported harness with sessions on disk: **Claude Code** (`~/.claude/projects/`),
  **OpenCode** (`~/.local/share/opencode/`), **Pi** (`~/.pi/agent/sessions/`) or **Gentle Shell**
  (`~/.gentle-shell/agent/` plus `gentle-agents/sessions/`). No other setup is needed — Runwire
  reads what the harness already wrote.

## Install

```sh
git clone https://github.com/guidobuilds/runwire.git
cd runwire
bun install
```

There is no global install yet; every command below runs through the workspace with
`bun run runwire`.

## First import

```sh
bun run runwire import
```

This runs every registered adapter and writes one row per session into `~/.runwire/runwire.db`.
Nothing is sent anywhere and no harness file is touched — Runwire is strictly read-only.

The report goes to **stderr**, one line per adapter with sessions:

```
claude-code: discovered 731  imported 731  skipped 0  removed 0  failed 0  (1.3s)
opencode:     discovered 73   imported 73   skipped 0  removed 0  failed 0  (0.1s)
```

Adapters whose harness is not installed report `installed: false` and are skipped.

- `imported` — sessions newly stored or updated.
- `skipped` — sources unchanged since the last import (same size and modification time).
- `removed` — sessions whose source disappeared on disk.
- `failed` — bundles that could not be validated. The command exits `1` if any adapter errored or any bundle failed, `0` otherwise.

## Check what was stored

```sh
ls -lh ~/.runwire/runwire.db
```

That file is the whole product of the import: one record per session with token totals, call counts, model and mode history, compactions, tool calls by category, and the parent/child links between a session and its subagents. A plain SQLite browser is enough to explore it. What is — and is not — in there: [what-runwire-knows.md](what-runwire-knows.md).

To peek at raw data without touching the store at all:

```sh
bun run runwire discover --adapter claude-code
```

This prints one short human-readable line per session to stdout, straight from the harness files, without writing anything.

## Next steps

- Import again later and only what changed is reprocessed → [how-to.md](how-to.md#re-import-after-more-work).
- Keep titles out of the database → [how-to.md](how-to.md#import-without-titles).
- Every flag and exit code → [commands.md](commands.md).
