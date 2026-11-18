import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/node';
import {
  mockProfileContextTree,
  PROFILE_CHILD_ID,
  PROFILE_GRANDCHILD_ID,
  PROFILE_ROOT_ID,
} from '@/mocks/session-profile';
import { ContextTable } from './context-table';

async function renderTable(sessionId = PROFILE_ROOT_ID) {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    component: () => <ContextTable sessionId={sessionId} />,
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions/$id' });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([indexRoute, profileRoute]),
  });
  await router.load();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('ContextTable', () => {
  it('renders nothing when the session has no descendants', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/context', () => {
        calls += 1;
        return HttpResponse.json({ ...mockProfileContextTree, descendants: [] });
      }),
    );
    await renderTable();
    await waitFor(() => expect(calls).toBe(1));
    expect(screen.queryByText('Subagent context')).not.toBeInTheDocument();
  });

  it('renders every approved column in order', async () => {
    await renderTable();
    await screen.findByText('Subagent context');
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Agent',
      'Duration',
      'Model',
      'Calls',
      'Avg prompt',
      'P95 prompt',
      'Peak prompt',
      'Cache read',
      'Prompt input',
      'Cost',
    ]);
  });

  it('preserves the endpoint order and labels agentType with a short-id fallback', async () => {
    await renderTable();
    await screen.findByText('Subagent context');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Worker');
    expect(rows[1]?.textContent).toContain('grand');
  });

  it('indents rows by relative depth', async () => {
    await renderTable();
    const childLink = await screen.findByRole('link', { name: 'Worker' });
    const grandLink = screen.getByRole('link', { name: 'grand' });
    const childCell = childLink.closest('td');
    const grandCell = grandLink.closest('td');
    expect(childCell?.style.paddingLeft).toBe('8px');
    expect(grandCell?.style.paddingLeft).toBe('24px');
  });

  it('links each row to that descendant profile and encodes a slash id', async () => {
    await renderTable();
    const childLink = await screen.findByRole('link', { name: 'Worker' });
    const grandLink = screen.getByRole('link', { name: 'grand' });
    expect(childLink).toHaveAttribute('href', `/sessions/${PROFILE_CHILD_ID}`);
    expect(grandLink).toHaveAttribute(
      'href',
      `/sessions/${encodeURIComponent(PROFILE_GRANDCHILD_ID)}`,
    );
  });

  it('renders em dashes for null metadata and compact prompt metrics otherwise', async () => {
    await renderTable();
    await screen.findByText('Subagent context');
    const rows = screen.getAllByRole('row').slice(1);
    expect((rows[1]?.textContent?.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.textContent).toContain('claude-sonnet-5');
    expect(rows[0]?.textContent).toContain('$0.12');
  });
});
