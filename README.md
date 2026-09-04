# Scout

Local, read-only explorer of coding-agent sessions. Reads the session files a harness (Claude Code first) leaves on disk, keeps only operational metadata and usage metrics — no prompts, responses, code or reasoning — and stores them in SQLite so the token and time waste of a hand-built agent harness becomes visible.

## Current scope

- `packages/core` — contract types, SQLite store, import orchestrator, contract test kit.
- `packages/adapter-claude-code` — the Claude Code adapter.

A web front end, an API and more harnesses come later.

## Setup

Requires [Bun](https://bun.sh) 1.3+.

```sh
bun install
```

## Checks

```sh
bun run test        # bun test in every package
bun run typecheck   # tsc --noEmit per package
bun run lint        # Biome + workspace import-boundary check
```

## Commands

```sh
bun run scout import [--adapter <id>] [--home <dir>] [--db <path>] [--no-titles]
bun run scout discover --adapter claude-code --json
```

`scout import` runs every registered adapter (or just the one named by `--adapter`) and stores
its sessions in `~/.scout/scout.db` by default; `--db <path>` overrides the DB location and
`--db :memory:` is allowed. `--home <dir>` overrides where the adapter looks for harness data
(defaults to the real OS home). `--no-titles` drops session titles from what's stored (D7).
`scout import` prints an `ImportReport` to stderr — one line per adapter with discovered/
imported/skipped/removed/failed counts — and exits `1` if any adapter errored or a bundle failed
validation, `0` otherwise.

`scout discover --adapter <id> [--home <dir>] [--json]` streams that adapter's bundles read-only,
without writing to any store. `--json` writes one `SessionBundle` per line (NDJSON) to stdout and
nothing else, so `bun run scout discover --adapter claude-code --json > out.json` is safe to pipe;
without `--json` it prints one terse human-readable line per bundle instead. All logs and errors
always go to stderr.

### Inventory

```sh
bun run scout discover --adapter claude-code --json | jq -s '.' > claude-inventory.json
```

`jq -s '.'` wraps the NDJSON lines into a single JSON array — easiest to open and analyze in one
file. Use `jq -c '.'` instead to keep one JSON object per line (NDJSON), handy for streaming or
re-piping. Because scout's logs and errors go to stderr, they never contaminate the JSON on stdout
here either. In the saved array, each step with `toolCategory === "skill"` carries the skill name in
its `skillName` field.

## Docs

- [docs/PRODUCT.md](docs/PRODUCT.md) — purpose, principles, scope.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the core/adapter contract, schema, import flow.
- [docs/DECISIONS.md](docs/DECISIONS.md) — numbered decisions (`D<n>`).
- [docs/adapters/README.md](docs/adapters/README.md) — how to add a harness; [docs/adapters/claude-code.md](docs/adapters/claude-code.md) is the worked example.

## License

MIT — see [LICENSE](LICENSE).
