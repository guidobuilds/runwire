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
