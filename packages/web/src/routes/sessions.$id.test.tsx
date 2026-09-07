import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockChildSummary, mockSessionDetail } from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { routeTree } from '@/routeTree.gen';

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('/sessions/$id route (session detail)', () => {
  it('renders real session detail content, including a child link, from useSession()', async () => {
    renderAt(`/sessions/${mockSessionDetail.id}`);

    expect(
      await screen.findByRole('heading', { name: mockSessionDetail.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(/tool calls \(inclusive\)/i)).toBeInTheDocument();
    expect(screen.getByText(String(mockSessionDetail.toolCallsInclusive))).toBeInTheDocument();

    // A child link is present (mockSessionDetail.children = [mockChildSummary]).
    const childLink = screen.getByRole('link', { name: mockChildSummary.name });
    expect(childLink).toBeInTheDocument();
    expect(childLink).toHaveAttribute('href', `/sessions/${mockChildSummary.id}`);
  });

  it('shows a "Session not found" message for a 404 response', async () => {
    server.use(
      http.get('/sessions/:id', () =>
        HttpResponse.json({ error: 'session not found' }, { status: 404 }),
      ),
    );

    renderAt('/sessions/does-not-exist');

    expect(await screen.findByText(/session not found/i)).toBeInTheDocument();
  });

  it('highlights the Sessions nav item as active (shared chrome from __root.tsx)', async () => {
    renderAt(`/sessions/${mockSessionDetail.id}`);
    await screen.findByRole('heading', { name: mockSessionDetail.name });

    const sessionsLink = screen.getByRole('link', { name: 'Sessions' });
    expect(sessionsLink).toHaveAttribute('data-active');
  });

  it('has no Quick Create/mail/Search/user-account chrome (shared chrome from __root.tsx)', async () => {
    renderAt(`/sessions/${mockSessionDetail.id}`);
    await screen.findByRole('heading', { name: mockSessionDetail.name });

    expect(screen.queryByText('Quick Create')).not.toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Search')).not.toBeInTheDocument();
    expect(screen.queryByText('user@scout.local')).not.toBeInTheDocument();
  });
});
