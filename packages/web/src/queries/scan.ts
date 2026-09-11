import { useMutation, useQueryClient } from '@tanstack/react-query';
import { runScan } from '@/lib/api/scan';

/**
 * `POST /api/scan` as a TanStack Query mutation. On success every cache entry
 * whose key starts with `['sessions']` is invalidated (the list, the per-filter
 * pages, the stats series and each detail), so the dashboard refetches what the
 * scan just imported.
 */
export function useScanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
}
