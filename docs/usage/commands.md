# Command reference

The two commands of the `scout` CLI. Definitions of the stored fields: [what-scout-knows.md](what-scout-knows.md) and [ARCHITECTURE.md §5](../ARCHITECTURE.md#5-sqlite-schema).

## `scout import`

```text
scout import [--adapter <id>] [--home <dir>] [--db <path>] [--no-titles]
```

Runs adapters and stores their sessions. Reads harness data; writes only to the Scout database.

| Flag | Default | Meaning |
|---|---|---|
| `--adapter <id>` | all registered adapters | Restrict to one adapter. Valid ids: `claude-code`, `opencode`. Unknown ids fail with exit `1`. |
| `--home <dir>` | real OS home | Where adapters look for harness data. |
| `--db <path>` | `~/.scout/scout.db` | Database location. `--db :memory:` imports into RAM. |
| `--no-titles` | off | Do not store harness-generated session titles. |

Behavior:

- Incremental: sources whose size and mtime match the stored record are skipped.
- Removal: stored sessions whose source no longer exists are deleted, after a full successful discovery pass only.
- Rollups and aggregates are recomputed after each import (inclusive of a session's subagents).

Output:

- **stderr** — one report line per adapter: `discovered / imported / skipped / removed / failed` counts plus duration. This is the `ImportReport`; it is the only human-facing summary.
- **exit `1`** — any adapter errored, or any session bundle failed validation. **exit `0`** otherwise. **exit `2`** — bad command-line usage (unknown flag, positional argument). Partial results stay persisted: failed bundles are reported, not silently dropped.

## `scout discover`

```text
scout discover --adapter <id> [--home <dir>] [--json] [--no-titles]
```

Streams one bundle per session, read-only, without touching any store. Requires an adapter — there is no "all adapters" mode.

| Flag | Default | Meaning |
|---|---|---|
| `--adapter <id>` | required | The adapter to stream. |
| `--home <dir>` | real OS home | Where adapters look for harness data. |
| `--json` | off | NDJSON mode (below). |
| `--no-titles` | off | Drop titles from the emitted bundles. |

Output:

- With `--json`: stdout carries exactly one `SessionBundle` per line (NDJSON) and nothing else — safe to pipe or redirect. Without `--json`: one terse human-readable line per session.
- Diagnostics embedded in bundles (a malformed line, an unknown record type, …) are part of the session's data, not log noise. All logs and errors always go to stderr.

## Shared guarantees

| Guarantee | Detail |
|---|---|
| Read-only | Scout never modifies harness files, databases or configuration. |
| Stdout/stderr split | Piping or redirecting stdout is always clean; every log and the import report go to stderr. |
| No daemon | Every run is a one-shot scan; nothing runs in the background (D19). |
| Local-only | No account, API key, network access or telemetry. |
