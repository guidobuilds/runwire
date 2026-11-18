import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockImportReport, mockSessionSummary } from '@/mocks/handlers';
import { server } from '@/mocks/node';
import { routeTree } from '@/routeTree.gen';

function renderApp(path = '/sessions') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, history };
}

function gatedScan() {
  let calls = 0;
  let release: (() => void) | undefined;
  server.use(
    http.post('/api/scan', async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return HttpResponse.json(mockImportReport);
    }),
  );
  return {
    calls: () => calls,
    release: () => release?.(),
    started: () => release !== undefined,
  };
}

describe('sidebar Scan action', () => {
  it('opens a confirmation overlay and only scans after confirming', async () => {
    const user = userEvent.setup();
    const scan = gatedScan();
    renderApp();
    await screen.findByText(mockSessionSummary.name);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Scan' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Scan for sessions')).toBeInTheDocument();
    expect(scan.calls()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Run scan' }));
    await waitFor(() => expect(scan.started()).toBe(true));
    expect(scan.calls()).toBe(1);

    scan.release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a loading status while the scan runs and navigates to /sessions when done', async () => {
    const user = userEvent.setup();
    const scan = gatedScan();
    const { router } = renderApp('/sessions/sess-1');

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    await user.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Scanning…');
    expect(router.state.location.pathname).toBe('/sessions/sess-1');

    scan.release();

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancelling closes the overlay without scanning', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.post('/api/scan', () => {
        calls += 1;
        return HttpResponse.json(mockImportReport);
      }),
    );
    renderApp();
    await screen.findByText(mockSessionSummary.name);

    await user.click(screen.getByRole('button', { name: 'Scan' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it('shows an error and stays on the page when the scan fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/scan', () => HttpResponse.json({ error: 'internal error' }, { status: 500 })),
    );
    const { router } = renderApp('/sessions/sess-1');

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    await user.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Scan failed');
    expect(router.state.location.pathname).toBe('/sessions/sess-1');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the dialog open when the server rejects a scan report as failed', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/scan', () =>
        HttpResponse.json(
          {
            error: 'one or more imports failed',
            report: {
              perAdapter: {
                'claude-code': { discovered: 2, imported: 1, skipped: 0, removed: 0, failed: 1 },
              },
              durationMs: 3,
            },
          },
          { status: 500 },
        ),
      ),
    );
    const { router } = renderApp('/sessions/sess-1');

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    await user.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('one or more imports failed');
    expect(router.state.location.pathname).toBe('/sessions/sess-1');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
