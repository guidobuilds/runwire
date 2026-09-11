import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mockImportReport } from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { useScanMutation } from './scan';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useScanMutation', () => {
  it('POSTs /api/scan and resolves with the ImportReport', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useScanMutation(), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockImportReport);
  });

  it('invalidates every sessions query on success', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(['sessions', {}], { items: [], total: 0, limit: 50, offset: 0 });
    queryClient.setQueryData(['sessions', 'sess-1'], { id: 'sess-1' });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] });
    // `invalidateQueries({ queryKey: ['sessions'] })` is prefix-matched, so both
    // the list and the detail entry are marked stale.
    expect(queryClient.getQueryState(['sessions', {}])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['sessions', 'sess-1'])?.isInvalidated).toBe(true);
  });

  it('does not invalidate sessions when the scan fails', async () => {
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    server.use(
      http.post('/api/scan', () => HttpResponse.json({ error: 'internal error' }, { status: 500 })),
    );

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('treats a report failure (500 with the ImportReport) as an error and does not invalidate', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(['sessions', {}], { items: [], total: 0, limit: 50, offset: 0 });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    // The server mirrors the CLI failure rule with a non-2xx status plus the
    // report, so the mutation must stay an error and leave caches untouched.
    server.use(
      http.post('/api/scan', () =>
        HttpResponse.json(
          {
            error: 'one or more imports failed',
            report: {
              perAdapter: {
                'claude-code': { discovered: 1, imported: 0, skipped: 0, removed: 0, failed: 1 },
              },
              durationMs: 3,
            },
          },
          { status: 500 },
        ),
      ),
    );

    const { result } = renderHook(() => useScanMutation(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as Error).message).toBe('one or more imports failed');
    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(['sessions', {}])?.isInvalidated).toBe(false);
  });
});
