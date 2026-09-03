# Contributing

Scout's foundations are documented under [docs/](docs/). Technical docs (how the system works) and product docs (what it's for) are kept separate:

**Technical — start here as a new contributor:**
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), section "Start here" — the domain model, the event catalog, and how one raw record becomes a `SessionSummary`. Read this before touching any package.
- [docs/adapters/README.md](docs/adapters/README.md) — what any harness adapter must provide, and how to build a new one.
- [docs/adapters/claude-code.md](docs/adapters/claude-code.md) — the worked example: where Claude Code stores sessions and exactly how each record maps to an event.
- [docs/ENTITIES.md](docs/ENTITIES.md) — the entity catalog (properties, relationships) behind the domain model.
- [docs/harness-survey.md](docs/harness-survey.md) — raw structure notes per harness, ahead of building its adapter.
- [docs/DECISIONS.md](docs/DECISIONS.md) — design-review outcomes and their rationale, referenced as `D<n>` throughout the above.

**Product** (brief only for now — the UI is early and changes fast, so no functional/UX documentation is maintained yet):
- [docs/PRODUCT.md](docs/PRODUCT.md) — the product brief.
- [docs/PLAN.md](docs/PLAN.md) — milestones.

## Workflow

- `bun run test` and `bun run lint` before committing.
- Workspace import boundaries (ARCHITECTURE §1) are enforced in CI; an adapter package must depend on `core` only.
- Any code that reads harness data must go through an adapter's declared allowlist (ARCHITECTURE §6) and ship a canary fixture.
