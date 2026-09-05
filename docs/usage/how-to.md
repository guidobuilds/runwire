# How-to guides

Recipes for the specific things Scout can do today. The basics are in [getting-started.md](getting-started.md); every flag is documented in [commands.md](commands.md).

## Import only one harness

```sh
bun run scout import --adapter claude-code
```

Adapter ids are `claude-code` and `opencode`. Without `--adapter`, every registered adapter runs. Use this when one harness is not the one you are auditing right now.

## Import to a different database

```sh
bun run scout import --db /tmp/experiment.db
bun run scout import --db :memory:
```

The default location is `~/.scout/scout.db`. `--db` points elsewhere; `:memory:` runs a full import in RAM — useful to test an import without touching the real store. An alternate DB starts empty and gets a full import.

## Import without titles

```sh
bun run scout import --no-titles
```

Harness-generated session titles are the only content-derived data Scout can store. `--no-titles` drops them at import time — what is never written cannot leak. The choice is per import; a later import with titles enabled will fill them in.

## Re-import after more work

```sh
bun run scout import
```

Run it whenever you want a fresher picture; there is no watcher (decision D19). The import is incremental:

- A source whose size and modification time match what was stored is skipped — for Claude Code, a root session and all of its subagents are skipped (or reprocessed) together.
- Sources that no longer exist are removed from the database, together with their steps and diagnostics. Removal is only computed after a full successful discovery pass; an interrupted or failed import never deletes anything.

## Export an inventory without importing

```sh
bun run scout discover --adapter claude-code --json > inventory.jsonl
```

`discover` streams each session read-only, straight from the harness, without touching any store. With `--json`, stdout carries exactly one JSON object per line (NDJSON) and nothing else — safe to pipe. Logs and errors always go to stderr, so they never contaminate the file.

Without `--json`, each session is printed as one terse human-readable line instead.

## Wrap the NDJSON into a single JSON array

```sh
bun run scout discover --adapter claude-code --json | jq -s '.' > claude-inventory.json
```

`jq -s '.'` collects the lines into one array — the easiest form to open and analyze as a single file. Use `jq -c '.'` to keep one object per line for streaming or re-piping.

## Point Scout at another home directory

```sh
bun run scout import --home /path/to/fixtures/home
```

`--home` overrides where adapters look for harness data (default: the real OS home). Use it to scan a copied home, a test fixture, or another user's data — without changing your own.

## Import a single session's shape for inspection

```sh
bun run scout discover --adapter opencode --json | head -1 | jq
```

One full session bundle — project, session record, steps, diagnostics — pretty-printed. Useful to see exactly which fields a harness contributes; per-adapter field mappings are documented in [docs/adapters/](../adapters/).
