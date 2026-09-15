import type { ApiSessionDetail } from '@runwire/core';
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

/** Captures every request to the distinct profile endpoints without
 * intercepting the response: the resolver returns `undefined`, so MSW falls
 * through to the real composed handlers, exercising the shipped views. */
function captureProfileRequests(): URL[] {
  const requests: URL[] = [];
  for (const endpoint of ['spawns', 'signals', 'timeline', 'events'] as const) {
    server.use(
      http.get(`/api/sessions/:id/profile/${endpoint}`, ({ request }) => {
        requests.push(new URL(request.url));
        return undefined;
      }),
    );
  }
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

    const timelineReq = requests.find((url) => url.pathname.endsWith('/profile/timeline'));
    expect(timelineReq?.searchParams.get('field')).toBe('output');

    const mergedReqs = requests.filter((url) => url.pathname.endsWith('/profile/events'));
    const tableReq = mergedReqs.find((url) => url.searchParams.get('limit') === '10');
    expect(tableReq?.searchParams.get('filter')).toBe('signals');
    expect(tableReq?.searchParams.get('offset')).toBe('0');
  });

  it('changing the token field leaves the URL stable and re-fetches only timeline', async () => {
    const user = userEvent.setup();
    const requests = captureProfileRequests();
    const { router } = renderAt(`/sessions/${mockSessionDetail.id}`);
    await screen.findByText('Harness signals');
    const before = router.state.location.href;
    const countBefore = requests.length;

    await user.click(screen.getByRole('combobox', { name: 'Token field' }));
    await user.click(await screen.findByRole('option', { name: 'Cached input' }));

    await waitFor(() => {
      expect(
        requests
          .slice(countBefore)
          .some(
            (url) =>
              url.pathname.endsWith('/profile/timeline') &&
              url.searchParams.get('field') === 'cachedInput',
          ),
      ).toBe(true);
    });
    expect(router.state.location.href).toBe(before);
    expect(
      requests.slice(countBefore).filter((url) => !url.pathname.endsWith('/profile/timeline')),
    ).toEqual([]);
  });

  it('paginates the events table to offset=10', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/events', ({ request }) => {
        const url = new URL(request.url);
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
      const mergedReqs = requests.filter((url) => url.pathname.endsWith('/profile/events'));
      expect(mergedReqs.some((url) => url.searchParams.get('offset') === '10')).toBe(true);
    });
  });

  it('changing the events filter leaves the URL stable and re-fetches only events', async () => {
    const user = userEvent.setup();
    const requests = captureProfileRequests();
    const { router, history } = renderAt(`/sessions/${mockSessionDetail.id}?page=3`);
    await screen.findByText('Harness signals');
    const hrefBefore = router.state.location.href;
    const lengthBefore = history.length;
    const countBefore = requests.length;

    await user.click(screen.getByRole('combobox', { name: 'Event filter' }));
    await user.click(await screen.findByRole('option', { name: 'All events' }));

    await waitFor(() => {
      expect(
        requests
          .slice(countBefore)
          .some(
            (url) =>
              url.pathname.endsWith('/profile/events') &&
              url.searchParams.get('filter') === 'all' &&
              url.searchParams.get('offset') === '0',
          ),
      ).toBe(true);
    });
    expect(router.state.location.href).toBe(hrefBefore);
    expect(history.length).toBe(lengthBefore);
    expect(
      requests.slice(countBefore).filter((url) => !url.pathname.endsWith('/profile/events')),
    ).toEqual([]);
  });

  it('Refresh re-fetches every view', async () => {
    const requests = captureProfileRequests();
    renderAt(`/sessions/${mockSessionDetail.id}`);
    await screen.findByText('Harness signals');

    const countBefore = requests.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      const newViews = new Set(
        requests.slice(countBefore).map((url) => url.pathname.split('/').at(-1)),
      );
      expect(newViews).toEqual(new Set(['spawns', 'signals', 'timeline', 'events']));
    });
  });

  it('opening a node from the agent graph navigates with search reset', async () => {
    const { router } = renderAt(`/sessions/${mockSessionDetail.id}?field=cachedInput&page=2`);
    const rowButton = await screen.findByRole('button', { name: 'Open profile for worker' });
    fireEvent.click(rowButton);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/sessions/${mockChildSummary.id}`);
    });
    expect(router.state.location.search).toEqual({});
  });

  it('shows "Session not found." for a 404 response, panels not mounted', async () => {
    server.use(
      http.get('/api/sessions/:id', () =>
        HttpResponse.json({ error: 'session not found' }, { status: 404 }),
      ),
    );

    renderAt('/sessions/does-not-exist');

    expect(await screen.findByText('Session not found.')).toBeInTheDocument();
    expect(screen.queryByText('Harness signals')).not.toBeInTheDocument();
  });

  it('round-trips a session id containing a literal slash', async () => {
    server.use(
      http.get('/api/sessions/:id', ({ params }) => {
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
