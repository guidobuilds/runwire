import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockPagedSessions, mockSessionSummary } from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { routeTree } from '@/routeTree.gen';

describe('index route (/ -> /sessions redirect)', () => {
  it('redirects to /sessions and renders the dashboard there', async () => {
    server.use(http.get('/api/sessions', () => HttpResponse.json(mockPagedSessions)));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await screen.findByText(mockSessionSummary.name);
    expect(router.state.location.pathname).toBe('/sessions');
  });
});
