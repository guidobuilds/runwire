- Always read the package-level AGENTS.md before touching a package:
  `packages/core`, `packages/server`, `packages/web`, `packages/cli`,
  `packages/adapter-claude-code`, `packages/adapter-opencode`.

# Setup

- Bun 1.3+: `bun install`.
- Docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (contract, schema, import flow),
  [docs/DECISIONS.md](docs/DECISIONS.md) (`D<n>`), [CONTRIBUTING.md](CONTRIBUTING.md).

# Checks

Run after every task, in CI order:

```sh
bun run lint       # Biome + dependency-cruiser import boundaries
bun run typecheck  # tsc --noEmit per package
bun run test       # bun test per package, vitest in web
```

Never run bare `bun test` at the repo root: `bunfig.toml` excludes `packages/web/**`,
so it silently skips the web suite. One package: `cd packages/<pkg> && bun test`
(web: `bun run test`).

# Import boundaries

Enforced by `bun run boundaries` (ARCHITECTURE §2):

- `core` imports nothing from the repo.
- `adapter-*` imports `@runwire/core` only.
- `server` imports `@runwire/core` only.
- `cli` is the composition root: core + adapters + server.
- `web` has zero runtime repo imports; it talks to the server over HTTP.

# Privacy

Nothing leaves an adapter that is not on its allowlist. Never persist or log prompts,
responses, code, tool I/O or reasoning; harness titles are the one opt-in exception (D7).
Every adapter ships a canary fixture and must pass `@runwire/core/test-kit`.

# Style

Biome: single quotes, semicolons, trailing commas, 100 cols. TS is `strict` with
`noUncheckedIndexedAccess`. Code is self-explanatory: do not add comments; improve names or
`docs/` instead. `docs/` is the source of truth — update it when behavior changes.

# Public repository rules

- Runwire is **beta**; say so when describing scope or status.
- Never write personal paths, secrets, session identifiers or private ticket identifiers in any
  tracked file, including comments, tests, docs and commit content. Reference issues in the pull
  request instead.
- Fixtures must stay synthetic or fully redacted; never commit real prompts, responses or tool I/O.

