import type { ApiSessionDetail, LanesResponse } from '@runwire/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import tree3 from '@/components/agent-lanes/fixtures/tree3.json';
import { buildModel } from '@/components/agent-lanes/model';
import { mockChildSummary, mockSessionDetail } from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { mockProfileContextTree } from '@/mocks/session-profile';
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
  for (const endpoint of ['lanes', 'signals', 'timeline', 'events'] as const) {
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

afterEach(() => vi.restoreAllMocks());

describe('/sessions/$id route (session profile)', () => {
  it('composes header, agent lanes menus, token chart, events table and signals accordion in that order', async () => {
    renderAt(`/sessions/${mockSessionDetail.id}`);

    await screen.findByText('Harness signals');
    await screen.findByRole('button', { name: /Indicators/ });
    const text = document.body.textContent ?? '';
    const iHeader = text.indexOf(mockSessionDetail.name);
    const iGraph = text.indexOf('Indicators');
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
    expect(tableReq?.searchParams.get('sort')).toBe('time');
    expect(tableReq?.searchParams.get('dir')).toBe('asc');
    expect(tableReq?.searchParams.get('filter')).toBeNull();
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
          sort: url.searchParams.get('sort') ?? 'time',
          dir: url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
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

  it('changing the events kind filter leaves the URL stable and re-fetches only events', async () => {
    const user = userEvent.setup();
    const requests = captureProfileRequests();
    const { router, history } = renderAt(`/sessions/${mockSessionDetail.id}?page=3`);
    await screen.findByText('Harness signals');
    const hrefBefore = router.state.location.href;
    const lengthBefore = history.length;
    const countBefore = requests.length;

    await user.click(screen.getByRole('button', { name: 'Event kind' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Tool' }));

    await waitFor(() => {
      expect(
        requests
          .slice(countBefore)
          .some(
            (url) =>
              url.pathname.endsWith('/profile/events') &&
              url.searchParams.get('kind') === 'tool' &&
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
      expect(newViews).toEqual(new Set(['lanes', 'signals', 'timeline', 'events']));
    });
  });

  it('collapses from the label column and opens a tooltip node with search reset', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    )?.get;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.style.contain === 'inline-size'
        ? new DOMRect(0, 0, 900, 448)
        : originalRect.call(this);
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.style.contain === 'inline-size' ? 900 : (originalWidth?.call(this) ?? 0);
    });
    const user = userEvent.setup();
    const child = tree3.agents[1];
    if (!child) throw new Error('fixture needs a child');
    const ids = new Map([
      ['main', mockSessionDetail.id],
      [child.id, mockChildSummary.id],
    ]);
    server.use(
      http.get('/api/sessions/:id/profile/lanes', () =>
        HttpResponse.json({
          ...tree3,
          sessionId: mockSessionDetail.id,
          agents: tree3.agents.map((agent) => ({
            ...agent,
            id: ids.get(agent.id) ?? agent.id,
            parentId: agent.parentId === null ? null : (ids.get(agent.parentId) ?? agent.parentId),
          })),
        }),
      ),
    );
    const { router } = renderAt(`/sessions/${mockSessionDetail.id}?field=cachedInput&page=2`);
    const canvas = await screen.findByLabelText(/Agent lanes:.*calls/);
    await user.click(screen.getByRole('button', { name: 'Collapse main' }));
    expect(screen.getByRole('button', { name: 'Expand main' })).toHaveTextContent(
      `+${tree3.agents.length - 1} hidden`,
    );
    await user.click(screen.getByRole('button', { name: 'Expand main' }));
    const model = buildModel(tree3 as LanesResponse);
    const first = model.byId.get(child.id)?.cols[0];
    if (!first) throw new Error('fixture needs a child call');
    const move = new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 168 + ((first.index + 0.5) / model.callCount) * 720,
      clientY: 26 + 30 + 15,
    });
    fireEvent(canvas, move);
    const tooltip = await screen.findByRole('tooltip');
    await user.click(within(tooltip).getByRole('button', { name: 'Open' }));

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

  it('mounts the subagent context table after agent lanes and before the token chart', async () => {
    renderAt(`/sessions/${mockSessionDetail.id}`);

    await screen.findByText('Harness signals');
    await screen.findByText('Subagent context');
    await screen.findByRole('button', { name: /Indicators/ });

    const text = document.body.textContent ?? '';
    const iGraph = text.indexOf('Indicators');
    const iContext = text.indexOf('Subagent context');
    const iChart = text.indexOf('Token usage');
    expect(iGraph).toBeGreaterThanOrEqual(0);
    expect(iContext).toBeGreaterThan(iGraph);
    expect(iChart).toBeGreaterThan(iContext);
  });

  it('omits the context table when the subtree has no descendants', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/context', () => {
        calls += 1;
        return HttpResponse.json({ ...mockProfileContextTree, descendants: [] });
      }),
    );

    renderAt(`/sessions/${mockSessionDetail.id}`);
    await screen.findByText('Harness signals');
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    expect(screen.queryByText('Subagent context')).not.toBeInTheDocument();
  });
});
