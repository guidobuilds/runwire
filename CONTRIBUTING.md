# Contributing

Docs live under [docs/](docs/):

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the core/adapter contract, SQLite schema, import flow, test kit. Read before touching any package.
- [docs/adapters/README.md](docs/adapters/README.md) — what an adapter provides and how to add a harness.
- [docs/adapters/claude-code.md](docs/adapters/claude-code.md) — the worked example.
- [docs/harness-survey.md](docs/harness-survey.md) — raw structure notes per harness, ahead of its adapter.
- [docs/DECISIONS.md](docs/DECISIONS.md) — numbered decisions, referenced as `D<n>`.
- [docs/PRODUCT.md](docs/PRODUCT.md) — purpose, principles, scope.
- [docs/adr/](docs/adr/) — architecture decision records.

## Workflow

- `bun run test` and `bun run lint` before committing.
- Import boundaries (ARCHITECTURE §2) are enforced in CI: `core` imports nothing from the repo; an adapter imports `@scout/core` only.
- Any code that reads harness data goes through the adapter's declared allowlist (ARCHITECTURE §7) and ships a canary fixture.
