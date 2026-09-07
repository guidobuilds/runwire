import type { ApiSessionDetail, ListSessionsQuery, PagedSessions } from '@scout/core';
import { apiFetch } from './client';

/** Builds `/sessions?...` from only the defined fields of `query` — omits
 * undefined fields entirely rather than sending empty-string params (matches
 * createServer.ts's strict "unknown/empty query param" 400 validation). */
function toSearchParams(query: ListSessionsQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.harness !== undefined) params.set('harness', query.harness);
  if (query.startedAfter !== undefined) params.set('startedAfter', query.startedAfter);
  if (query.model !== undefined) params.set('model', query.model);
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** `GET /sessions` — returns the paged root-session list. */
export function fetchSessions(query: ListSessionsQuery = {}): Promise<PagedSessions> {
  return apiFetch<PagedSessions>(`/sessions${toSearchParams(query)}`);
}

/**
 * `GET /sessions/{id}` — createServer.ts wraps the detail payload in a
 * `{ session }` envelope (verified directly from the route handler, not
 * assumed from the DTO shape); this unwraps it before returning.
 */
export async function fetchSession(id: string): Promise<ApiSessionDetail> {
  const { session } = await apiFetch<{ session: ApiSessionDetail }>(
    `/sessions/${encodeURIComponent(id)}`,
  );
  return session;
}
