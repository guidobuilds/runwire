import { useMutation, useQueryClient } from '@tanstack/react-query';
import { runScan } from '@/lib/api/scan';

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
