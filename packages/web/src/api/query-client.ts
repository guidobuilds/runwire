import { QueryClient } from '@tanstack/react-query';

// Scout data only changes when a scan runs, so nothing is ever stale on its own.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      retry: 1,
    },
  },
});
