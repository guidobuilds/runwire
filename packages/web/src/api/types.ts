import type { SessionRollup, SessionSummary } from '@scout/core';
import type { InferResponseType } from 'hono/client';
import type { api } from './client';

export type {
  Capability,
  Confidence,
  Counts,
  Diagnostic,
  HarnessAggregate,
  HarnessId,
  Metric,
  ProjectAggregate,
  ScanReport,
  SessionRollup,
  SessionSummary,
  SessionTrace,
  ToolCategory,
  TraceStep,
  Usage,
} from '@scout/core';

/**
 * GET /api/status body. Untagged `c.json(body)` is typed as ContentfulStatusCode,
 * so `InferResponseType<fn, 200>` is `never` (confirmed against hono 4.13.5
 * `InferResponseType<T, U extends StatusCode>`). The unfiltered alias is the
 * 200-equivalent success body.
 */
export type StatusResponse = InferResponseType<typeof api.api.status.$get>;

/**
 * GET /api/sessions/:id success body. The 404 branch is explicitly tagged, so
 * drop `{ error: string }`; that is the status-200 payload the RPC client
 * returns when `res.ok`.
 */
export type SessionDetailResponse = Exclude<
  InferResponseType<(typeof api.api.sessions)[':id']['$get']>,
  { error: string }
>;

/**
 * GET /api/sessions/:id/trace success body (packages/server/src/routes.ts).
 * The 404 branch (`{ error: 'trace not found' }`) is explicitly tagged, so
 * dropped here the same way `SessionDetailResponse` drops its own 404 —
 * `res.ok` is what routes callers to this type vs. throwing via `unwrap`.
 */
export type SessionTraceResponse = Exclude<
  InferResponseType<(typeof api.api.sessions)[':id']['trace']['$get']>,
  { error: string }
>;

/**
 * GET /api/sessions success body, WITHOUT `ids` (packages/server/src/routes.ts,
 * f5): every root session's summary + rollup, unscoped by project or harness.
 */
export type SessionsListResponse = {
  summaries: SessionSummary[];
  rollups: Record<string, SessionRollup>;
};

/**
 * GET /api/sessions success body, WITH `ids` (Compare's mode): every requested
 * id that resolved (unknown ids silently dropped) + rollups. Shape-identical
 * to `SessionsListResponse` (the `comparability` matrix this branch used to
 * additionally return was removed as unused API surface — the Compare UI
 * derives its own missing/derived flags from `lib/capabilities.ts` instead;
 * see docs/DECISIONS.md D40) but kept as its own alias for call-site clarity
 * at `useCompareSessions`.
 *
 * Hand-typed rather than derived through Hono's `InferResponseType`, unlike
 * `SessionDetailResponse`/`SessionTraceResponse` above. Reason (see
 * `hono-inferresponsetype-untagged-json` in .forge/lessons.md): both success
 * branches of `GET /sessions` call untagged `c.json`, which Hono cannot
 * distinguish by status, so `InferResponseType<typeof api.api.sessions.$get>`
 * is one union of every branch's shape (including the 400 error) with no way
 * to select just one by filtering on status. `unwrap<T>` only needs its
 * response's `json()` to structurally satisfy `Unwrapable` (see
 * `api/client.ts`), so pinning `T` by hand here is exact and independent of
 * whatever Hono infers for the route as a whole.
 */
export type CompareSessionsResponse = SessionsListResponse;
