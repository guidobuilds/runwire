# Contributing

Thanks for taking a look at Runwire. It is an early-beta project, so small, focused changes are
much easier to review than large rewrites.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues must be
reported privately as described in [SECURITY.md](SECURITY.md).

## Setup

```sh
git clone https://github.com/guidobuilds/runwire.git
cd runwire
bun install
```

Bun 1.3 or newer is required. There is no global install; use `bun run runwire <command>`.

## Before opening a pull request

Run the same checks CI runs, in this order:

```sh
bun run lint       # Biome + dependency-cruiser import boundaries
bun run typecheck  # tsc --noEmit in every package
bun run test       # bun test per package, Vitest in packages/web
```

Do not run a bare `bun test` at the repository root: `bunfig.toml` excludes `packages/web`, so it
silently skips the web suite. To run one package, `cd packages/<name> && bun test`; for the web
package use `bun run test`.

## Architecture and boundaries

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing a package. The import boundaries
are enforced in CI:

- `core` imports nothing else from the repository.
- `adapter-*` imports `@runwire/core` only, never another adapter.
- `server` imports `@runwire/core` only.
- `cli` is the composition root: it may import core, adapters and server.
- `web` has no runtime repository imports; it talks to the server over HTTP.

## Privacy rules

Runwire must never persist or log prompts, responses, code, tool input/output or reasoning.
Harness-generated titles are the single exception, and only when titles are enabled.

- Every field an adapter reads must be on its allowlist.
- A malformed record yields a diagnostic, never an exception and never the record itself.
- Every adapter ships a canary fixture and must pass `@runwire/core/test-kit`.
- Do not add logging that prints raw harness records.

If a change needs a new field, add it to the contract, the allowlist, the test kit and the docs
together.

## Adding a harness adapter

[docs/adapters/README.md](docs/adapters/README.md) describes the adapter contract, the required
fixtures and the registration step. Start with a structure-only survey in
[docs/harness-survey.md](docs/harness-survey.md); never commit real prompts or tool output.

## Style

- Biome: single quotes, semicolons, trailing commas, 100 columns.
- TypeScript is `strict` with `noUncheckedIndexedAccess`.
- Code should be self-explanatory. Runwire does not use explanatory comments: if a change needs
  one, improve the names or the documentation instead.
- `docs/` is the source of truth. Update it when behavior changes.

## Commits and pull requests

- Keep commits focused and give them a conventional prefix where it fits (`feat:`, `fix:`,
  `docs:`, `test:`, `chore:`).
- Reference the issue in the pull request, not in source files, comments or docs.
- Describe what changed, why, and how you checked it. Include the commands you ran.
- Do not include generated files (`packages/web/dist`), local databases, agent state directories or
  editor settings.
- New user-facing text in the web UI is written in English.
