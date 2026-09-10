- Bun + `bun:test`. `core` is standalone: it must not import any other workspace package.
- `@scout/core/test-kit` is the public surface adapters test against; change the
  contract and the kit changes with it.

# Checks

```sh
cd packages/core
bun test
bun run typecheck   # lint from the repo root
```

# Tests

- Use `openStore(':memory:')` for SQLite and `createMemoryFs()` for the adapter FS.
- `src/test-kit/contract.ts` (`adapterContract`) is the suite every adapter must pass;
  extend it when the contract grows.
- Fixture snapshots live in `fixtures/<harness>/expected.json`; regenerate deliberately
  with `UPDATE_EXPECTED=1 bun test`.
- Assert on metadata, counts and diagnostics — never on content fields.

# Contract

- `src/contract/types.ts` + `schema.ts` are the source of truth. TS camelCase ↔ SQL
  snake_case (ARCHITECTURE §3, §5).
- A malformed record yields a `Diagnostic`, never an exception.
- Schema/store migrations are guarded and run in one transaction (ARCHITECTURE §6).
