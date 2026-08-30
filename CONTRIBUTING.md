# Contributing

Scout's foundations are documented under [docs/](docs/):

- [docs/PRODUCT.md](docs/PRODUCT.md) — the product brief.
- [docs/DECISIONS.md](docs/DECISIONS.md) — design-review outcomes and their rationale.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the contract between packages: domain model, event catalog, adapter interface, privacy boundary.
- [docs/PLAN.md](docs/PLAN.md) — milestones.

Adding a new harness adapter starts at [docs/adapters/README.md](docs/adapters/README.md).

## Workflow

- `bun run test` and `bun run lint` before committing.
- Workspace import boundaries (ARCHITECTURE §1) are enforced in CI; an adapter package must depend on `core` only.
- Any code that reads harness data must go through an adapter's declared allowlist (ARCHITECTURE §6) and ship a canary fixture.
