import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockPagedSessionsMulti, mockSessionSummary2 } from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { routeTree } from '@/routeTree.gen';

// f6: moved from index.test.tsx (renamed alongside the dashboard's move from
// routes/index.tsx to routes/sessions.index.tsx) -- the dashboard now lives at
// /sessions, not /. index.test.tsx (new, minimal) covers the / -> /sessions
// redirect separately.
function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({ routeTree });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('/sessions route (sessions dashboard)', () => {
  it('renders real session content and computed totals from useSessions()', async () => {
    server.use(http.get('/api/sessions', () => HttpResponse.json(mockPagedSessionsMulti)));

    renderDashboard();

    // A real mocked session's name appears (from the DataTable's name column).
    expect(await screen.findByText(mockSessionSummary2.name)).toBeInTheDocument();

    // "Total Sessions" card reflects the mocked fixture's item count (2). Scoped
    // to the card itself, since the DataTable's own residual (unrelated) tab
    // badges can coincidentally also render "2".
    const totalSessionsLabel = await screen.findByText('Total Sessions');
    const card = totalSessionsLabel.closest('[data-slot="card"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(
      within(card as HTMLElement).getByText(String(mockPagedSessionsMulti.items.length)),
    ).toBeInTheDocument();

    // The other three cards' computed values, against the known fixture
    // (mockSessionSummary.costUsd = 0.42, mockSessionSummary2.costUsd = 0.18,
    // both sessions share the same tokenTotals object -- sumTokens() = 2450
    // each -- and durationMs = 1_800_000 / 900_000). A regression in any of
    // these formulas would previously ship silently green (see f4 verify
    // finding #3/#6): total_cost mutated to only the first session's value
    // still passed all tests, since nothing asserted an exact figure here.
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

  it('shows a loading state before sessions resolve', async () => {
    // Hold the request pending indefinitely so the loading state is
    // deterministic instead of racing the mocked fetch's own resolution.
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
    expect(screen.queryByText('user@scout.local')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ellipsis/i })).not.toBeInTheDocument();
  });
});
