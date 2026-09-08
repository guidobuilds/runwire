import type { ListSessionsQuery } from '@scout/core';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { fetchSession, fetchSessions } from '@/lib/api/sessions';

export function sessionsQueryOptions(query: ListSessionsQuery = {}) {
  return queryOptions({
    queryKey: ['sessions', query] as const,
    queryFn: () => fetchSessions(query),
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
