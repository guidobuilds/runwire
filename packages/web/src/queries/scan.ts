import { useMutation, useQueryClient } from '@tanstack/react-query';
import { runScan } from '@/lib/api/scan';

/**
 * `POST /api/scan` as a TanStack Query mutation. On success it invalidates every
 * cache entry under `['sessions']` (the list, the per-filter pages, the stats
 * series and each detail), plus `['harnesses']` and `['session-profile']`, so the
 * dashboard refetches what the scan just imported — including the harness filter,
 * which is kept at `staleTime: Infinity` precisely because the scan always
 * invalidates it.
 */
export function useScanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runScan,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['harnesses'] });
      void queryClient.invalidateQueries({ queryKey: ['session-profile'] });
    },
  });
}
