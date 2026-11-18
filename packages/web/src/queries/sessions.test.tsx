import type { ListSessionsQuery, PagedSessions } from '@runwire/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  mockPagedSessions,
  mockSessionDetail,
  mockSessionSummary,
  mockSessionsStats,
  mockSessionsStatsMulti,
} from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { useSession, useSessions, useSessionsStats } from './sessions';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSessions', () => {
  it('resolves with the mocked paged session list', async () => {
    const { result } = renderHook(() => useSessions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([mockSessionSummary]);
    expect(result.current.data?.total).toBe(1);
  });
});

describe('useSession', () => {
  it('resolves with the mocked session detail', async () => {
    const { result } = renderHook(() => useSession('sess-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockSessionDetail);
  });
});

describe('useSessions keepPreviousData', () => {
  it('keeps the previous page visible while a different query key fetches', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stableWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const pageB: PagedSessions = {
      items: [
        { ...mockSessionSummary, id: 'sess-b', name: 'Fix flaky test', title: 'Fix flaky test' },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };

    server.use(
      http.get('/api/sessions', async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        if (q === 'b') {
          await delay(150);
          return HttpResponse.json(pageB);
        }
        return HttpResponse.json(mockPagedSessions);
      }),
    );

    const { result, rerender } = renderHook(
      ({ query }: { query: ListSessionsQuery }) => useSessions(query),
      { wrapper: stableWrapper, initialProps: { query: { q: 'a' } } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([mockSessionSummary]);

    rerender({ query: { q: 'b' } });

    expect(result.current.data?.items).toEqual([mockSessionSummary]);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.isFetching).toBe(true);

    await waitFor(() => expect(result.current.data?.items).toEqual(pageB.items));
    expect(result.current.isPlaceholderData).toBe(false);
  });
});

describe('useSessionsStats', () => {
  it('resolves with the mocked full-filtered-set aggregates', async () => {
    const { result } = renderHook(() => useSessionsStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockSessionsStats);
  });

  it('refetches with the new filter when the query key changes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stableWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const searches: string[] = [];
    server.use(
      http.get('/api/sessions/stats', ({ request }) => {
        searches.push(new URL(request.url).search);
        return HttpResponse.json(
          searches.length === 1 ? mockSessionsStats : mockSessionsStatsMulti,
        );
      }),
    );

    const { result, rerender } = renderHook(
      ({ query }: { query: ListSessionsQuery }) => useSessionsStats(query),
      { wrapper: stableWrapper, initialProps: { query: {} } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockSessionsStats);

    rerender({ query: { q: 'auth' } });

    await waitFor(() => expect(searches).toHaveLength(2));
    expect(searches[1]).toContain('q=auth');
    await waitFor(() => expect(result.current.data).toEqual(mockSessionsStatsMulti));
  });
});
