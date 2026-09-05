# Getting started

A tutorial: install Scout, import your agent sessions once, and look at what landed in the database. Ten minutes, one machine. Concepts (what Scout measures and why) are in [what-scout-knows.md](what-scout-knows.md); the exact command reference is in [commands.md](commands.md).

## Prerequisites

- [Bun](https://bun.sh) 1.3 or newer.
- A harness whose sessions you want to see. Today that is **Claude Code** (JSONL files under `~/.claude/projects/`) or **OpenCode** (SQLite stores under `~/.local/share/opencode/`). No other setup is needed — Scout reads what the harness already wrote.

## Install

```sh
bun install
```

There is no global install; every command below runs through the workspace with `bun run scout`.

## First import

```sh
bun run scout import
```

This runs every registered adapter (Claude Code and OpenCode) and writes one row per session into `~/.scout/scout.db`. Nothing is sent anywhere and no harness file is touched — Scout is strictly read-only.

The report goes to **stderr**, one line per adapter:

```
claude-code: discovered 731  imported 731  skipped 0  removed 0  failed 0  (1.3s)
opencode:     discovered 73   imported 73   skipped 0  removed 0  failed 0  (0.1s)
```

- `imported` — sessions newly stored or updated.
- `skipped` — sources unchanged since the last import (same size and modification time).
- `removed` — sessions whose source disappeared on disk.
- `failed` — bundles that could not be validated. The command exits `1` if any adapter errored or any bundle failed, `0` otherwise.

## Check what was stored

```sh
ls -lh ~/.scout/scout.db
```

That file is the whole product of the import: one record per session with token totals, call counts, model and mode history, compactions, tool calls by category, and the parent/child links between a session and its subagents. A plain SQLite browser is enough to explore it. What is — and is not — in there: [what-scout-knows.md](what-scout-knows.md).

To peek at raw data without touching the store at all:

```sh
bun run scout discover --adapter claude-code
```

This prints one short human-readable line per session to stdout, straight from the harness files, without writing anything.

## Next steps

- Import again later and only what changed is reprocessed → [how-to.md](how-to.md#re-import-after-more-work).
- Keep titles out of the database → [how-to.md](how-to.md#import-without-titles).
- Every flag and exit code → [commands.md](commands.md).
