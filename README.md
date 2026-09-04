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

## Docs

- [docs/PRODUCT.md](docs/PRODUCT.md) — purpose, principles, scope.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the core/adapter contract, schema, import flow.
- [docs/DECISIONS.md](docs/DECISIONS.md) — numbered decisions (`D<n>`).
- [docs/adapters/README.md](docs/adapters/README.md) — how to add a harness; [docs/adapters/claude-code.md](docs/adapters/claude-code.md) is the worked example.

## License

MIT — see [LICENSE](LICENSE).
