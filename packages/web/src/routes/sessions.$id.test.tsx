import type { ApiSessionDetail } from '@scout/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockChildSummary, mockSessionDetail } from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { routeTree } from '@/routeTree.gen';

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, history };
}

/** Captures every request to the single `/session-profiles/:id` endpoint
 * without intercepting the response: the resolver returns `undefined`, so
 * MSW falls through to the real composed handler, exercising the actual
 * shipped views. */
function captureProfileRequests(): URL[] {
  const requests: URL[] = [];
  server.use(
    http.get('/session-profiles/:id', ({ request }) => {
      requests.push(new URL(request.url));
      return undefined;
    }),
  );
  return requests;
}

const SLASH_ID = 'claude-code:sess-1/child-x';
const slashSessionDetail: ApiSessionDetail = {
  ...mockSessionDetail,
  children: [],
  id: SLASH_ID,
  name: 'Slash Agent',
};

describe('/sessions/$id route (session profile)', () => {
  it('composes header, agent graph, token chart, events table and signals accordion in that order', async () => {
    renderAt(`/sessions/${mockSessionDetail.id}`);

    await screen.findByText('Harness signals');
    const text = document.body.textContent ?? '';
    const iHeader = text.indexOf(mockSessionDetail.name);
    const iGraph = text.indexOf('Agents');
    const iChart = text.indexOf('Token usage');
    const iTable = text.indexOf('Events');
    const iSignals = text.indexOf('Harness signals');

    expect(iHeader).toBeGreaterThanOrEqual(0);
    expect(iGraph).toBeGreaterThan(iHeader);
    expect(iChart).toBeGreaterThan(iGraph);
    expect(iTable).toBeGreaterThan(iChart);
    expect(iSignals).toBeGreaterThan(iTable);
  });

  it('requests the default field/filter/pagination on load', async () => {
    const requests = captureProfileRequests();
    renderAt(`/sessions/${mockSessionDetail.id}`);

    await screen.findByText('Harness signals');

    const timelineReq = requests.find((url) => url.searchParams.get('view') === 'timeline');
    expect(timelineReq?.searchParams.get('field')).toBe('output');

    const mergedReqs = requests.filter((url) => url.searchParams.get('view') === 'merged');
    const tableReq = mergedReqs.find((url) => url.searchParams.get('limit') === '50');
    expect(tableReq?.searchParams.get('filter')).toBe('signals');
    expect(tableReq?.searchParams.get('offset')).toBe('0');
  });

  it('changing the token field updates the URL search', async () => {
    const user = userEvent.setup();
    const { router } = renderAt(`/sessions/${mockSessionDetail.id}`);
    await screen.findByText('Harness signals');

    await user.click(screen.getByRole('combobox', { name: 'Token field' }));
    await user.click(await screen.findByRole('option', { name: 'Cached input' }));

    await waitFor(() => {
      expect(router.state.location.search.field).toBe('cachedInput');
    });
  });

  it('paginates the events table to offset=50', async () => {
    server.use(
      http.get('/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('view') !== 'merged') return undefined;
        const limit = Number(url.searchParams.get('limit') ?? '50');
        const offset = Number(url.searchParams.get('offset') ?? '0');
        return HttpResponse.json({
          excludedNullAtCount: 0,
          filter: url.searchParams.get('filter') ?? 'signals',
          items: [],
          limit,
          offset,
          scope: 'tree',
          sessionId: mockSessionDetail.id,
          total: 120,
          view: 'merged',
        });
      }),
    );
    const requests = captureProfileRequests();
    renderAt(`/sessions/${mockSessionDetail.id}`);

    await screen.findByRole('button', { name: 'Go to next page' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));

    await waitFor(() => {
      const mergedReqs = requests.filter((url) => url.searchParams.get('view') === 'merged');
      expect(mergedReqs.some((url) => url.searchParams.get('offset') === '50')).toBe(true);
    });
  });

  // Regression coverage for verification.md#f5 F-12: the events table's
  // filter Select fires onFilterChange + onPageChange(1) synchronously from
  // one gesture; the route's pendingRef/queueMicrotask batcher must merge
  // both into a single navigation, or a user's Back button would trip over a
  // stale duplicate history entry. Asserted on history length, not just the
  // final search value, since two navigate() calls that happen to converge
  // on the same final search would still leave an extra entry undetected by
  // a value-only assertion.
  it('merges a same-tick filter-change + page-reset into exactly one history entry', async () => {
    const user = userEvent.setup();
    const { router, history } = renderAt(`/sessions/${mockSessionDetail.id}?page=3`);
    await screen.findByText('Harness signals');

    const lengthBefore = history.length;

    await user.click(screen.getByRole('combobox', { name: 'Event filter' }));
    await user.click(await screen.findByRole('option', { name: 'All events' }));

    await waitFor(() => {
      expect(router.state.location.search.filter).toBe('all');
    });
    // Give any second, un-batched navigate() a chance to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(router.state.location.search.page).toBe(1);
    expect(history.length).toBe(lengthBefore + 1);
  });

  it('Refresh re-fetches every view', async () => {
    const requests = captureProfileRequests();
    renderAt(`/sessions/${mockSessionDetail.id}`);
    await screen.findByText('Harness signals');

    const countBefore = requests.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      const newViews = new Set(
        requests.slice(countBefore).map((url) => url.searchParams.get('view')),
      );
      expect(newViews).toEqual(new Set(['spawns', 'signals', 'timeline', 'merged']));
    });
  });

  it('opening a node from the agent graph navigates with search reset', async () => {
    const { router } = renderAt(`/sessions/${mockSessionDetail.id}?field=cachedInput&page=2`);
    const rowButton = await screen.findByRole('button', { name: 'Open profile for worker' });
    fireEvent.click(rowButton);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/sessions/${mockChildSummary.id}`);
    });
    expect(router.state.location.search).toEqual({ field: 'output', filter: 'signals', page: 1 });
  });

  it('shows "Session not found." for a 404 response, panels not mounted', async () => {
    server.use(
      http.get('/sessions/:id', () =>
        HttpResponse.json({ error: 'session not found' }, { status: 404 }),
      ),
    );

    renderAt('/sessions/does-not-exist');

    expect(await screen.findByText('Session not found.')).toBeInTheDocument();
    expect(screen.queryByText('Harness signals')).not.toBeInTheDocument();
  });

  it('round-trips a session id containing a literal slash', async () => {
    server.use(
      http.get('/sessions/:id', ({ params }) => {
        if (params.id !== SLASH_ID) {
          return HttpResponse.json({ error: 'session not found' }, { status: 404 });
        }
        return HttpResponse.json({ session: slashSessionDetail });
      }),
    );

    const { router } = renderAt(`/sessions/${encodeURIComponent(SLASH_ID)}`);

    expect(await screen.findByRole('heading', { name: 'Slash Agent' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/sessions/${encodeURIComponent(SLASH_ID)}`);
  });
});
