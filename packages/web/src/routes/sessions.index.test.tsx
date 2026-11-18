import type { PagedSessions } from '@runwire/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS } from '@/lib/sessions-table';
import {
  mockHarnessOptions,
  mockPagedSessionsMulti,
  mockSessionSummary,
  mockSessionSummary2,
  mockSessionsStats,
  mockSessionsStatsMulti,
} from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { routeTree } from '@/routeTree.gen';

beforeEach(() => {
  server.use(http.get('/api/harnesses', () => HttpResponse.json(mockHarnessOptions)));
});

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({ routeTree });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router };
}

function toolbarMenuTrigger(name: RegExp): HTMLElement {
  const trigger = screen
    .getAllByRole('button', { name })
    .find((button) => button.getAttribute('aria-haspopup') === 'menu');
  if (!trigger) throw new Error(`No toolbar menu trigger matching ${name}`);
  return trigger;
}

describe('/sessions route (sessions dashboard)', () => {
  it('renders real session content and full-set totals from useSessionsStats()', async () => {
    server.use(
      http.get('/api/sessions', () => HttpResponse.json(mockPagedSessionsMulti)),
      http.get('/api/sessions/stats', () => HttpResponse.json(mockSessionsStatsMulti)),
    );

    renderDashboard();

    expect(await screen.findByText(mockSessionSummary2.name)).toBeInTheDocument();

    const totalSessionsLabel = await screen.findByText('Total Sessions');
    const card = totalSessionsLabel.closest('[data-slot="card"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(
      within(card as HTMLElement).getByText(String(mockSessionsStatsMulti.totalSessions)),
    ).toBeInTheDocument();

    const totalCostLabel = await screen.findByText('Total Cost');
    const totalCostCard = totalCostLabel.closest('[data-slot="card"]') as HTMLElement | null;
    expect(totalCostCard).not.toBeNull();
    expect(within(totalCostCard as HTMLElement).getByText('$0.60')).toBeInTheDocument();

    const totalTokensLabel = await screen.findByText('Total Tokens');
    const totalTokensCard = totalTokensLabel.closest('[data-slot="card"]') as HTMLElement | null;
    expect(totalTokensCard).not.toBeNull();
    expect(within(totalTokensCard as HTMLElement).getByText('4.9K')).toBeInTheDocument();

    const avgDurationLabel = await screen.findByText('Avg Duration');
    const avgDurationCard = avgDurationLabel.closest('[data-slot="card"]') as HTMLElement | null;
    expect(avgDurationCard).not.toBeNull();
    expect(within(avgDurationCard as HTMLElement).getByText('22m 30s')).toBeInTheDocument();
  });

  it('renders the Direct and Full tree subagent count columns from the DTO', async () => {
    server.use(
      http.get('/api/sessions', () => HttpResponse.json(mockPagedSessionsMulti)),
      http.get('/api/sessions/stats', () => HttpResponse.json(mockSessionsStatsMulti)),
    );

    renderDashboard();

    await screen.findByText(mockSessionSummary2.name);
    expect(screen.getByRole('columnheader', { name: 'Direct' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Full tree' })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
  });

  it('shows a loading state before sessions resolve', async () => {
    server.use(
      http.get('/api/sessions', async () => {
        await delay('infinite');
        return HttpResponse.json(mockPagedSessionsMulti);
      }),
    );

    renderDashboard();
    expect(await screen.findByText(/loading sessions/i)).toBeInTheDocument();
  });

  it('shows an error state when the sessions request fails', async () => {
    server.use(
      http.get('/api/sessions', () =>
        HttpResponse.json({ error: 'internal error' }, { status: 500 }),
      ),
    );

    renderDashboard();

    expect(await screen.findByText(/failed to load sessions/i)).toBeInTheDocument();
  });
});

describe('shared sidebar chrome (f6)', () => {
  it('highlights the active Sessions nav item and shows inert Projects/Harnesses entries', async () => {
    server.use(http.get('/api/sessions', () => HttpResponse.json(mockPagedSessionsMulti)));

    renderDashboard();
    await screen.findByText(mockSessionSummary2.name);

    const sessionsLink = screen.getByRole('link', { name: 'Sessions' });
    expect(sessionsLink).toHaveAttribute('data-active');
    expect(sessionsLink).toHaveAttribute('href', '/sessions');

    const projectsButton = screen.getByRole('button', { name: 'Projects' });
    expect(projectsButton).toBeDisabled();
    const harnessesButton = screen.getByRole('button', { name: 'Harnesses' });
    expect(harnessesButton).toBeDisabled();
  });

  it('has no Quick Create, mail, Search, or user-account chrome', async () => {
    server.use(http.get('/api/sessions', () => HttpResponse.json(mockPagedSessionsMulti)));

    renderDashboard();
    await screen.findByText(mockSessionSummary2.name);

    expect(screen.queryByText('Quick Create')).not.toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Search')).not.toBeInTheDocument();
    expect(screen.queryByText('user@runwire.local')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ellipsis/i })).not.toBeInTheDocument();
  });
});

describe('/sessions table state (URL-free)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces typing into exactly one request and leaves the URL unchanged', async () => {
    vi.useFakeTimers();
    let sessionsRequests = 0;
    server.use(
      http.get('/api/sessions', () => {
        sessionsRequests += 1;
        return HttpResponse.json(mockPagedSessionsMulti);
      }),
    );

    const { router } = renderDashboard();
    await vi.waitFor(() => expect(sessionsRequests).toBe(1));

    const input = screen.getByLabelText('Search sessions');
    act(() => {
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.change(input, { target: { value: 'au' } });
      fireEvent.change(input, { target: { value: 'aut' } });
      fireEvent.change(input, { target: { value: 'auth' } });
    });

    expect(sessionsRequests).toBe(1);

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    await vi.waitFor(() => expect(sessionsRequests).toBe(2));
    expect(sessionsRequests).toBe(2);

    expect(router.state.location.pathname).toBe('/sessions');
    expect(router.state.location.search).toEqual({});
  });

  it('applies a duration preset immediately with exactly one extra request', async () => {
    const user = userEvent.setup();
    let sessionsRequests = 0;
    server.use(
      http.get('/api/sessions', () => {
        sessionsRequests += 1;
        return HttpResponse.json(mockPagedSessionsMulti);
      }),
    );

    renderDashboard();
    await screen.findByText(mockSessionSummary2.name);
    expect(sessionsRequests).toBe(1);

    await user.click(toolbarMenuTrigger(/Duration/));
    await user.click(await screen.findByRole('menuitemradio', { name: '≥ 30m' }));

    await waitFor(() => expect(sessionsRequests).toBe(2));
    expect(sessionsRequests).toBe(2);
  });

  it('issues exactly one offset=0 request when a filter changes from page 2', async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const bigPage: PagedSessions = {
      items: Array.from({ length: 10 }, (_, index) => ({
        ...mockSessionSummary,
        id: `sess-${index}`,
        name: `Session ${index}`,
        title: `Session ${index}`,
      })),
      total: 50,
      limit: 10,
      offset: 0,
    };
    server.use(
      http.get('/api/sessions', ({ request }) => {
        requests.push(new URL(request.url).search);
        return HttpResponse.json(bigPage);
      }),
    );

    renderDashboard();
    await screen.findByText('Session 0');

    await user.click(screen.getByRole('button', { name: /go to next page/i }));
    await waitFor(() => expect(requests.length).toBe(2));
    expect(requests[1]).toContain('offset=10');

    const before = requests.length;
    await user.click(toolbarMenuTrigger(/Duration/));
    await user.click(await screen.findByRole('menuitemradio', { name: '≥ 30m' }));

    await waitFor(() => expect(requests.length).toBeGreaterThan(before));
    const after = requests.slice(before);
    expect(after, `extra fetches: ${JSON.stringify(after)}`).toHaveLength(1);
    expect(after[0]).toContain('offset=0');
    expect(after[0]).toContain('durationMin=30');
  });

  it('keeps the previous rows visible while a filtered response is in flight', async () => {
    const filtered: PagedSessions = {
      items: [
        {
          ...mockSessionSummary,
          id: 'sess-auth',
          name: 'Auth refactor result',
          title: 'Auth refactor result',
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    };
    server.use(
      http.get('/api/sessions', async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        if (q) {
          await delay(400);
          return HttpResponse.json(filtered);
        }
        return HttpResponse.json(mockPagedSessionsMulti);
      }),
    );

    renderDashboard();
    await screen.findByText(mockSessionSummary2.name);

    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'auth' } });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
    });

    expect(screen.getByText(mockSessionSummary2.name)).toBeInTheDocument();
    expect(screen.queryByText(/loading sessions/i)).not.toBeInTheDocument();

    expect(await screen.findByText('Auth refactor result')).toBeInTheDocument();
  });

  it('does not change the URL when a sortable header is clicked', async () => {
    server.use(http.get('/api/sessions', () => HttpResponse.json(mockPagedSessionsMulti)));

    const { router } = renderDashboard();
    await screen.findByText(mockSessionSummary2.name);
    const hrefBefore = router.state.location.href;

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions'));
    expect(router.state.location.href).toBe(hrefBefore);
    expect(router.state.location.search).toEqual({});
  });
});

describe('/sessions cards+chart stats wiring', () => {
  it('renders full-set stats and does not refetch them on a page change', async () => {
    const user = userEvent.setup();
    let sessionsRequests = 0;
    const statsSearches: string[] = [];
    const bigPage: PagedSessions = {
      items: Array.from({ length: 10 }, (_, index) => ({
        ...mockSessionSummary,
        id: `sess-${index}`,
        name: `Session ${index}`,
        title: `Session ${index}`,
      })),
      total: 50,
      limit: 10,
      offset: 0,
    };
    server.use(
      http.get('/api/sessions', () => {
        sessionsRequests += 1;
        return HttpResponse.json(bigPage);
      }),
      http.get('/api/sessions/stats', ({ request }) => {
        statsSearches.push(new URL(request.url).search);
        return HttpResponse.json({ ...mockSessionsStatsMulti, totalSessions: 50 });
      }),
    );

    renderDashboard();
    await screen.findByText('Session 0');

    const label = await screen.findByText('Total Sessions');
    const card = label.closest('[data-slot="card"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('50')).toBeInTheDocument();

    expect(statsSearches).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /go to next page/i }));
    await waitFor(() => expect(sessionsRequests).toBe(2));
    expect(statsSearches).toHaveLength(1);
  });

  it('refetches stats when a committed filter changes', async () => {
    const user = userEvent.setup();
    const statsSearches: string[] = [];
    server.use(
      http.get('/api/sessions', () => HttpResponse.json(mockPagedSessionsMulti)),
      http.get('/api/sessions/stats', ({ request }) => {
        const search = new URL(request.url).search;
        statsSearches.push(search);
        return HttpResponse.json(
          new URL(request.url).searchParams.get('durationMin')
            ? { ...mockSessionsStats, totalSessions: 1 }
            : mockSessionsStatsMulti,
        );
      }),
    );

    renderDashboard();
    await screen.findByText(mockSessionSummary2.name);
    expect(statsSearches).toHaveLength(1);

    await user.click(toolbarMenuTrigger(/Duration/));
    await user.click(await screen.findByRole('menuitemradio', { name: '≥ 30m' }));

    await waitFor(() => expect(statsSearches.length).toBeGreaterThan(1));
    expect(statsSearches.at(-1)).toContain('durationMin=30');

    await waitFor(() => {
      const label = screen.getByText('Total Sessions');
      const card = label.closest('[data-slot="card"]') as HTMLElement;
      expect(within(card).getByText('1')).toBeInTheDocument();
    });
  });
});
