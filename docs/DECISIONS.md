# Decisions

Outcome of the design review held 2026-08-29/30 before any code was written. Numbers match the review questions. Items marked **pending** were explained again after the review and are assumed as stated until confirmed.

## Review outcomes

| # | Topic | Decision |
|---|---|---|
| 1 | Audience | Dogfood first (the author's own machine, all harnesses installed), designed for distribution. |
| 2 | Session rows | Only root sessions are rows in tables and counts. Subagents appear in the detail tree and in inclusive totals. |
| 3 | Default totals | **Inclusive** by default. One global toggle, persisted in the browser. |
| 4 | Identity under resume/fork | One source file (or DB row) = one session. `resumed` / `forkedFrom` flags when the harness exposes them. |
| 5 | Token model | Canonical usage fields: `uncachedInput`, `cachedInput`, `cacheWrite`, `output`, `reasoningOutput` (⊂ `output`). Each adapter documents its mapping. For OpenAI-style semantics (`cached ⊂ input`) Scout derives `uncachedInput = input − cached` and marks it `medium` confidence with a note. |
| 6 | Cost | Show cost **only when reported by the harness**, labeled `harness-reported`. Scout never computes cost. |
| 7 | Titles | Harness-generated titles are shown **by default**. They are content-derived and modeled as the single explicit exception to the metadata-only rule; a setting hides them. |
| 8 | Git metadata | Branch and commit hash are allowed. Remote URL is used only as an internal grouping key; the UI displays the repo name (last path segment). |
| 9 | Project identity | Scout may perform read-only filesystem checks outside harness directories (find `.git`, read the remote URL) to group sessions by repository/worktree. A setting disables this (fallback: cwd is the project). |
| 10 | Status | **Dropped from MVP.** No status field, no running/ended inference. |
| 11 | Antigravity | **Dropped from MVP.** No local trajectory store was found. |
| 12 | Windows | In scope. Tested on a second machine. |
| 13 | Distribution | `bun build --compile` binaries for macOS/Linux/Windows as release assets, plus an npm package for `npx`/`bunx`. |
| 14 | Frontend | Vite, React 19, TypeScript, TanStack Router, TanStack Table, TanStack Query, Tailwind. Bun is the package manager for the whole repo. |
| 15 | API | Hono on `Bun.serve`, typed `hc` client in the web app. |
| 16 | Repo layout | Bun workspaces: `packages/core`, `packages/adapter-*`, `packages/server`, `packages/web`, `apps/scout`. |
| 17 | Fixtures | Redacted real sessions committed under `fixtures/`; redaction tool lives in the repo. |
| 18 | Scan cache | Delegated. **Decision:** in-memory only; incremental rescans keyed by `(path, size, mtime)`; disk cache deferred until a cold scan exceeds ~5 s on real data. |
| 19 | Refresh | Manual rescan only. No file watching. |
| 20 | Adapter output | **Confirmed 2026-08-30.** Adapters emit normalized events; a shared reducer builds summaries. See [ARCHITECTURE.md §3](ARCHITECTURE.md#3-events-and-the-reducer). |
| 21 | Schema strictness | Loose Zod schemas (optional fields, passthrough). Version-gated field maps inside one adapter, not one adapter per version. Unknown record types are counted, not reported as errors. |
| 22 | Confidence | **Not yet confirmed** (explained 2026-08-30). Assumed: confidence is per metric, `{ value, confidence, source, note? }`. See [ARCHITECTURE.md §2](ARCHITECTURE.md#2-domain-model). |
| 23 | Agent topology | Tree in MVP. Teammates (peer agents) are siblings under the root tagged `teammate`. |
| 24 | Adapter contract | `probe` / `discover` / `parse` / `capabilities` / `explain`. |
| 25 | Harness order | Claude Code → Codex → Grok Build → OpenCode → Pi. |
| 26 | Docs | Under `docs/`. |
| 27 | Name / license | **Scout**, MIT (confirmed 2026-08-30). |

## Amendments to PRODUCT.md

These override the brief where they conflict.

- **Status** is removed from session metadata, the session table filters and session detail (D10).
- **Cost** is shown when harness-reported (D6); computed cost estimates remain out of scope.
- **Titles**: harness-generated titles are displayed by default and hideable (D7). The privacy boundary therefore reads: *no prompts, responses, code, tool output or reasoning — with the single documented exception of harness-generated session titles.*
- **Antigravity** is out of MVP scope (D11). A probe-only adapter may report "no local data".
- **`SessionSummary`** evolves to per-metric confidence, canonical usage names and an explicit tree; see ARCHITECTURE.md §2. The `usage.confidence` single field is replaced.
- **Session counts** everywhere are root-only (D2).
- **Purpose sharpened for waste visibility**: session review's aim now explicitly includes surfacing recurring token/time waste inside a developer's own agent harness (long-context accumulation, model/task mismatch, mid-session model switches, subagent avoidance...), not only "review what ran afterward" — see "Session Profile v1" (D51–D59). Detection/insight logic is not built yet; this only changes what session detail's own structural data shows cleanly.
- **Cost estimates** remain out of scope (D6) — but D51 flags an open tension: telling "an expensive model doing cheap work" apart from ordinary model use needs at least a relative model-cost notion. Unresolved, not decided either way.

## Decisions taken while writing the plan

| Topic | Decision | Why |
|---|---|---|
| Lint/format | Biome | One tool, fast, Bun-friendly. Trivial to swap. |
| Zod | v4 | Current major; smaller bundles. |
| Default port | `7423`, `127.0.0.1` only | Arbitrary and unlikely to collide; loopback-only is a privacy requirement. |
| Server-side filtering | Not in MVP | Session counts are in the low thousands; TanStack Table filters client-side. API stays filter-capable in shape. |
| UI preferences | Browser `localStorage` | Inclusive toggle, titles toggle, compare tray. No server-side product state in MVP. |
| Primary model / mode | Model with the most output tokens; mode with the most records. `all` lists every value; a change count is displayed. | Sessions switch models and modes mid-run. |
| Harness version | First and last seen; the last is displayed; a note when they differ. | Versions change mid-session in real data. |
| Turns in rollups | Turns are **not** rolled up (a turn is a human prompt); usage, tool calls, API calls and compactions are. | Keeps "turns" meaningful for the root. |
| TypeScript version | Pinned to **6.0.3**, not the installed latest (7.0.2). | TypeScript 7 removed `baseUrl` (paths must be relative to the declaring tsconfig) and `dependency-cruiser@18` does not yet support the TS7 compiler API — with 7.x installed, the boundary check silently cruised 0 modules (a false pass). Revisit when dependency-cruiser adds TS7 support. |
| Path aliases for workspace imports | `tsconfig.base.json` declares `paths` for `@scout/core`/`@scout/server`/`@scout/web` (no `baseUrl`, TS7-style relative paths). | Bun resolves workspace packages internally and does **not** create `node_modules/@scout/*` symlinks, so `tsc` and `dependency-cruiser` — both using standard Node/TS resolution — cannot otherwise find them. Bun's own runtime doesn't need this; only the added static-analysis tools do. |
| Nested subagent parent | MVP attaches every Claude Code subagent to the root session and shows `spawnDepth`; exact parent resolution for depth > 1 is a later refinement. | Requires reading tool-result linkage; not needed for totals. |

## Timeline (added 2026-08-30)

Inspired by the ribbon diagrams in [stencil.so/blog/prewalk](https://stencil.so/blog/prewalk): one card per model operation, colored by kind (model, read, write, exec, todo, prose, error, harness event), a cumulative-token line over the cards, phase labels underneath, and two sessions stacked for comparison. That article's conclusion — "the bill is essentially `O(reads)`" — is exactly the kind of evidence Scout should make visible without reading a transcript.

| # | Topic | Decision |
|---|---|---|
| 28 | Timeline view | Session detail shows a step timeline. The compare view stacks one timeline per selected session on a shared axis. |
| 29 | Traces are built on demand | A `SessionTrace` is produced by re-running the adapter's `parse()` on one source and folding the same event stream with a second consumer (`trace()`). The in-memory store keeps summaries only; a small LRU caches recent traces. |
| 30 | Phases | No semantic phase labels (the article's "RECON", "GIT ARCHAEOLOGY" require reading the transcript). Scout's phase boundaries are turns (human prompts) plus harness events: compactions, mode changes, model swaps. Manual annotation is a later, durable-state decision. |
| 31 | Tool categories | Each adapter maps its tool names to `read`, `write`, `exec`, `search`, `plan`, `agent`, `web`, `mcp`, `other`. Tool names are metadata; tool inputs and outputs never leave the adapter. |
| 32 | Step kinds that count as metadata | Prose and thinking blocks (counts only, never text), tool-result error flags (boolean), hook / permission / plan-mode events (event name only). |
| 33 | Axis | Step index by default, as in the article; wall-clock time as an alternative axis. |
| 34 | Timeline header | Models used, harness-reported cost (D6), Σ tokens following the global inclusive/exclusive toggle. |
| 35 | Subagents on the timeline | MVP draws the root's trace with a marker at each `agent` tool call, linked to the child (via the tool-use id). Child traces open separately; interleaving children by time is a later refinement. |

## UI/UX redesign decisions (added 2026-09-01)

Context: [PRODUCT-UI.md](PRODUCT-UI.md) is the design brief for the M4b visual redesign (tables/numbers → graphs, per §5). The user separately supplied `scout.zip`, a v0.app export (Next.js 16, React 19, Tailwind 4, shadcn `base-nova` style on **Base UI**, not Radix) exploring the target look. It is a **visual/token reference only** — Scout's frontend stays Vite + TanStack (D14); the export's Next.js scaffolding and its unused shadcn `Button` are not adopted. Every literal value in it (hardcoded counts, spark curves, per-session numbers) is a v0 placeholder, not a data-model or content spec (D39).

| # | Topic | Decision |
|---|---|---|
| 36 | Confidence visual language | Color-coded dot (green/amber/red for high/medium/low confidence), kept as a pure provenance signal — never framed as good/bad, consistent with Compare's "no verdict" principle (PRODUCT-UI.md §4.6). |
| 37 | Ribbon timeline fidelity | The reference draws the ribbon (block heights, cumulative-token line width, turn labels) with hardcoded/decorative values, not derived from `SessionTrace`. Deferred: ship the visual grammar now; wire it to real `TraceStep`/turn data as an iterative follow-up, not a blocker for this design pass. |
| 38 | Skill/agent/mcp event log | The reference adds a separate "execution timeline" (agent/skill/mcp icons + curve) alongside the ribbon, introducing a `skill` concept not in `TraceStep.kind` (ENTITIES.md). To consider adding in a later pass — not yet a committed model change. |
| 39 | Reference data fidelity | All literal values in `scout.zip` are v0 placeholders, not a data-model or content spec. Only its layout/visual grammar carries forward. |
| 40 | Compare: incomparable treatment | Dropped. Compare keeps only two visual treatments — missing and derived. No separate "genuinely incomparable" flag (e.g. cross-harness `Counts.turns`/`mode` semantics differing) — declined after the concept was explained with concrete examples. |
| 41 | Typography | Adopt Geist Sans/Mono (Vercel's typeface), replacing the reference's Arial/Helvetica placeholder. |
| 42 | Sidebar saved views | Not included. The reference's "Recent failures" / "High token usage" saved-filter shortcuts are a v0 invention, not part of PRODUCT-UI.md §3's nav flow. |

## Post-ship corrections (added 2026-09-01, after the M4b commit)

The user compared the shipped UI against a real `npx shadcn@latest add dashboard-01` scaffold (built in a scratch temp project and inspected directly, not from memory) and found it visibly smaller/denser than intended. Root cause: `html { font-size: 13px }` (D-density-choice, design.md §3) scales every Tailwind `rem`-based utility to ~81% of what shadcn's own blocks assume, since Tailwind's scale is authored against a 16px root — this, not a missing component, is why stat numbers, spacing and the sidebar all read smaller than the reference.

| # | Topic | Decision |
|---|---|---|
| 43 | Root font-size | **Reverted.** `html { font-size: 13px }` removed; the app now uses the standard 16px root, matching shadcn's own type scale (`text-2xl`/`text-3xl` for prominent numbers, etc.) rather than a custom-scaled-down one. Density comes from layout choices (padding, table row height), not from shrinking the root. |
| 44 | Prominent numbers | Adopt shadcn's `Card`/`CardHeader`/`CardTitle`/`CardDescription` pattern (as seen in `dashboard-01`'s `SectionCards`) for headline numbers (`GroupCard`'s aggregate tokens, Session detail's totals), instead of ad-hoc large-text spans. |
| 45 | Tables | Adopt the real `@tanstack/react-table` v9 `useTable` pattern (the one shadcn's own `data-table` docs use: `tableFeatures`, `rowSortingFeature`, `columnVisibilityFeature`, `rowPaginationFeature`, wired to shadcn's `Table`/`TableHeader`/`TableBody` primitives) for `SessionTable`, replacing its current hand-rolled sort/filter logic. Explicitly **not** adopted from `dashboard-01`'s block: drag-to-reorder (`@dnd-kit`), the row-detail `Drawer`, `sonner` toasts — none apply to session data. Compare stays as metric-rows × session-columns; it is not a row-per-record table and is out of scope for this change. |
| 46 | Dark mode mechanism | `dashboard-01` ships `.dark`-class theming (`next-themes`) by default — explicitly **not** adopted; Scout keeps `prefers-color-scheme`-only theming (no in-app toggle), per PRODUCT-UI.md §5 and the original M4b decisions. Flagged so no later pass copies the class-based pattern by accident. |

## Non-human session initiator (added 2026-09-01)

Real `~/.claude/projects` data is mostly automation (SDK, CI, subagent dispatch), which is noise in every session count and table row — but it is not where the tokens are: measured separately, the same machine-started sessions account for only ~2–3% of total token mass, so this is a row-count/provenance feature, not a cost or savings feature (an earlier premise citing "96% of token mass" was checked and is wrong; do not repeat it).

| # | Topic | Decision |
|---|---|---|
| 47 | Initiator signal | Classify `human` \| `machine` \| `unknown` per session from two Claude Code signals only: the record-level `entrypoint` field (the surface) and the mere presence of an `agent-setting` record (a dispatch marker; its payload is never read, never allowlisted). `promptSource` is allowlisted but deliberately not classified on — its `sdk` value is emitted by both genuine SDK sessions and `claude-desktop`, so it cannot separate them (docs/adapters/claude-code.md "Initiator"). |
| 48 | Confidence asymmetry | `human` is capped at `medium` confidence; `machine` can reach `high`. A harness reports the surface a session arrived on, not who typed — a scripted `claude -p` in CI reports `cli`, indistinguishable from a person at a terminal, while no interactive human is possible on an SDK/CI surface. `unknown` (unrecognized surface) and absent (no signal at all) both count as **not** machine-initiated, so the filter can only ever hide sessions positively known to be machine-started (ARCHITECTURE.md §2.2). |
| 49 | Default visibility | The web app hides machine-initiated sessions by default (`showAutomated: false` in `scout.prefs.v1`), applied server-side (`?automated=exclude`) so it also narrows aggregates, not just table rows — a global preference like the existing titles toggle, not a per-table filter, and not reset by "Clear filters." The API's own default is unchanged (include everything) so scripts talking to it directly are unaffected. |
| 50 | Compare and deep links are exempt | `GET /api/sessions/:id` and the `?ids=` form of `GET /api/sessions` are never narrowed by `?automated=`, and the Compare tray/session-detail routes always resolve an explicitly chosen or bookmarked session even while list views hide it; Compare badges such a column "automated" instead of hiding it. |

## Session Profile v1 (added 2026-09-03)

Context: session detail's flagship element, the per-step ribbon (D28–D35), does not scale — real sessions run into the hundreds or low thousands of steps, and a ribbon that draws one mark per step turns into visual noise before it turns into insight. Working back from that failure surfaced a sharper framing for what session detail is *for*: most developers now build their own agent harness (skills, subagents, orchestration) chasing "build more, faster, cheaper," and the token/time waste that harness produces — long tasks that accumulate context, the wrong model doing cheap work, needless model switching, subagent-avoidance that fills the root agent's own context — is real, repeats across sessions, and is currently invisible inside raw logs. Session detail's job is to make that visible, strictly from structural/metadata signals already covered by the existing privacy boundary (no content, no auto-generated summaries) — turning these signals into actual flags/insights is explicitly **out of scope for this pass**, which only fixes what a session's own structural data is capable of showing cleanly.

| # | Topic | Decision |
|---|---|---|
| 51 | Waste-pattern catalog | Six recurring inefficiency patterns identified as the target signals for future insight work (not built yet): (1) context accumulation with repeated *automatic* compaction; (2) mid-session model switching (invalidates the prompt cache); (3) an expensive model doing cheap-category work (e.g. many `read` tool calls) — blocked on having *some* relative model-cost notion, which bumps into PRODUCT.md's "cost estimates out of scope" non-goal; open, not resolved; (4) heavy MCP tool usage; (5) no skill usage at all — kept as a neutral fact only, since judging it a problem needs task-type knowledge Scout does not have; (6) the root agent never delegates to subagents and exhausts its own context quickly. |
| 52 | Judgment principle for future insights | Any flag built from these signals must report the scale and who/what controlled the outcome (e.g. a compaction's manual vs. automatic `trigger`, session length) alongside the raw number — never a bare threshold crossing. Ties to the existing "evidence, not verdict" rule (PRODUCT.md, Compare, §4.6). |
| 53 | Analysis unit | One session (root + its subagent tree), matching the existing entity model. Cross-session/global waste analysis is future scope, not this phase. |
| 54 | Diagnostics removed from Session detail | The dedicated "Diagnostics" card is dropped from the screen entirely, including its empty state ("No diagnostics for this session"). Per-metric confidence/source/note (already on every `Metric`) remains the only place uncertainty is surfaced on this screen. The `Diagnostic` entity, `scout doctor` and the scan-level report are unaffected — only this one screen's dedicated block goes away. |
| 55 | Token breakdown: stacked, not toggled | Session detail always shows both totals, stacked in a fixed order: inclusive (this session + all descendants) first, exclusive (this session alone) second; a single figure when there are no subagents (the two are equal). The inclusive/exclusive toggle (D3) is removed **from Session detail only** — there is nothing left to toggle once both are always visible. It stays on the session tables and Compare, where a second column per metric would double every row. |
| 56 | Agents list default state | Unchanged component (the exclusive/inclusive tree table); default state changes to collapsed. |
| 57 | "Trace" becomes a token chart | The per-step ribbon section is replaced by a line chart read straight off the session's own `SessionTrace` — no new adapter or cross-session work: one line for cumulative total token consumption, one additional line per model used, with point markers underneath at the timestamp of each `agent`-category tool call in this session's own trace (marking that a subagent was spawned there; not its duration). |
| 58 | Timeline deferred | Showing subagents' actual order, duration and concurrency on a shared time axis — the harder question the old ribbon was reaching for — is deferred to its own design pass. Nothing in D55–D57 depends on it. |
| 59 | Charting library | Recharts replaces `@visx/*` as the project's one charting library — not only for the new chart in D57, but everywhere, including the already-built `Sparkline`, `TraceRibbon` and `session-timeline` track components. This decision records direction only; migrating the existing visx components is separate, later implementation work, not part of this documentation pass. |

## Timeline v1 (added 2026-09-03, resolves D58)

Context: the piece D58 deferred. The old ribbon failed because it drew one mark per step; Timeline keeps the *one* thing the ribbon was reaching for — the shape of the orchestration over time — and gets its readability from two rules: a short, closed list of event kinds that appear at all (D63), and a recursive data strategy that never fans out into every descendant's trace (D64). It is a "what happened" view, not a cost view; cost is the token chart (D57). Compare view's stacked-timeline behavior (PRODUCT-UI.md §4.6) is **not** addressed here and stays open.

| # | Topic | Decision |
|---|---|---|
| 60 | Purpose | Timeline answers, at a high level, *what happened in the session*: which agents ran, when and for how long, plus the relevant events (D63) laid on the same wall-clock axis. Not a cost/attribution view. |
| 61 | Scope | The **whole subtree** (all depths) of the session being viewed, each descendant drawn as a lifespan bar. A zoom / max-depth control ("show up to depth N") is a desirable follow-up, not a v1 blocker. |
| 62 | Agent lifespan | A bar spans the agent's **own** execution window — that node's `timing.startedAt → endedAt`, as recorded in its own source — not the parent's call→result window (which includes dispatch latency). The bar carries the timing's confidence like any `Metric` (a single-timestamp session is `low`, ARCHITECTURE.md §3.3). Labeled with `agentType` and `relation`, both already metadata. |
| 63 | Relevant events (the readability rule) | **Shown:** subagent spawns (as bars, D62), `mcp` tool calls, `skill` tool calls, model changes, compactions **with their `trigger`** (manual vs. automatic — the "who controlled it" signal from D52), tool errors (`error: true`), and turns as subtle phase separators (D30). **Dropped:** ordinary tool calls (`read`/`write`/`exec`/`search`/`plan`/`web`/`other`), hook/harness events (~1 000 per large session — the ribbon's biggest noise source), individual model calls (the token chart's job), prose/thinking block counts. Mode changes are **not** in v1; revisit if a real need shows up. |
| 64 | Recursive data strategy | Events are **positioned in time only for the session being viewed** — one trace, the same one the token chart already reads. Descendants appear as lifespan bars carrying **count badges** from their own summaries (`n mcp · n skill · n compactions · model changes`), never positioned events, so no descendant trace is ever fetched. To see *where* inside a subagent something happened, open that subagent — its own Timeline is the zoom-in. Consistent with D55–D57's one-level-per-screen rule. **Rejected alternative:** a new server-side "subtree timeline" endpoint that positions every node's relevant events in one artifact — richer, but new server + core work; not now. |
| 65 | Reducer extension | `Counts` gains a per-category tally of tool calls, `toolCallsByCategory?: Partial<Record<ToolCategory, Metric>>`, computed by the reducer from `toolCall.category` (structural only — categories are already metadata, D31) and rolled up inclusively like `toolCalls`. Needed so D64's descendant badges can be read off a summary instead of a trace; per-node model changes and compactions are already on the summary. This is the **only** new data the Timeline requires. Not yet implemented — ARCHITECTURE.md §2.2 records the shape. |
