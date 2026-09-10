import type {
  ApiSessionDetail,
  ApiSessionsStats,
  ListSessionsQuery,
  PagedSessions,
} from '@scout/core';
import { apiFetch } from './client';

/** Builds `/sessions?...` from only the defined fields of `query` — omits
 * undefined fields entirely rather than sending empty-string params (matches
 * createServer.ts's strict "unknown/empty query param" 400 validation). Note
 * `costOnly` is the exception to "truthy only": `false` is a real filter value
 * and is serialized as `'false'`, never omitted. */
function toSearchParams(query: ListSessionsQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.harness !== undefined) params.set('harness', query.harness);
  if (query.startedAfter !== undefined) params.set('startedAfter', query.startedAfter);
  if (query.model !== undefined) params.set('model', query.model);
  if (query.q !== undefined) params.set('q', query.q);
  if (query.durationMin !== undefined) params.set('durationMin', String(query.durationMin));
  if (query.costOnly !== undefined) params.set('costOnly', query.costOnly ? 'true' : 'false');
  if (query.sort !== undefined) params.set('sort', query.sort);
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** `GET /api/sessions` — returns the paged root-session list. */
export function fetchSessions(query: ListSessionsQuery = {}): Promise<PagedSessions> {
  return apiFetch<PagedSessions>(`/api/sessions${toSearchParams(query)}`);
}

/**
 * `GET /api/sessions/stats` — full-filtered-set aggregates for the dashboard
 * cards + chart. Accepts the same filter params as `fetchSessions` but the
 * server rejects `limit`/`offset`/`sort`, so callers should only ever pass a
 * filters-only query (see `buildSessionsStatsQuery`).
 */
export function fetchSessionsStats(query: ListSessionsQuery = {}): Promise<ApiSessionsStats> {
  return apiFetch<ApiSessionsStats>(`/api/sessions/stats${toSearchParams(query)}`);
}

/**
 * `GET /api/sessions/{id}` — createServer.ts wraps the detail payload in a
 * `{ session }` envelope (verified directly from the route handler, not
 * assumed from the DTO shape); this unwraps it before returning.
 */
export async function fetchSession(id: string): Promise<ApiSessionDetail> {
  const { session } = await apiFetch<{ session: ApiSessionDetail }>(
    `/api/sessions/${encodeURIComponent(id)}`,
  );
  return session;
}
