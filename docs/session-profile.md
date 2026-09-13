# Session Profile (metadata-only)

The session profile is the `/sessions/{id}` page: answers **what did my
harness do here that cost me context or time?** for a single session and its
complete tree. It reads distinct session-scoped profile resources (every scout
API route is served under `/api/*`) and
composes, in order: header → agent graph (git-graph, one wall-clock line per
agent, branches at spawn time) → token chart (tree-wide cumulative, one line
per model) → merged events table → signals accordion (collapsed).

This doc records the **approved contracts** the panels rely on, the
**limits / null semantics** they honour, and the documented **non-goals**. It
is the contract source for `forge-adversary` and for any later change to the
profile.

---

## Resources: `GET /api/sessions/{id}/profile/{projection}`

- Every scout API route is served **exclusively under `/api`**; the legacy
  un-prefixed `/session-profiles*` / `/sessions*` and `/` are not exposed.
- `{id}` is the opaque whole path remainder before `/profile/{projection}`, decoded
  **exactly once** (a literal `/` or `%2F` stays part of the id).
- Each projection has its own endpoint:
  - `/profile/spawns` → agent relationship evidence (causal status, orphan count)
  - `/profile/signals` → tree-wide compaction/model-change/mcp/skill aggregates
  - `/profile/timeline` → tree-wide chronological token series
  - `/profile/events` → events merged by true chronology across the whole scope
  - `/profile/models` → per-model output-token shares for the session and its
    subagent descendants
- `scope` (`tree` default | `own`) is validated strictly. `tree` covers the
  root and every descendant; `own` covers only the root.
- Every parameter is validated by the transport before any core reader runs:
  any unknown, duplicate, empty, non-integer,
  unsafe or out-of-range value, is rejected (400) with the parameter named.
  `limit`/`offset` (spawns, merged) reject out-of-range integers at the HTTP
  boundary.
- A missing root returns `404 {error:'session not found'}`; a malformed id
  returns `400`.
- The response is **metadata-only**: no `title`, `cwd`, `git_*`, prompt/response,
  args, command, or tool-output column is reachable by any reader.

---

## Scope semantics

- `scope=tree` aggregates/iterates the complete subtree of the requested id.
- `scope=own` isolates the requested session only.
- The scope closure is a parameterized recursive CTE using `UNION` so each id is
  admitted once and malformed parent cycles terminate without relying on textual
  id encoding.

---

## Agents (`/profile/spawns`)

- **Evidence, not certainty.** Each `item` is `parent → child` with a
  `causalStatus`. Statuses are `linked`, `missing-call-id`, `call-not-found`,
  `ambiguous`, `inconsistent`, `unresolved`. The reader uses the child's declared
  `parent_id`/`spawn_call_id` as candidate identity, **never** `steps.child_id`
  (cached link evidence that may be stale, dangling or collision-pruned).
- **No invented identity.** `harness` / `capabilities` are rendered only when the
  contract returns them; `relation` and `agentType` come from the contract. No
  profile, harness, or model identity is fabricated.
- **Orphanhood.** `orphanSessionCount` reports in-scope sessions whose `parent_id`
  points at a missing parent.
- **`callAt`.** The spawn-call's own `at` (from a matched, unambiguous action
  row); `null` when there is no matching action, the action's `at` is null, or
  the match is ambiguous. Drives both the agent graph's branch instants and the
  token chart's spawn markers.
- **Ambiguous/unresolved edges.** The agent graph renders these unlabelled,
  hanging from root — never a fabricated `causalStatus`.

---

## Signals (`/profile/signals`)

- Tree-wide aggregates: compactions split by trigger (`auto`/`manual`/`unknown`
  — unknown covers a null trigger or any other literal), model-change count,
  tool calls (`total` vs `mcp`), distinct MCP server names (best-effort parsed
  from `tool_name`), skill call count and distinct skill names.
- Every value renders even at `0`.

---

## Timeline (`/profile/timeline`)

- **Tree-wide chronological series.** Orders every in-scope call by `at` ASC
  (never by seq) across the whole scope, bucketed to at most 400 exact
  (not sampled) buckets.
- **Reserved buckets.** `series` exposes top-seven named models plus `unknown`
  (null-model calls) and `other` (literal `unknown`/`other` + non-top-7
  models). A model absent from a bucket is `0`; a model that *appeared but was
  never observed* is `null`.
- **Nulls are distinct from zero.** Calls with `at IS NULL` are excluded from
  `points` and counted in `excludedNullAtCount`, never dropped silently.
- **Timing honesty.** `timeDomain` is `{start:null,end:null}` unless every
  included call has a usable, non-decreasing `at`.
- **Spawn markers.** `spawns` carries `{at, parentId, childId}` from the same
  `callAt` join as the agent graph (`linked` matches only, `at !== null`).

---

## Merged events (`/profile/events`)

- **True chronology across the whole scope.** Ordered by `at` ASC, then
  `sessionId`, then `seq` — the one place this resource merges by timestamp
  instead of keeping streams separate.
- **`filter=signals` is the default**: `error OR compaction OR model-change OR
  tool.category IN (mcp, skill, agent)` — no `hook`/`harness`/`mode-change`
  (those would flood a globally merged table). Other values: `relevant`, `all`,
  `mcp`, `skill`, `hook`, `read`, `write`, `exec`, `agent`, `error`.
- **Nulls are excluded and counted.** Events without a usable `at` are never
  interleaved into `items`; they are counted in `excludedNullAtCount`.
- **Pagination.** `limit` (default 50, clamped [1, 200]) / `offset` (default 0,
  clamped >= 0).
- **Metadata only.** Rows carry kind, timestamp, and kind-specific fields
  (`model`, `category · toolName`, `durationMs`, `trigger`, `from → to`). Tool
  rows carry `model` like call rows (em-dash / NULL before a `scout import --force`
  backfill). They never render args, paths, or tool output.

---

## Models (`/profile/models`)

- **No query parameters.** This projection accepts **none** — every parameter
  (`scope` included) is rejected `400` naming it.
- **Two groups.** `session` aggregates the requested session's own
  `kind='call'` steps; `descendants` aggregates the same rows across the
  recursive subtree with the session itself excluded, so its own calls are
  never double-counted.
- **Output-token share.** Each entry's `share` is `outputTokens /
  group.outputTokens`; steps with no model (or an unknown model id) are
  excluded from both the numerator and the denominator, so they never shift a
  share.
- **Top-7 + `other`.** `models` lists the top seven named models by output
  tokens (name ASC tie-break) plus a single `other` entry folding every
  remaining named model and the reserved literal `unknown`/`other` names;
  `other` appears only when something actually folds.
- **Empty groups are `{outputTokens: 0, models: []}`.** A session with no
  known-model call steps still returns `200`, not `404`.
- **Metadata only.** Model names and output-token shares only — no prompts,
  paths, args, or tool output.

---

## Route integration (`/sessions/{id}`)

- The header stays **privacy-gated**: `title` is shown only when present and
  distinct from `name`; `harness`, `project`, started/ended/duration, cost, and
  per-field own/inclusive token totals are shown from `ApiSessionDetail`. No
  tool-call, turn, or API-call fields, and no summed token KPI.
- Route search params do not control profile panel state. Token field defaults to
  `output`; events filter defaults to `signals` and page to `1`. The merged-events
  table renders 10 rows per page by default; the API's own `limit` default stays 50.
  Each panel owns its state and re-fetches only its own TanStack query when it changes.
- An explicit **Refresh** bumps a refresh token that re-fetches every panel
  (spawns, signals, timeline, merged).
- A failed profile section never hides the header; each panel surfaces its own
  error + Retry.
- A missing session (`404`) shows `Session not found.` with a **back to
  sessions** link; the profile panels are not mounted.
- The signals accordion's delegation share is computed client-side from the
  header's already-fetched `tokensOwn`/`tokensInclusive` for the default
  `output` field; its subagent count comes from the agent graph's already-fetched
  node list — neither is a redundant reader.

---

## Non-goals

- **No causal certainty.** Spawn `causalStatus` is evidence; `ambiguous` /
  `inconsistent` / `unresolved` are real states, not things to resolve.
- **No per-model fabrication.** Models are shown only from the global `series`;
  an absent model stays `0`, an appeared-but-unobserved model stays `null`.
- **No raw content.** The profile is metadata-only: no code, prompts, responses,
  args, file paths, or tool output.
- **No model-cost tier.** "Expensive model on cheap work" is not assessed:
  Scout has no model cost tier.
- **No side-by-side compare view.**
