# Scout

Local code-agent session explorer. Reads local session data from supported coding-agent harnesses (Claude Code, Codex, Grok Build, OpenCode, Pi) and shows operational metadata and usage metrics — no prompts, no responses, no code, no reasoning.

Local-first, read-only, no account or telemetry. See [docs/PRODUCT.md](docs/PRODUCT.md) for the product brief, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, and [docs/PLAN.md](docs/PLAN.md) for the build sequence.

## Status

Foundations in progress. Not yet installable.

## Development

Requires [Bun](https://bun.sh) 1.3+.

```sh
bun install
bun run test
bun run typecheck
bun run lint
bun run build
```

## License

MIT — see [LICENSE](LICENSE).
