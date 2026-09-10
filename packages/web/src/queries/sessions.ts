import type { ListSessionsQuery } from '@scout/core';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { fetchSession, fetchSessions, fetchSessionsStats } from '@/lib/api/sessions';

export function sessionsQueryOptions(query: ListSessionsQuery = {}) {
  return queryOptions({
    queryKey: ['sessions', query] as const,
    queryFn: () => fetchSessions(query),
    // Each filter/sort/pagination change is a new query key; keep the rows from
    // the previous key on screen while the next page loads instead of flashing
    // an empty/loading state.
    placeholderData: keepPreviousData,
  });
}

export function sessionQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['sessions', id] as const,
    queryFn: () => fetchSession(id),
  });
}

/** `GET /api/sessions` as a TanStack Query hook. */
export function useSessions(query: ListSessionsQuery = {}) {
  return useQuery(sessionsQueryOptions(query));
}

/**
 * Full-filtered-set aggregates from `GET /api/sessions/stats`, keyed by the
 * filters-only query. Kept on the previous aggregates while the next key loads
 * (same anti-flash contract as the list) so the cards/chart do not blink on a
 * filter change.
 */
export function sessionsStatsQueryOptions(query: ListSessionsQuery = {}) {
  return queryOptions({
    queryKey: ['sessions', 'stats', query] as const,
    queryFn: () => fetchSessionsStats(query),
    placeholderData: keepPreviousData,
  });
}

/** `GET /api/sessions/stats` as a TanStack Query hook. */
export function useSessionsStats(query: ListSessionsQuery = {}) {
  return useQuery(sessionsStatsQueryOptions(query));
}

/** `GET /api/sessions/{id}` as a TanStack Query hook. */
export function useSession(id: string) {
  return useQuery(sessionQueryOptions(id));
}
