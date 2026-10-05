import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/node';
import { mockProfileContextTree, mockProfileModelsTree } from '@/mocks/session-profile';
import {
  sessionProfileKeys,
  useSessionProfileContext,
  useSessionProfileMergedEvents,
  useSessionProfileModels,
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
    sort: 'time',
    dir: 'asc',
    items: [
      {
        streamId: 'root',
        sessionId: 'root',
        seq: offset + 1,
        at: itemAt,
        error: null,
        kind: 'compaction',
        trigger: 'auto',
        action: 'compaction',
        subject: 'auto',
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
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', sort: 'time', offset: 0 }),
    ).not.toEqual(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', sort: 'time', offset: 50 }),
    );
    expect(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', sort: 'time', refresh: 1 }),
    ).not.toEqual(sessionProfileKeys.mergedEvents('a', { scope: 'tree', sort: 'time' }));
    expect(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', sort: 'kind', kind: ['tool'] }),
    ).not.toEqual(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', sort: 'kind', kind: ['call'] }),
    );
    expect(
      sessionProfileKeys.mergedEvents('a', {
        scope: 'tree',
        action: ['mcp', 'agent'],
      }),
    ).toEqual(
      sessionProfileKeys.mergedEvents('a', {
        scope: 'tree',
        action: ['agent', 'mcp', 'mcp'],
      }),
    );
  });

  it('keys model usage by refresh and separately from the other views', () => {
    expect(sessionProfileKeys.models('a', {})).toEqual(['session-profile', 'a', 'models', 0]);
    expect(sessionProfileKeys.models('a', { refresh: 1 })).not.toEqual(
      sessionProfileKeys.models('a', { refresh: 0 }),
    );
    expect(sessionProfileKeys.models('a', {})).not.toEqual(
      sessionProfileKeys.signals('a', { scope: 'tree' }),
    );
    expect(sessionProfileKeys.models('a', {})).not.toEqual(
      sessionProfileKeys.timeline('a', { scope: 'tree', field: 'output' }),
    );
    expect(sessionProfileKeys.models('a', {})).not.toEqual(
      sessionProfileKeys.mergedEvents('a', { scope: 'tree', sort: 'time' }),
    );
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
          sort: 'time',
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

  it('fetches model usage through the MSW mock', async () => {
    const hook = renderHook(() => useSessionProfileModels('sess-1', {}), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data).toMatchObject({
      view: 'models',
      sessionId: 'sess-1',
      session: {
        outputTokens: 1000,
        models: [
          { model: 'claude-sonnet-5', outputTokens: 900, share: 0.9 },
          { model: 'claude-haiku-4', outputTokens: 0, share: 0 },
        ],
      },
      descendants: {
        outputTokens: 400,
        models: [
          { model: 'claude-opus-4', outputTokens: 300, share: 0.75 },
          { model: 'claude-haiku-4', outputTokens: 100, share: 0.25 },
        ],
      },
    });
  });

  it('refetches model usage when refresh changes', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/models', () => {
        calls += 1;
        return HttpResponse.json(mockProfileModelsTree);
      }),
    );
    const hook = renderHook(({ refresh }) => useSessionProfileModels('sess-1', { refresh }), {
      initialProps: { refresh: 0 },
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ refresh: 1 });
    await waitFor(() => expect(calls).toBe(2));
  });

  it('keys context by refresh and separately from the other views', () => {
    expect(sessionProfileKeys.context('a', {})).toEqual(['session-profile', 'a', 'context', 0]);
    expect(sessionProfileKeys.context('a', { refresh: 1 })).not.toEqual(
      sessionProfileKeys.context('a', { refresh: 0 }),
    );
    expect(sessionProfileKeys.context('a', {})).not.toEqual(sessionProfileKeys.models('a', {}));
  });

  it('fetches context through the MSW mock and surfaces the descendant tree', async () => {
    const hook = renderHook(() => useSessionProfileContext('sess-1', {}), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data).toMatchObject({
      view: 'context',
      sessionId: 'sess-1',
      own: { observedCalls: 4, promptInput: 4000 },
      tree: { observedCalls: 9, promptInput: 9000 },
    });
    expect(hook.result.current.data?.descendants.map((d) => [d.id, d.relativeDepth])).toEqual([
      ['sess-1-child', 1],
      ['sess-1-child/grand', 2],
    ]);
  });

  it('refetches context when refresh changes', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/context', () => {
        calls += 1;
        return HttpResponse.json(mockProfileContextTree);
      }),
    );
    const hook = renderHook(({ refresh }) => useSessionProfileContext('sess-1', { refresh }), {
      initialProps: { refresh: 0 },
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ refresh: 1 });
    await waitFor(() => expect(calls).toBe(2));
  });
});
