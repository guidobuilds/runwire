# Harness adapters

An adapter turns one harness's on-disk sessions into `SessionBundle`s ([ARCHITECTURE.md §3](../ARCHITECTURE.md#3-contract)). It owns all knowledge of its harness and computes every field itself; core only validates, persists, links and aggregates.

## What an adapter provides

| Provides | Kind | Purpose |
|---|---|---|
| `id`, `displayName`, `adapterVersion` | declaration | Identity. Bump `adapterVersion` when a mapping changes. |
| `capabilities` | declaration | Which fields this harness can report at all. Must match what the adapter actually emits (test kit). |
| `allowlist` | declaration | The only keys read from a raw record, as data ([§7](../ARCHITECTURE.md#7-privacy)). |
| `probe(ctx)` | function | Is the harness installed, and where. No parsing. |
| `discover(ctx, known)` | function | Streams one `SessionBundle` per session. Skips sources whose `(size, mtime)` matches `known`. |

## What it must compute

Every field of the bundle's `Session`, `Step[]`, `Project` and `Diagnostic[]` — definitions in [ARCHITECTURE.md §4](../ARCHITECTURE.md#4-what-an-adapter-computes). In short: dedup usage per API request, sum tokens, pick the primary model and mode, count turns/tool calls/compactions, bound timestamps, categorize tools, resolve the project, classify the initiator, and emit diagnostics instead of throwing.

## Metadata vs content

| Metadata (allowed) | Content (never) |
|---|---|
| ids, timestamps, durations | prompts, responses, reasoning |
| model ids, mode names, effort levels, harness versions | tool inputs and outputs |
| token counts, cost figures reported by the harness | file contents embedded in records |
| tool **names** and categories, tool-use ids, agent **types**, spawn depth | agent descriptions/prompts, summaries, generated titles (except D7's `title`) |
| tool-result error flags, hook/permission/mode event names | prose text, thinking text, hook stdout, injected context |
| cwd, repo root, branch, commit hash | remote URL in any display (grouping key only) |
| record type/subtype names, counts of unknown records | the records themselves in diagnostics |

## Adding a harness

1. **Survey** — add a section to [harness-survey.md](../harness-survey.md): paths per OS, layout, record types, where model/mode/usage/timestamps/links live, which fields are content. Structure only, never content.
2. **Package** — `packages/adapter-<id>`: `src/index.ts` (the `HarnessAdapter`), `src/allowlist.ts`, `src/schema.ts` (loose Zod), `src/discover.ts`, `src/probe.ts`. Depends on `@scout/core` only.
3. **Allowlist** — the projection is the first thing applied to every raw record.
4. **Discover** — walk the harness's roots; honor `known`; stream one bundle per session; never throw on a bad record.
5. **Compute** — everything in ARCHITECTURE §4, with canonical token names (D5) and tool categories (D31).
6. **Fixtures** — `fixtures/<id>/<case>/` redacted sessions, plus `canary/` (every content field = `SCOUT_CANARY_<n>`) and `malformed/`.
7. **Contract kit** — `import { adapterContract } from '@scout/core/test-kit'`; run it against the adapter and its fixtures. Add per-fixture expected-session snapshots.
8. **Register** — add the adapter to the registry in `packages/cli/src/adapters.ts` (D76). Core holds no registry; `importAll({ adapters, db, ctx })` receives the list.
9. **Document** — `docs/adapters/<id>.md`: location/layout, allowlist, record → field mapping, tool categories, capabilities, known variations, fixtures.
