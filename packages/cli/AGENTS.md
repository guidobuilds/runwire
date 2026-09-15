- Composition root (D76): the only package that knows which adapters exist. Imports
  `@runwire/core`, `@runwire/adapter-*` and `@runwire/server`.
- `src/adapters.ts` is the adapter registry — register a new harness there.

# Checks

```sh
cd packages/cli
bun test
bun run typecheck
```

# Tests

- Inject fakes at the seams (e.g. `createServer` in `serve.test.ts`) instead of
  starting a real server or touching `~/.runwire`.
- Trigger shutdown with `process.emit('SIGINT')` and assert the fake was stopped;
  `runServe` removes its handlers so tests don't accumulate them.
