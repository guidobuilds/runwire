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
  Initiator,
  InitiatorKind,
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
  /**
   * How many root sessions in THIS scope `?automated=exclude` removed, so a
   * view can say what it is not showing. Zero whenever the preference is on.
   *
   * The hidden sessions are excluded from every count and every usage total on
   * screen (that is the approved model); this number is a disclosure of the
   * filter's own effect, not an aggregate over them.
   */
  hiddenAutomated: number;
};

/**
 * GET /api/sessions success body, WITH `ids` (Compare's mode): every requested
 * id that resolved (unknown ids silently dropped) + rollups. The
 * `comparability` matrix this branch used to additionally return was removed as
 * unused API surface — the Compare UI derives its own missing/derived flags
 * from `lib/capabilities.ts` instead; see docs/DECISIONS.md D40.
 *
 * No longer an alias of `SessionsListResponse`: this branch has no
 * `hiddenAutomated` because it hides nothing. `?automated=` is ignored when
 * `ids` is present — every id there is a session the user explicitly put in the
 * Compare tray, and dropping those columns would delete the user's own
 * selection (packages/server/src/routes.ts).
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
export type CompareSessionsResponse = {
  summaries: SessionSummary[];
  rollups: Record<string, SessionRollup>;
};
