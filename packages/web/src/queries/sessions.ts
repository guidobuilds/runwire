import type { ListSessionsQuery } from '@runwire/core';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { fetchSession, fetchSessions, fetchSessionsStats } from '@/lib/api/sessions';

export function sessionsQueryOptions(query: ListSessionsQuery = {}) {
  return queryOptions({
    queryKey: ['sessions', query] as const,
    queryFn: () => fetchSessions(query),
    placeholderData: keepPreviousData,
  });
}

export function sessionQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['sessions', id] as const,
    queryFn: () => fetchSession(id),
  });
}

export function useSessions(query: ListSessionsQuery = {}) {
  return useQuery(sessionsQueryOptions(query));
}

export function sessionsStatsQueryOptions(query: ListSessionsQuery = {}) {
  return queryOptions({
    queryKey: ['sessions', 'stats', query] as const,
    queryFn: () => fetchSessionsStats(query),
    placeholderData: keepPreviousData,
  });
}

export function useSessionsStats(query: ListSessionsQuery = {}) {
  return useQuery(sessionsStatsQueryOptions(query));
}

export function useSession(id: string) {
  return useQuery(sessionQueryOptions(id));
}
