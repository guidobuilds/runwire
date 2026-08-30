# Scout

Local code-agent session explorer. Reads local session data from supported coding-agent harnesses (Claude Code, Codex, Grok Build, OpenCode, Pi) and shows operational metadata and usage metrics — no prompts, no responses, no code, no reasoning.

Local-first, read-only, no account or telemetry. See [docs/PRODUCT.md](docs/PRODUCT.md) for the product brief, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, and [docs/PLAN.md](docs/PLAN.md) for the build sequence.

## Status

Foundations in progress (see [docs/PLAN.md](docs/PLAN.md) for the milestone sequence). The CLI below is currently a placeholder — `scout serve`, `scout scan` and the web app land in M3/M4. Not yet installable as a product.

## Setup

Requires [Bun](https://bun.sh) 1.3+.

```sh
bun install
```

## Running in dev (no build)

Runs the CLI's TypeScript source directly with Bun, restarting on file changes:

```sh
bun run dev
```

Equivalent to `bun --watch apps/scout/src/index.ts`. For a single run without the watcher: `bun apps/scout/src/index.ts`.

## Building and running the compiled binary

```sh
bun run build          # bun build --compile; writes apps/scout/dist/scout
./apps/scout/dist/scout
```

`bun run build` compiles every workspace package that defines a `build` script; today that is only `apps/scout`, producing a single native executable (~60 MB) for the current platform. Cross-compiling to other targets (macOS/Linux/Windows, arm64/x64) is done in CI — see [.github/workflows/build.yml](.github/workflows/build.yml) — via `bun build --compile --target=<target>`.

## Other checks

```sh
bun run test        # bun test, across every package
bun run typecheck   # tsc --noEmit, per package
bun run lint        # Biome + the workspace import-boundary check
```

## License

MIT — see [LICENSE](LICENSE).
