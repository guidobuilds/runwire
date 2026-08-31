import type { InferResponseType } from 'hono/client';
import type { api } from './client';

export type {
  Capability,
  ComparabilityFlag,
  ComparabilityMatrix,
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
