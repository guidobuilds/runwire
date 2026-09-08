import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sessionProfileKeys,
  useSessionProfileMergedEvents,
  useSessionProfileSignals,
  useSessionProfileTimeline,
} from './session-profile';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

function mergedBody(offset: number, itemAt: string) {
  return {
    sessionId: 'root',
    scope: 'tree',
    filter: 'signals',
    items: [
      {
        streamId: 'root',
        sessionId: 'root',
        seq: offset + 1,
        at: itemAt,
        error: null,
        kind: 'compaction',
        trigger: 'auto',
      },
    ],
    total: 10,
    limit: 1,
    offset,
    excludedNullAtCount: 0,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('session profile query keys', () => {
  it('separates scopes, fields, filters, pagination, expansion and refresh', () => {
    expect(sessionProfileKeys.spawns('a', { scope: 'tree', expandedIds: ['b', 'a', 'a'] })).toEqual(
      sessionProfileKeys.spawns('a', { scope: 'tree', expandedIds: ['a', 'b'] }),
    );
    expect(sessionProfileKeys.spawns('a', { scope: 'tree' })).not.toEqual(
      sessionProfileKeys.spawns('a', { scope: 'own' }),
    );
    expect(sessionProfileKeys.signals('a', { scope: 'tree' })).not.toEqual(
      sessionProfileKeys.signals('a', { scope: 'own' }),
    );
    expect(sessionProfileKeys.timeline('a', { scope: 'tree', field: 'output' })).not.toEqual(
      sessionProfileKeys.timeline('a', { scope: 'tree', field: 'cacheWrite' }),
    );
    expect(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', filter: 'signals', offset: 0 }),
    ).not.toEqual(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', filter: 'signals', offset: 50 }),
    );
    expect(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', filter: 'signals', refresh: 1 }),
    ).not.toEqual(sessionProfileKeys.mergedEvents('a', { scope: 'tree', filter: 'signals' }));
  });

  it('fetches signals and surfaces errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 })),
    );
    const hook = renderHook(() => useSessionProfileSignals('root', { scope: 'tree' }), {
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
  });

  it('bumps the timeline key on refresh and refetches', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: 'root',
          scope: 'tree',
          field: 'output',
          series: [],
          points: [],
          spawns: [],
          excludedNullAtCount: 0,
          timeDomain: { start: null, end: null },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const hook = renderHook(
      ({ refresh }) =>
        useSessionProfileTimeline('root', { scope: 'tree', field: 'output', refresh }),
      { initialProps: { refresh: 0 }, wrapper },
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ refresh: 1 });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('paginates merged events by page number and keeps prior data while loading', async () => {
    const fetch = vi.fn((input: string) => {
      const offset = input.includes('offset=1') ? 1 : 0;
      return Promise.resolve(
        new Response(JSON.stringify(mergedBody(offset, `2026-09-01T10:0${offset}:00.000Z`)), {
          status: 200,
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const hook = renderHook(
      ({ offset }) =>
        useSessionProfileMergedEvents('root', {
          scope: 'tree',
          filter: 'signals',
          limit: 1,
          offset,
        }),
      { initialProps: { offset: 0 }, wrapper },
    );
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data?.items[0]?.seq).toBe(1);

    hook.rerender({ offset: 1 });
    // keepPreviousData: the prior page's data stays visible immediately.
    expect(hook.result.current.data?.items[0]?.seq).toBe(1);
    await waitFor(() => expect(hook.result.current.data?.items[0]?.seq).toBe(2));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
