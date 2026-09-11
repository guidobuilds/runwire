# Command reference

The three commands of the `scout` CLI. Definitions of the stored fields: [what-scout-knows.md](what-scout-knows.md) and [ARCHITECTURE.md §5](../ARCHITECTURE.md#5-sqlite-schema).

## `scout import`

```text
scout import [--adapter <id>] [--home <dir>] [--db <path>] [--no-titles] [--force]
```

Runs adapters and stores their sessions. Reads harness data; writes only to the Scout database.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--adapter <id>` | all registered adapters | Restrict to one adapter. Valid ids: `claude-code`, `opencode`. Unknown ids fail with exit `1`. |
| `--home <dir>` | real OS home | Where adapters look for harness data. |
| `--db <path>` | `~/.scout/scout.db` | Database location. `--db :memory:` imports into RAM. |
| `--no-titles` | off | Do not store harness-generated session titles. |
| `--force` | off | Re-read and recompute every discovered source, ignoring the stored size/mtime cache. Does not delete the database. |

Behavior:

- Incremental: sources whose size and mtime match the stored record are skipped.
- Forced: `--force` bypasses incremental skipping while preserving normal vanished-source detection.
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
| --- | --- | --- |
| `--adapter <id>` | required | The adapter to stream. |
| `--home <dir>` | real OS home | Where adapters look for harness data. |
| `--json` | off | NDJSON mode (below). |
| `--no-titles` | off | Drop titles from the emitted bundles. |

Output:

- With `--json`: stdout carries exactly one `SessionBundle` per line (NDJSON) and nothing else — safe to pipe or redirect. Without `--json`: one terse human-readable line per session.
- Diagnostics embedded in bundles (a malformed line, an unknown record type, …) are part of the session's data, not log noise. All logs and errors always go to stderr.

## `scout serve`

```text
scout serve [--db <path>] [--host <host>] [--port <n>] [--no-titles]
```

Starts the local HTTP API. This is the first long-running process in the repo — it does **not**
watch the database; it reads SQLite live per request, so an `import` and a `serve` can coexist under WAL.
`POST /api/scan` is the one write endpoint: it runs the same import as `scout import`.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--db <path>` | `~/.scout/scout.db` | Database location. `--db :memory:` serves from RAM. |
| `--host <host>` | `127.0.0.1` | Bind address (loopback-only default). |
| `--port <n>` | `8787` | TCP port. |
| `--no-titles` | off | Do not store harness-generated session titles during a web-triggered scan. Same privacy switch as `scout import` (D7). |

Output:

- **stderr** — one line: `scout serve listening on http://<host>:<port>`. stdout stays clean. The process runs
  until SIGINT/SIGTERM.

### `GET /api/sessions`

List root sessions with optional filters and offset pagination:

```text
GET /api/sessions?limit=<n>&offset=<n>&harness=<id>&startedAfter=<ISO-8601>&model=<exact-string>
```

| Param | Type / default | Meaning |
| --- | --- | --- |
| `limit` | integer, default `50`, max `200` | Page size. Must be an integer in `[1, 200]`; out-of-range or non-integer ⇒ `400`. |
| `offset` | integer, default `0` | Page offset. Must be a non-negative integer. |
| `harness` | harness id, exact | Keep roots whose `harness_id` equals the value, case-sensitive. Empty ⇒ `400`. |
| `startedAfter` | ISO-8601 datetime | Keep roots with `started_at > value` (exclusive). A `NULL` `started_at` never matches. The value is normalized to canonical `.sssZ` UTC. Invalid date ⇒ `400`. |
| `model` | exact string | Keep roots where the model appears in the root session **or** any descendant. Case-sensitive. Empty ⇒ `400`. |

Response:

```json
{ "items": [ ... ], "total": 120, "limit": 50, "offset": 0 }
```

- `items` — the page of root sessions (ordered `started_at DESC, id`).
- `total` — the **pre-pagination** count of the filtered root set (not `items.length`).
- `limit` / `offset` — echo the effective (defaulted) values.
- All present filters combine with **AND**.
- Any **unknown**, **duplicate** (`?limit=10&limit=20`), or **invalid** query parameter returns `400` with
  `{ "error": "invalid query parameter", "parameter": "<name>" }`.

`GET /api/sessions/{id}` is unchanged; a query string there is ignored.

All scout API routes are served under `/api`; the legacy un-prefixed `/sessions*`
and `/` paths are not exposed by the server.

### `POST /api/scan`

Runs a full import synchronously and returns the resulting `ImportReport`:

```text
POST /api/scan
```

- No request body and no query parameters are read; the scan always covers every registered adapter
  (the same work as `scout import`).
- The response is `200` with the `ImportReport` (`{ perAdapter, durationMs }`) once every adapter has
  finished — the client waits for the whole scan.
- An `ImportReport` with any adapter `error` or any `failed > 0` is a **failed scan**: the response is
  `500` with `{ "error": "one or more imports failed", "report": { ... } }` so a client can tell a
  partial import from a clean one (the same failure rule as `scout import`'s exit `1`).
- A `GET` (or any non-`POST`) on `/api/scan` returns `405` with `Allow: POST`.
- When the server was started without a scan callback, `POST /api/scan` returns `503`
  `{ "error": "scan unavailable" }`.
- The scan persists to the same database the server is reading; it never touches harness files.

## Shared guarantees

| Guarantee | Detail |
| --- | --- |
| Harness files read-only | Scout never modifies harness files or harness configuration. `scout import` and `POST /api/scan` write only to the Scout database. |
| Stdout/stderr split | Piping or redirecting stdout is always clean; every log and the import report go to stderr. |
| No daemon | Every run is a one-shot scan; nothing runs in the background (D19). |
| Local-only | No account, API key, network access or telemetry. |
