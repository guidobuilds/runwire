import { queryOptions, useQuery } from '@tanstack/react-query';
import { fetchHarnesses } from '@/lib/api/harnesses';

/** Harness options are effectively static for a session's lifetime, so this
 * query never goes stale and is fetched at most once per cache. */
export function harnessesQueryOptions() {
  return queryOptions({
    queryKey: ['harnesses'] as const,
    queryFn: fetchHarnesses,
    staleTime: Infinity,
  });
}

/** `GET /api/harnesses` as a TanStack Query hook. */
export function useHarnesses() {
  return useQuery(harnessesQueryOptions());
}
