import type {
  ApiSessionDetail,
  ApiSessionsStats,
  ListSessionsQuery,
  PagedSessions,
} from '@runwire/core';
import { apiFetch } from './client';

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

export function fetchSessions(query: ListSessionsQuery = {}): Promise<PagedSessions> {
  return apiFetch<PagedSessions>(`/api/sessions${toSearchParams(query)}`);
}

export function fetchSessionsStats(query: ListSessionsQuery = {}): Promise<ApiSessionsStats> {
  return apiFetch<ApiSessionsStats>(`/api/sessions/stats${toSearchParams(query)}`);
}

export async function fetchSession(id: string): Promise<ApiSessionDetail> {
  const { session } = await apiFetch<{ session: ApiSessionDetail }>(
    `/api/sessions/${encodeURIComponent(id)}`,
  );
  return session;
}
