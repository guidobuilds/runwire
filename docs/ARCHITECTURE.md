# Architecture

Foundations for Scout. This document is the contract between `core`, the adapters, the server and the web app. Anything that touches more than one package is decided here.

Related: [PRODUCT.md](PRODUCT.md) (brief), [DECISIONS.md](DECISIONS.md) (review outcomes), [PLAN.md](PLAN.md) (milestones), [adapters/README.md](adapters/README.md) (how to add a harness), [harness-survey.md](harness-survey.md) (what the source data looks like).

## 0. Overview

```text
 harness data on disk                Scout process (Bun)                         browser
 ───────────────────────             ─────────────────────────────────────       ──────────────
 ~/.claude/projects/**  ─┐           adapter-claude-code ─┐
 ~/.codex/sessions/**   ─┼─ read ──▶ adapter-codex       ─┼─▶ events ─▶ core ─▶ in-memory store ─▶ Hono API ─▶ React app
 ~/.grok/sessions/**    ─┤  only     adapter-grok        ─┤            reducer   (summaries,        (typed hc)   (TanStack)
 opencode-tui-v2.db     ─┘           adapter-opencode    ─┘            link      rollups,
                                                                       rollup   projects,
                                                                       project  diagnostics)
```

Four invariants:

1. **Adapters never compute metrics.** They translate harness records into normalized events. All arithmetic, deduplication, rollups and confidence rules live in `core`.
2. **Nothing leaves an adapter that is not on its allowlist.** The allowlist is data, not prose, and a canary test proves it.
3. **The server owns no durable state.** Rescan rebuilds everything from source data.
4. **One event stream, two consumers.** The summary reducer and the trace builder (timeline) fold the same `ScoutEvent`s. An adapter that emits per-step events gets the timeline for free.

## 1. Packages and dependency rules

Bun workspaces. Every package is TypeScript with `"type": "module"`, built by Bun; no Node-specific APIs in server code.

```text
scout/
  package.json                 workspaces, root scripts (test, lint, build, dev)
  bunfig.toml
  biome.json
  tsconfig.base.json
  apps/
    scout/                     CLI: serve, scan, doctor, fixture. Builds the binaries.
  packages/
    core/                      domain model, events, reducer, adapter contract, registry, scan pipeline,
                               project identity, privacy projection, comparability, contract test kit
    adapter-claude-code/       first adapter (MVP)
    adapter-codex/             second (proof of modularity)
    adapter-grok/              later
    adapter-opencode/          later
    adapter-pi/                later
    server/                    Hono app, in-memory store, static serving of the web build
    web/                       Vite + React app
  fixtures/                    redacted sessions per harness and version (see §11)
  docs/
```

Allowed imports (enforced by workspace `dependencies` and a Biome/`dependency-cruiser` rule in CI):

| Package | May import |
|---|---|
| `core` | nothing from the repo |
| `adapter-*` | `core` only |
| `server` | `core`, every `adapter-*` (through one registry file) |
| `web` | `core` (types only) and `server` (the `AppType` for `hc`) |
| `apps/scout` | `server`, `web` (built assets) |

An adapter that imports `server` or another adapter fails CI.

## 2. Domain model

All types live in `packages/core/src/model/`. They are the JSON shapes served by the API; there is no separate DTO layer.

### 2.1 Metric

Every number or label that came from source data carries its own provenance:

```ts
type Confidence = 'high' | 'medium' | 'low';

type Metric<T = number> = {
  value: T;
  confidence: Confidence;
  source: string;   // machine-readable origin, e.g. "claude-code/assistant.usage#requestId"
  note?: string;    // human-readable caveat, e.g. "derived: input − cached"
};
```

Why per metric rather than per block (D22): a single session can have an exact `output` and a derived `uncachedInput`. A block-level label would have to report the worst case for both and the UI could not say which number is the shaky one. `Metric<T>` costs verbosity, nothing else.

A field that is **absent** means "no value". The UI distinguishes two absences using the adapter's `capabilities`:

- capability absent → *not provided by this harness*;
- capability present, field absent → *missing in this session*.

Confidence rules are fixed in the reducer (§3.3), not chosen by adapters.

### 2.2 Usage and counts

```ts
type Usage = {
  uncachedInput?: Metric;   // prompt tokens billed at full price
  cachedInput?: Metric;     // prompt tokens served from cache
  cacheWrite?: Metric;      // prompt tokens written to cache (Anthropic cache_creation; 0/absent elsewhere)
  output?: Metric;          // all generated tokens, reasoning included
  reasoningOutput?: Metric; // subset of output that is reasoning/thinking
  totalInput?: Metric;      // uncachedInput + cachedInput (+ cacheWrite) — always derived, for display
};

type Counts = {
  turns?: Metric;        // human prompts; not rolled up
  apiCalls?: Metric;     // model requests
  toolCalls?: Metric;
  compactions?: Metric;
  subagents?: Metric;    // descendants in the tree; rollup only
};
```

Mapping notes per harness are in each adapter document; the canonical definitions are:

| Canonical | Anthropic-style (Claude Code) | OpenAI-style (Codex) | Grok Build | OpenCode |
|---|---|---|---|---|
| `uncachedInput` | `input_tokens` | `input_tokens − cached_input_tokens` (derived, medium) | to verify (survey) | `tokens_input` |
| `cachedInput` | `cache_read_input_tokens` | `cached_input_tokens` | `cachedReadTokens` | `tokens_cache_read` |
| `cacheWrite` | `cache_creation_input_tokens` | absent | `cacheCreationTokens` | `tokens_cache_write` |
| `output` | `output_tokens` | `output_tokens` | `outputTokens` | `tokens_output` |
| `reasoningOutput` | `output_tokens_details.thinking_tokens` | `reasoning_output_tokens` | `reasoningTokens` | `tokens_reasoning` |

### 2.3 SessionSummary

```ts
type HarnessId = 'claude-code' | 'codex' | 'grok' | 'opencode' | 'pi';   // registry-driven; string at the boundary

type SessionSummary = {
  id: string;                         // `${harness}:${sourceId}`; stable across rescans
  harness: HarnessId;
  harnessVersion?: { first: string; last: string };
  parentId?: string;                  // absent on roots
  relation?: 'subagent' | 'teammate' | 'fork';
  depth: number;                      // 0 for roots
  agentType?: string;                 // e.g. "Explore", "forge-adversary" — a name, not a prompt
  title?: { value: string; contentDerived: true };   // D7: the one content-derived field
  project: ProjectRef;
  cwd: { first: string; all: string[] };
  git?: { branch?: string; commit?: string; repoName?: string };
  timing: { startedAt?: Metric<string>; endedAt?: Metric<string>; durationMs?: Metric };
  model: { primary?: Metric<string>; all: string[]; changes: number };
  mode?: { primary?: Metric<string>; all: string[]; changes: number };
  effort?: Metric<string>;
  flags: { resumed?: boolean; forkedFrom?: string; versionChanged?: boolean };
  usage: Usage;                       // exclusive
  counts: Counts;                     // exclusive (subagents absent here)
  cost?: Metric<{ usd: number }>;     // harness-reported only (D6)
  children: string[];                 // ids of direct children
  source: { path: string; sizeBytes: number; mtimeMs: number };
  diagnostics: Diagnostic[];
};

type ProjectRef = {
  key: string;          // grouping key: remote URL (normalized) → repo root → cwd, in that order (D8, D9)
  name: string;         // displayed: repo name or last path segment
  repoRoot?: string;
  worktree?: string;    // worktree name when cwd is inside a linked worktree
  identity: 'remote' | 'repo-root' | 'cwd';
};

type Diagnostic = {
  level: 'info' | 'warn' | 'error';
  code: string;         // e.g. "unknown-record-type", "usage-total-mismatch", "no-cwd"
  message: string;      // never contains record content
  harness: HarnessId;
  path: string;
  line?: number;
  count?: number;       // aggregated duplicates
};
```

### 2.4 Rollups

Computed by `core` after linking, never by adapters:

```ts
type SessionRollup = {
  id: string;
  exclusive: { usage: Usage; counts: Counts };
  inclusive: { usage: Usage; counts: Counts & { subagents: Metric } };
  descendants: number;
};
```

Inclusive = exclusive + Σ descendants, field by field; confidence of a rolled-up field = min over contributors; a missing field in any contributor produces a `note: "partial: n of m agents reported"` and `medium` at best. Turns are copied from the root, not summed (see DECISIONS).

### 2.5 Aggregates

`ProjectAggregate` and `HarnessAggregate` (for the two list views) are computed from root summaries only (D2): session count, harness/project sets, latest activity, aggregate inclusive usage.

### 2.6 SessionTrace (timeline)

The per-step view behind the timeline (D28–D35). Built on demand, never stored (D29).

```ts
type ToolCategory = 'read' | 'write' | 'exec' | 'search' | 'plan' | 'agent' | 'web' | 'mcp' | 'other';

type UsageNumbers = { uncachedInput: number; cachedInput: number; cacheWrite: number; output: number; reasoningOutput: number };

type TraceStep = { i: number; at?: string } & (
  | { kind: 'call'; model: string; usage?: Partial<UsageNumbers>; cum: UsageNumbers;   // one model request
      blocks: { text: number; thinking: number; toolUse: number } }                      // ¶ prose / thinking / tool-use blocks in the response
  | { kind: 'tool'; category: ToolCategory; name: string; callId?: string;
      durationMs?: number; error?: boolean; childId?: string }                           // childId when the call spawned a known subagent
  | { kind: 'turn'; durationMs?: number }                                                // human prompt → phase boundary
  | { kind: 'harness'; name: string }                                                    // hook:PreToolUse:Bash, permission, plan-mode, auto-mode…
  | { kind: 'compaction'; preTokens?: number; postTokens?: number }
  | { kind: 'model-change'; from: string; to: string }
  | { kind: 'mode-change'; from?: string; to: string }
);

type SessionTrace = {
  id: string;
  steps: TraceStep[];
  models: string[];
  axis: { steps: number; startedAt?: string; endedAt?: string };
  totals: UsageNumbers;            // equals the summary's exclusive usage
  truncated?: boolean;
};
```

Every field is either a number, a boolean, an id, a model/tool/hook/mode **name** or a category. Nothing in a trace can carry text from the session.


Adapters emit a stream of `ScoutEvent`s per source; `core` folds them into a `SessionSummary` (D20). The adapter is a translator; the reducer owns the semantics.

### 3.1 Event catalog

```ts
type At = string;   // ISO-8601 UTC

type ScoutEvent =
  | { kind: 'meta'; sourceId: string; role: 'root' | 'child';
      harnessVersion?: string; cwd?: string; title?: string;
      git?: { branch?: string; commit?: string; remote?: string }; at?: At }
  | { kind: 'link'; parentSourceId: string; relation: 'subagent' | 'teammate' | 'fork';
      agentType?: string; depth?: number; viaCallId?: string }   // viaCallId: the parent's tool call that spawned this child
  | { kind: 'observed'; at: At }                       // any timestamped record; feeds start/end bounds
  | { kind: 'model'; model: string; at?: At }
  | { kind: 'mode'; mode: string; at?: At }
  | { kind: 'effort'; effort: string; at?: At }
  | { kind: 'cwd'; cwd: string; at?: At }
  | { kind: 'version'; version: string; at?: At }
  | { kind: 'usage'; dedupeKey?: string; model?: string; at?: At;
      uncachedInput?: number; cachedInput?: number; cacheWrite?: number;
      output?: number; reasoningOutput?: number;
      derived?: Array<keyof Usage>;
      blocks?: { text?: number; thinking?: number; toolUse?: number } }   // per API call; blocks are summed across dedupe duplicates
  | { kind: 'usageTotal'; at?: At;                     // cumulative snapshot; reducer keeps the last
      uncachedInput?: number; cachedInput?: number; cacheWrite?: number;
      output?: number; reasoningOutput?: number; derived?: Array<keyof Usage> }
  | { kind: 'turn'; at?: At; durationMs?: number }
  | { kind: 'toolCall'; at?: At; name: string; category: ToolCategory; callId?: string; durationMs?: number }
  | { kind: 'toolResult'; at?: At; callId?: string; name?: string; error: boolean; durationMs?: number }
  | { kind: 'harnessEvent'; at?: At; name: string }     // fixed vocabulary per adapter: 'hook:<hookName>', 'permission', 'plan-mode', 'auto-mode', 'nudge'…
  | { kind: 'compaction'; at?: At; trigger?: string; preTokens?: number; postTokens?: number }
  | { kind: 'cost'; usd: number; at?: At }
  | { kind: 'flag'; flag: 'resumed'; value: true } | { kind: 'flag'; flag: 'forkedFrom'; value: string }
  | { kind: 'diagnostic'; level: Diagnostic['level']; code: string; message: string; line?: number };
```

Rules for adapters:

- The first event for a source must be `meta`.
- `usage` carries canonical field names already (the mapping is a lookup, not arithmetic). Fields the adapter had to compute go in `derived`.
- `dedupeKey` must be set whenever the harness may write the same API call more than once (Claude Code `requestId`).
- Emit `usageTotal` when the harness only reports running totals (Codex `token_count`, OpenCode session row). Emitting both `usage` and `usageTotal` is allowed and enables a cross-check.
- Never throw for a bad record: emit `diagnostic` and continue. Throw only when the source cannot be opened at all.
- Tool names, agent types, model ids, mode names and version strings are metadata. Tool inputs, tool outputs, prompts, file contents and reasoning are not, and must never appear in any event field — including `diagnostic.message`.
- `toolCall.category` comes from the adapter's `toolCategory(name)` (§4). `toolResult` is paired to its call by `callId` when the harness has one, otherwise by order.
- `harnessEvent.name` is drawn from a fixed vocabulary declared by the adapter (a `const` array). Free-form names are rejected by the contract test — this is what keeps hook output and command text out.
- Emit events in source order; the trace builder relies on it.

### 3.2 Reducer

`reduce(events: AsyncIterable<ScoutEvent>, ctx): Promise<ReducedSession>` in `packages/core/src/reduce/`.

- **Bounds:** `startedAt` = min `at` over all events with a timestamp; `endedAt` = max; `durationMs` = difference.
- **Usage:** if any `usage` events: group by `dedupeKey` (events without a key are unique), keep one per key, sum per field. Else if `usageTotal` events: take the last one. Else: usage fields absent.
- **Cross-check:** when both exist and the deduped sum differs from the last total by more than 5 % on `output`, downgrade usage to `low` with note `usage-total-mismatch` and emit a diagnostic.
- **Model / mode:** tally; `primary` = model with the most `usage.output` attributed (fallback: most frequent), mode = most frequent; `changes` = number of transitions in event order.
- **Counts:** `apiCalls` = deduped `usage` events; `toolCalls`, `compactions` = event counts; `turns` = `turn` events, else derived from the adapter's `turn` hint absence → field absent.
- **Version:** first/last; `flags.versionChanged` when they differ.
- **Title:** kept only when `ctx.privacy.titles` is true; otherwise dropped before the summary exists (not hidden in the UI).

### 3.3 Confidence rules (fixed in core)

| Situation | Confidence | Note |
|---|---|---|
| Per-call `usage`, deduped, no derived fields | high | — |
| Field listed in `derived` | medium | adapter-provided note, e.g. `derived: input − cached` |
| Only `usageTotal` available | medium | `cumulative total reported by harness` |
| Cross-check mismatch > 5 % | low | `usage-total-mismatch` |
| Source truncated / last line unparsable | low on usage and timing | `source-truncated` |
| Timing from ≥ 2 timestamps | high | — |
| Timing from 1 timestamp | low | `single-timestamp` |
| Rollup with a contributor missing the field | ≤ medium | `partial: n of m` |
| `primary` model/mode when `changes > 0` | medium | `changed n times` |

### 3.4 Linking and trees

After reducing every source of an adapter, `core` links children to parents by `link.parentSourceId` within the same harness. Unresolved parents produce an `orphan-child` diagnostic and the child is kept as a root with `relation` set, so its usage is not lost. Depth is computed from the tree (adapter `depth` is a hint used for display only). The MVP model is a tree (D23); a child has exactly one parent.

### 3.5 Trace builder

`trace(events: AsyncIterable<ScoutEvent>): Promise<SessionTrace>` in `packages/core/src/trace/`. Pure, order-preserving:

- `usage` events → `call` steps after the same dedupe as the reducer (usage taken once per `dedupeKey`, `blocks` summed); `cum` is the running total in canonical fields, so the Σ line is just `cum.output` (or any field the UI picks).
- `toolCall` → `tool` step; a later `toolResult` with the same `callId` (or the next unpaired result) sets `error` and `durationMs` on it.
- `turn`, `compaction`, `harnessEvent` → their steps; `model` and `mode` events → `model-change` / `mode-change` steps only on transitions.
- `link` events are emitted by children, so the builder never sees them for the root; the server fills `childId` on `agent` tool steps by matching `viaCallId` from the store (§5).
- A trace's `totals` must equal the summary's exclusive usage; the contract kit asserts it on every fixture. If they diverge, the reducer and the builder disagree on dedupe — a bug, not a data problem.

## 4. Adapter contract

`packages/core/src/adapter/`:

```ts
type Capability =
  | 'usage.perCall' | 'usage.cumulative' | 'usage.cacheWrite' | 'usage.reasoning'
  | 'timing' | 'model' | 'mode' | 'effort' | 'version'
  | 'turns' | 'toolCalls' | 'compactions' | 'subagents' | 'cost' | 'title' | 'git'
  | 'trace.blocks' | 'trace.errors' | 'trace.harnessEvents' | 'trace.toolDurations';

type SourceRef = {
  sourceId: string;                 // unique within the harness
  path: string;
  kind: 'root' | 'child';
  sizeBytes: number;
  mtimeMs: number;
  parentHint?: string;              // cheap linkage known at discovery time (e.g. directory nesting)
};

type AdapterContext = {
  home: string;                     // user home; overridable for tests and `--home`
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fs: ScoutFs;                      // read-only abstraction: stat, readdir, openStream, readFile, openSqliteReadonly
  privacy: { titles: boolean };
  log: Logger;
};

interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  adapterVersion: string;           // bump when mapping changes
  capabilities: readonly Capability[];
  allowlist: Projection;            // §6 — the fields this adapter is permitted to read
  probe(ctx): Promise<{ installed: boolean; roots: string[]; notes: string[] }>;
  discover(ctx): AsyncIterable<SourceRef>;               // cheap: stat/readdir only, no parsing
  parse(ref: SourceRef, ctx): AsyncIterable<ScoutEvent>; // streaming
  explain(field: keyof Usage | keyof Counts): string | undefined;   // mapping note for the UI
  toolCategory(name: string): ToolCategory;                          // §2.6; must be total (unknown → 'other')
  harnessEventNames: readonly string[];                              // the only names `harnessEvent` may carry
}
```

Registry: `packages/server/src/adapters.ts` exports `const adapters: HarnessAdapter[]`. Adding a harness is one import line there plus a new package (see [adapters/README.md](adapters/README.md)).

## 5. Scan pipeline

`packages/core/src/scan/`:

```text
for each adapter:
  probe ──▶ discover ──▶ for each SourceRef (bounded concurrency, default 4):
                            unchanged since last scan? ─ yes ─▶ reuse summary
                                                        └ no ──▶ parse ─▶ reduce ─▶ summary
  link children ─▶ compute depth ─▶ rollups
resolve projects (§7) ─▶ aggregates ─▶ ScanReport
```

- **Incremental (D18):** the store keeps `Map<path, { sizeBytes, mtimeMs, summary }>`. A rescan re-parses only refs whose `(size, mtime)` changed and drops summaries whose path disappeared. Links and rollups are recomputed every scan (cheap).
- **Streaming:** JSONL is read through a line splitter over `Bun.file(path).stream()`; a line above 8 MB is skipped with a diagnostic; a final partial line marks the source `truncated`.
- **Errors:** a failing source produces a diagnostic and does not stop the adapter; a failing adapter produces a diagnostic and does not stop the scan.
- **Report:** `ScanReport { startedAt, durationMs, perAdapter: { discovered, parsed, reused, failed, durationMs }, diagnostics }` is exposed by the API and printed by `scout scan`.

Performance target on the reference machine (≈ 900 sources, ≈ 770 MB): cold scan ≤ 5 s, warm rescan ≤ 300 ms. If the cold target is missed after profiling, a JSON summary cache under the OS cache directory is the agreed escalation (D18).

**Traces** are not part of the scan. `store.getTrace(id)` re-runs `adapter.parse(ref)` on that one source and folds it with `trace()`, then fills `childId` on `agent` tool steps from the store's link table (`viaCallId`). Results are kept in an LRU of 16 entries keyed by `(path, size, mtime)`. Budget: a 28 MB source must produce a trace in under one second on the reference machine; if not, the line streamer is the first suspect.

## 6. Privacy boundary

Four mechanisms, all testable:

1. **Projection allowlist as data.** Each adapter exports `allowlist: Projection`, a nested description of the only keys it may keep from a raw record (e.g. `message: { model: true, usage: true, content: [{ type: true, name: true }] }`). `core.project(record, allowlist)` builds a new object containing only those keys **before** Zod validation runs. Content fields never exist in memory beyond the raw line.
2. **Canary test.** `fixtures/<harness>/canary/` contains a synthetic session whose every content field holds the sentinel `SCOUT_CANARY_<n>`. The contract test parses it and asserts the sentinel appears nowhere in the events, summaries, diagnostics or API responses. Every adapter must ship a canary.
3. **Generated documentation.** `docs/adapters/<id>.md` includes a table generated from the allowlist, so what the adapter reads is reviewable without reading code.
4. **Diagnostics discipline.** Diagnostics carry `path`, `line`, `code` and a fixed message; a `Diagnostic` constructor rejects messages longer than 200 characters or containing newlines, which blocks accidental record dumps.

The single exception (D7): `meta.title`. It is typed `contentDerived: true`, dropped by the reducer when `privacy.titles` is false, and shown with a subtle marker in the UI.

Paths (`source.path`, `cwd`) are metadata: shown in detail and diagnostics, never in list views beyond the project name.

## 7. Project identity

`packages/core/src/project/resolve.ts`, using `ctx.fs` only (read-only):

1. Take the session's first `cwd` (adapters emit `cwd` events in record order).
2. Walk up until a `.git` entry is found or the filesystem root is reached.
   - `.git` directory → `repoRoot` = that directory's parent.
   - `.git` file containing `gitdir: <path>/.git/worktrees/<name>` → `repoRoot` = `<path>`, `worktree` = `<name>`.
3. If `repoRoot` was found, read `<repoRoot>/.git/config` and take `remote "origin"`'s `url`; normalize (`git@host:org/repo.git` and `https://host/org/repo.git` → `host/org/repo`).
4. `key` = normalized remote, else `repoRoot`, else `cwd`. `name` = last segment of the key. `identity` records which.

Harness-provided git facts (Codex `git.repository_url`, Grok `git_root_dir`) are used first and the filesystem walk only fills gaps. Results are cached per `cwd` for the lifetime of the store. The `--project-identity=cwd` flag (D9) disables steps 2–3.

## 8. Server

`packages/server`: Hono app on `Bun.serve`, bound to `127.0.0.1`, default port `7423`.

| Route | Returns |
|---|---|
| `GET /api/status` | scan state, last `ScanReport`, adapter list with `capabilities` and probe results |
| `POST /api/rescan` | triggers an incremental scan; returns the report |
| `GET /api/projects` | `ProjectAggregate[]` |
| `GET /api/projects/:key/sessions` | root `SessionSummary[]` + rollups for that project |
| `GET /api/harnesses` | `HarnessAggregate[]` |
| `GET /api/harnesses/:id/sessions` | root summaries + rollups for that harness |
| `GET /api/sessions/:id` | summary, rollup, full subtree (summaries + rollups), diagnostics |
| `GET /api/sessions?ids=a,b,c` | summaries + rollups + `comparability` matrix for the compare view |
| `GET /api/sessions/:id/trace` | `SessionTrace` for the timeline (built on demand, §5) |
| `GET /api/traces?ids=a,b,c` | one `SessionTrace` per id for stacked timelines |
| `GET /api/diagnostics` | aggregated diagnostics for the last scan |
| `GET /*` | the embedded web build |

`comparability(sessions)` lives in `core`: for each metric row it returns `ok`, `missing` (field absent), `not-provided` (capability absent), `derived` (any medium/low with note) or `incomparable` (different `explain()` semantics between harnesses). The UI renders the flag; the API computes it so both agree.

No CORS headers, no auth, no cookies. The store is a plain in-memory object; the app boots by running a scan before opening the browser (with a `--no-open` flag).

## 9. Web app

`packages/web`: Vite + React 19 + TypeScript + Tailwind; TanStack Router (file-based), Query, Table.

```text
/                     → redirect /projects
/projects             ProjectsList
/projects/$key        SessionTable  (scope: project)
/harnesses            HarnessList
/harnesses/$id        SessionTable  (scope: harness; project is a column and filter)
/sessions/$id         SessionDetail (metadata, usage with confidence markers, counts, agent tree)
/compare              CompareSelector + CompareView (?ids=…)
```

- One `SessionTable` component for both scopes; TanStack Table handles sort/filter client-side.
- Global state in `localStorage` (wrapped in try/catch): `inclusive` (default true), `showTitles` (default true), `compareTray` (session ids). The tray survives navigation between Projects and Harnesses; the **Compare sessions** button is in the app shell.
- Every `Metric` cell renders value + confidence marker; hover shows `source`/`note`; absent values render as `—` with the `missing` / `not provided` distinction from §2.1.
- The detail tree shows exclusive and inclusive columns per node.
- **Timeline** (`components/Timeline`): one column per `TraceStep`, colored by model for `call` steps and by `ToolCategory` for `tool` steps; prose/thinking block presence, `error` and `harness` steps drawn as markers (the article's ¶, red and dotted cards); a Σ line over the columns from `cum` (field selectable: output by default, total input, cached); turn boundaries drawn as phase separators labeled `Turn n · duration`; model and mode changes as vertical rules. Hover shows the step's numbers. Hook events are hidden by default (they roughly double the step count), toggleable. Rendered as SVG for ≤ 3 000 steps, canvas above that. Axis toggle: step index (default) or time (D33).
- `SessionDetail` embeds the timeline under the header (models, harness-reported cost, Σ tokens following the inclusive toggle). `CompareView` stacks one timeline per selected session on a shared axis, with the metric table below.

## 10. CLI and distribution

`apps/scout`:

| Command | Purpose |
|---|---|
| `scout` | scan, start server, open browser |
| `scout serve [--port] [--no-open] [--home <dir>] [--project-identity repo|cwd] [--no-titles]` | server without defaults |
| `scout scan [--json] [--harness <id>]` | headless scan; prints the report (and summaries with `--json`) |
| `scout doctor` | probe every adapter; show roots, counts, and the first diagnostics |
| `scout fixture <path> --out <dir>` | dev-only: redact a real source into a fixture (§11) |

Build: `bun build --compile` per target (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`) with the web `dist/` embedded via Bun's file embedding. Release assets on GitHub; the same entry published to npm so `bunx`/`npx` works (D13). Binaries are expected around 90–100 MB.

## 11. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Reducer | `bun test` | dedupe, totals-only, cross-check, bounds, primary model/mode, rollups, confidence table (§3.3) — pure, exhaustive |
| Trace builder | `bun test` | dedupe merges blocks; call/result pairing by id and by order; `cum` monotonic; `totals` equals the reducer's exclusive usage on every fixture; transition steps only on change |
| Adapter contract kit | `core/test-kit` | any adapter must: emit `meta` first; never throw on the malformed fixture; pass the canary; produce a stable `sourceId`; keep every emitted key inside the allowlist |
| Adapter fixtures | `bun test` | per harness × version: discovered count, per-session expected summary (snapshot of the summary, not of events) |
| Project resolver | `bun test` with a temp dir | repo, worktree, no-git, remote normalization |
| Server | `bun test` + Hono `app.request` | routes against a fixture store; comparability matrix |
| Web | Vitest + Testing Library | table rendering with confidence markers; tray persistence; compare flags; timeline renders the expected column count and markers for a fixture trace |
| End-to-end | Playwright (later) | open app on fixtures, navigate, compare |

Fixtures are produced by `scout fixture`, which keeps structure, keys, numbers, booleans, timestamps and ids, replaces every other string with a same-length filler unless the key is in the harness's *enum keep-list* (`type`, `subtype`, `model`, `mode`, `role`, `stop_reason`, `version`, tool names…), rewrites absolute paths to `/home/u/proj-<hash>/…`, and caps file size by dropping records that carry no allowlisted field. A repository test asserts no fixture contains a string longer than 120 characters outside the keep-list.

## 12. Cross-platform notes

- Home resolution: `os.homedir()`; never hard-code `/Users`. Every path built with `node:path`.
- Claude Code project directories encode the cwd lossily (`/` → `-`, and on Windows `C:\Users` → `C--Users`); Scout uses the `cwd` field inside records and only falls back to decoding the directory name (low confidence, diagnostic `cwd-from-dirname`).
- Grok Build and Codex encode cwd differently (URL-encoded; date folders). Adapters own their decoding.
- SQLite (OpenCode) is opened with `bun:sqlite` in `readonly` mode; `immutable` is **not** used because it hides WAL content. Windows file locking on a live WAL database is a known risk to verify on the second machine (D12).
- CI matrix: macOS, Ubuntu, Windows for tests; binaries built on each.

## 13. Open questions

- D20 and D22 assumed; confirm.
- Product name (D27).
- Grok `inputTokens`: inclusive of `cachedReadTokens` or not (affects `uncachedInput` derivation) — verify on real data before the Grok adapter.
- Whether Claude Code `cost-state` includes subagent usage (affects the label on `cost` for sessions with children).
- Nested subagent parent resolution (depth > 1) beyond the MVP simplification.
- Codex tool names (`function_call.name`) and error markers in `function_call_output` — verify during M5 to build its `toolCategory` and `toolResult.error` mapping.
- Whether to interleave child traces into the root timeline by time (D35 defers it).
