# Scout

Local code-agent session explorer.

> Original product brief (2026-08-29). Amendments agreed in the design review are recorded in [DECISIONS.md](DECISIONS.md); this file is kept as the reference brief and is not edited in place.

## Purpose

Scout helps developers understand how their coding-agent sessions were run and compare them afterwards. It reads local session data from supported harnesses and presents only operational metadata and usage metrics.

Scout answers questions such as:

- What sessions ran in this project, and with which harness, model and mode?
- How many input, cached-input and output tokens did a session consume?
- Did a session use subagents, and what did they contribute?
- How do selected sessions compare across projects or harnesses?

## User and use cases

Scout is for developers who use one or more coding-agent harnesses and want to inspect sessions after they have finished.

### Research

Explore historical sessions to identify usage patterns by project or harness: model choice, mode, token composition, duration, agent topology and other available operational signals.

### Session review and comparison

Open one session to review its metadata and metrics, or select multiple sessions to compare their configuration and usage side by side.

## Product principles

- **Local-first and private.** Runs entirely on the developer's computer. No account, API key, cloud service or product telemetry is required.
- **Read-only.** It never modifies source logs, session databases or agent configuration.
- **Metrics and metadata only.** Scout must not display, index or persist prompts, responses, code, tool output or model reasoning.
- **Explain uncertainty.** Each metric retains its source and confidence. Missing or incomparable data is explicit.
- **Compare without false precision.** Normalized metrics make comparison possible, while harness-specific semantics remain visible.

## Scope

### In scope for the MVP

- Discover local sessions from supported harnesses: Codex, Claude Code, OpenCode, Pi, Antigravity and Grok Build, according to adapter maturity.
- Group sessions by project/repository/worktree and by harness.
- Show session metadata: harness, project, start/end time, duration, model, mode, status and harness version when available.
- Show usage metrics: input, cached input, cache creation, output, reasoning output, turns, tool calls, compactions and subagent count when available.
- Open a session detail view with its agent/subagent hierarchy.
- Compare selected sessions, including sessions from different harnesses and projects.

### Out of scope

- Running agents, capturing live sessions or acting as an orchestration layer.
- Creating, running or grading evals.
- Transcript browsing, prompt/response search, code inspection or any content analysis.
- Cloud sync, collaboration, user accounts, team analytics or outbound telemetry.
- Editing or deleting harness data.
- Cost estimates in the MVP. Plans and provider pricing make this unreliable without a separate pricing model.

## Information architecture

Scout has two browsing entry points and one global action. There are deliberately no primary sections for models, modes, tokens or agents: those are filters, dimensions or fields within the relevant view.

```text
Scout

Projects                         default
Harnesses

Compare sessions                 global action
```

| Entry point | Perspective | Primary question |
|---|---|---|
| Projects | All agent activity attached to a codebase | "What happened in this project?" |
| Harnesses | All activity produced by one coding agent | "How am I using this harness?" |
| Compare sessions | Deliberate selection of sessions | "How did these runs differ?" |

## Navigation and user experience

### Projects — default view

The landing view is a list of detected projects. A project is derived from the session's working directory, repository root or worktree; it is never manually created in the MVP.

| Project | Sessions | Harnesses | Latest activity | Aggregate tokens |
|---|---:|---|---|---:|
| `my-app` | 42 | Codex, Claude Code | 2 hours ago | 3.2M |

Opening a project shows a session table scoped to that project. The developer can filter and sort it by harness, model, mode, time range, status or subagent presence.

### Harnesses

This is the same data from the opposite direction: a list of detected harnesses, then all sessions emitted by the selected harness across projects.

| Harness | Sessions | Projects | Latest activity | Aggregate tokens |
|---|---:|---:|---|---:|
| Codex | 80 | 6 | 2 hours ago | 5.4M |

Opening a harness shows its session table. Project is then a filter and a visible column.

### Session table

Both browsing routes use the same dense, developer-oriented table. A row opens session detail; checkboxes add sessions to the comparison tray.

| Session | Project | Harness | Model | Mode | Started | Duration | Input | Cached | Output | Subagents |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|

Metrics that include child agents must be labeled **inclusive**. Metrics for that session alone are **exclusive**. The active choice must be visible at table level and carried into comparison.

### Session detail

Session detail is an operational review, never a transcript viewer. It displays:

- project, working directory/worktree and source harness;
- start/end time, duration, status and available harness version;
- model and execution mode, including changes within the session if the harness provides them;
- token breakdown and data-confidence notes;
- available counts for turns, tools and compactions;
- an expandable tree for the root agent and any known subagents, showing exclusive and inclusive totals.

### Compare sessions

**Compare sessions** is a persistent global action, not a navigation section. It opens a selector that lets the developer locate sessions using either perspective:

```text
Compare sessions

[ Projects ] [ Harnesses ]                         Search sessions

Filters: Project · Harness · Model · Mode · Date

☐ Session A
☐ Session B
☐ Session C

Selected: 2 sessions                              [ Compare ]
```

The selection persists while switching between Projects and Harnesses. This enables comparisons such as:

- Codex versus Claude Code for the same project;
- multiple sessions of one harness across projects;
- a main-agent-only session versus one that delegates to subagents.

The comparison view places sessions in columns and metrics/configuration in rows. It must clearly flag metrics that are missing, calculated with different semantics, or not comparable.

| Metric | Session A | Session B |
|---|---:|---:|
| Harness | Codex | Claude Code |
| Project | `my-app` | `my-app` |
| Model | GPT-5.6 | Claude Opus |
| Mode | Auto | Plan |
| Duration | 18 min | 25 min |
| Input | 120k | 95k |
| Cached input | 800k | 1.2M |
| Output | 18k | 22k |
| Subagents | 3 | 0 |

Scout gives evidence, not a verdict or an automatic "winner."

## Data model and privacy boundary

Scout parses source logs/databases but extracts only an allowlisted summary into its own runtime model:

```ts
type SessionSummary = {
  id: string;
  parentId?: string;
  project: { path?: string; repoRoot?: string; worktree?: string };
  harness: string;
  harnessVersion?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  status?: string;
  model?: string;
  mode?: string;
  usage: {
    input?: number;
    cachedInput?: number;
    cacheCreation?: number;
    output?: number;
    reasoningOutput?: number;
    confidence: "high" | "medium" | "low";
  };
  counts: { turns?: number; tools?: number; compactions?: number; subagents?: number };
  source: { harness: string; path: string; schemaVersion?: string };
};
```

The source path is operational metadata used for refresh and diagnostics. Scout must not expose the source contents in the UI.

## Technical direction

- **Language and runtime:** TypeScript + Bun.
- **Distribution:** one binary per target platform: macOS, Linux and Windows.
- **Application:** a local HTTP server with a bundled React web application, opened in the default browser on `localhost`.
- **Adapters:** versioned, read-only parsers per harness. JSONL is processed as a stream; harness-owned SQLite databases are queried read-only.
- **MVP data storage:** normalized summaries live in memory only. A rescan rebuilds the current view from source data.
- **Validation:** Zod schemas at adapter boundaries. Unknown or malformed records create diagnostics rather than preventing the rest of a scan.

Scout does not need its own SQLite database for the first MVP. An embedded index becomes worthwhile only when scan time becomes problematic or when adding durable product state such as tags, saved comparisons, historical snapshots or searchable metadata.

## Success criteria

- A developer installs Scout and opens the local web app on macOS, Linux or Windows.
- Scout discovers supported local sessions and groups them by Projects and Harnesses.
- A developer can find a session from either route, inspect its operational detail, and select multiple sessions for comparison.
- The app never shows or retains session content beyond the allowlisted metadata and metrics.
- Every displayed metric indicates uncertainty instead of inventing values when a harness does not provide trustworthy data.
