import { queryOptions, useQuery } from '@tanstack/react-query';
import { fetchHarnesses } from '@/lib/api/harnesses';

export function harnessesQueryOptions() {
  return queryOptions({
    queryKey: ['harnesses'] as const,
    queryFn: fetchHarnesses,
    staleTime: Infinity,
  });
}

export function useHarnesses() {
  return useQuery(harnessesQueryOptions());
}
