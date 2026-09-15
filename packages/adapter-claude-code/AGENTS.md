- Claude Code adapter: turns `~/.claude/projects` sessions into `SessionBundle`s.
  Imports `@runwire/core` only, never another adapter. Owns all harness knowledge (D68).

# Checks

```sh
cd packages/adapter-claude-code
bun test
bun run typecheck
```

# Tests

- `src/index.test.ts` runs `adapterContract` from `@runwire/core/test-kit` over
  `fixtures/claude-code/all`.
- Per-case snapshots in `fixtures/claude-code/<case>/expected.json`; regenerate
  deliberately with `UPDATE_EXPECTED=1 bun test`.
- Fixtures are redacted and each case has `home/`. `canary/` puts `RUNWIRE_CANARY_<n>` in
  every content field and it must never appear in a bundle; `malformed/` must yield
  diagnostics, not throw.
- Use `createBunFs()`; never touch the real `~/.claude`.

# Changing a mapping

Bump `adapterVersion`, update `capabilities` to match what is emitted, and regenerate
the expected snapshots.
