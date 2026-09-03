# How a harness adapter works

An adapter is a translator from one harness's on-disk format into Scout's normalized events — nothing more. It never computes a metric, never keeps prompt/response content, and never talks to the server or another adapter. Read [ARCHITECTURE.md](../ARCHITECTURE.md) §2–§4 first (domain model, event catalog, adapter contract); this document is the practical "how to build one" companion to that contract.

## What an adapter must provide

Every adapter implements the same `HarnessAdapter` interface (ARCHITECTURE.md §4). Concretely, that's five functions and three declarations — this is the complete list of what "providing a harness" means in Scout:

| Provides | Kind | Purpose |
|---|---|---|
| `probe(ctx)` | function | Is this harness installed on this machine, and where? Cheap: check known paths, no parsing. |
| `discover(ctx)` | function | Stream `SourceRef`s (one per session file/row) — `stat`/`readdir` only, no file content read. This is how Scout finds sessions without parsing all of them up front. |
| `parse(ref, ctx)` | function | Stream `ScoutEvent`s for one `SourceRef` — the actual translation (see "The shape of `parse`'s output" below). |
| `explain(field)` | function | One sentence per usage/count field: what raw field it comes from and what it means. Powers the "why is this value shown this way" tooltip and the compare view's incomparable-metric flag. |
| `toolCategory(name)` | function | Maps a harness-specific tool name to one of the fixed `ToolCategory` values (`read`, `write`, `exec`, …) — must be total; unknown names fall back to `other`. |
| `capabilities` | declaration | Which dimensions this harness can report at all (per-call usage? cache-write tokens? cost? subagents?). This is what lets the UI say "not provided by this harness" instead of a wrong zero — see ARCHITECTURE.md §2.1. |
| `allowlist` | declaration | The only fields this adapter is permitted to read out of a raw record, as data (ARCHITECTURE.md §6) — not something you're trusted to just "not read", it's mechanically enforced by `core.project()` before anything else touches the record. |
| `harnessEventNames` | declaration | The fixed, finite vocabulary this adapter's `harnessEvent` events may use (e.g. `hook:PreToolUse`, `permission`). A free-form name is rejected by the contract test — this is what keeps hook output and command text out of the timeline. |

The one thing an adapter never provides is arithmetic: it does not sum, deduplicate, or decide a confidence level. It emits raw-but-mapped numbers (canonical field names, ARCHITECTURE.md §2.2) and lets `core`'s reducer (ARCHITECTURE.md §3.2) do everything downstream. If you find yourself writing a sum or an `if (a !== b) confidence = 'low'` inside an adapter, that logic belongs in `core` instead.

### The shape of `parse`'s output

`parse` returns an `AsyncIterable<ScoutEvent>` — the same fixed event catalog for every harness (ARCHITECTURE.md §3.1: `meta`, `link`, `initiator`, `usage`, `toolCall`, `turn`, `model`, `mode`, `compaction`, `harnessEvent`, `diagnostic`, …). Two rules make this translation mechanical rather than creative:

1. **Field names are already canonical.** `usage.uncachedInput` means the same thing whether it came from Claude Code's `input_tokens` or Codex's `input_tokens − cached_input_tokens`; the adapter's job is the lookup (or, when it had to compute something, recording that in `derived`), never inventing a new field.
2. **Nothing free-form leaves the adapter.** Every string an event carries — a tool name, a mode, a `harnessEvent.name` — is drawn from a small, adapter-declared vocabulary. There is no field for "whatever text was in the record."

For the fully worked example of this translation — real record shapes in, real events out — see [claude-code.md](claude-code.md).

## Building a new adapter

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
