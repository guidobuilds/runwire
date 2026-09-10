import type { ListSessionsQuery } from '@scout/core';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { fetchSession, fetchSessions } from '@/lib/api/sessions';

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

/** `GET /api/sessions/{id}` as a TanStack Query hook. */
export function useSession(id: string) {
  return useQuery(sessionQueryOptions(id));
}
