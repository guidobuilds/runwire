# Adding a harness adapter

An adapter is a translator from one harness's on-disk format into Scout's normalized events. It never computes metrics, never keeps content, and never talks to the server. Read [ARCHITECTURE.md](../ARCHITECTURE.md) §3–§6 first.

## Checklist

1. **Survey the data.** Add a section to [harness-survey.md](../harness-survey.md): where sessions live per OS, file/DB layout, record types, where model/mode/usage/timestamps/subagent links come from, which fields are content, how versions differ. Do this with structure-only inspection (keys, counts), never by reading content.
2. **Create the package** `packages/adapter-<id>` from `packages/adapter-template`:
   - `src/index.ts` exports a `HarnessAdapter`.
   - `src/allowlist.ts` exports the `Projection` — the only fields the parser may keep.
   - `src/schema.ts` loose Zod schemas for the projected records.
   - `src/discover.ts`, `src/parse.ts`, `src/probe.ts`.
3. **Implement `probe`** (is the harness present? which roots?), **`discover`** (stat/readdir only — cheap, no parsing), **`parse`** (streaming; `meta` first; `diagnostic` instead of throwing).
4. **Map usage to canonical names** (`uncachedInput`, `cachedInput`, `cacheWrite`, `output`, `reasoningOutput`). Anything you had to compute goes in `derived`. Use `dedupeKey` if the harness can repeat an API call's usage. Use `usageTotal` if the harness only reports running totals.
5. **Declare `capabilities`** honestly — the UI uses them to tell "not provided by harness" from "missing in this session".
6. **Write `explain(field)`** for every usage/count field: one sentence stating the source field and its semantics. The compare view uses it to flag incomparable metrics. **Write `toolCategory(name)`** (total function, unknown → `other`) and declare `harnessEventNames` — the timeline depends on both, and the contract test rejects any `harnessEvent` outside the declared list.
7. **Fixtures** under `fixtures/<id>/<version>/…` produced with `scout fixture`, plus `fixtures/<id>/canary/` (every content field = `SCOUT_CANARY_<n>`) and `fixtures/<id>/malformed/`.
8. **Tests**: `import { adapterContract } from '@scout/core/test-kit'` and run it against your adapter and fixtures; add expected-summary snapshots per fixture.
9. **Register**: one line in `packages/server/src/adapters.ts`.
10. **Document**: `docs/adapters/<id>.md` with the mapping table, confidence expectations and the generated allowlist table (`bun run docs:allowlist`).

## Contract the test kit enforces

- First event per source is `meta` with a stable `sourceId`.
- No event key or string value outside the allowlisted projection reaches the reducer.
- Canary sentinel never appears in events, summaries, diagnostics or API output.
- Malformed fixture yields diagnostics and at least a `meta` event, never an exception.
- `discover` on the fixture root finds the expected number of roots and children.
- Every `usage` field emitted is a non-negative finite integer.
- `capabilities` are consistent with the events actually emitted on fixtures (a capability declared but never observed on any fixture fails the test; an event kind observed without its capability fails too).

## What is metadata, what is content

| Metadata (allowed) | Content (never) |
|---|---|
| ids, timestamps, durations | prompts, responses, reasoning |
| model ids, mode names, effort levels, harness versions | tool inputs and outputs |
| token counts, cost figures reported by the harness | file contents embedded in records |
| tool **names** and categories, tool-use ids, agent **types**, spawn depth | agent descriptions/prompts, summaries, generated titles (except D7's `title`) |
| counts of prose/thinking/tool-use blocks, tool-result error flags, hook/permission/mode event names | prose text, thinking text, hook stdout, injected context |
| cwd, repo root, branch, commit hash | remote URL in the UI (grouping key only) |
| record type/subtype names, counts of unknown records | the records themselves in diagnostics |
