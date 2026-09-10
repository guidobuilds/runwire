- OpenCode adapter: reads the `opencode.db` / `opencode-tui-v2.db` stores read-only via
  `openSqliteReadonly`, and computes one `SessionBundle` per session. Imports
  `@scout/core` only, never another adapter. Owns all harness knowledge (D68).

# Checks

```sh
cd packages/adapter-opencode
bun test
bun run typecheck
```

# Tests

- `src/index.test.ts` runs `adapterContract` from `@scout/core/test-kit` over
  `fixtures/opencode/all` (current + legacy union).
- Per-case snapshots in `fixtures/opencode/<case>/expected.json`; regenerate with
  `UPDATE_EXPECTED=1 bun test`.
- `canary/` must never leak `SCOUT_CANARY_<n>` into a bundle; `malformed/` must yield
  diagnostics, not throw.
- Use `createBunFs()` (its virtual SQLite reader); never touch the real
  `~/.local/share/opencode`.

# Changing a mapping

Bump `adapterVersion`, keep `capabilities` in sync with what is emitted, and regenerate
the expected snapshots. The connector (`src/connector/`) is metadata-only: no content
parts, no `rawBase64`.
