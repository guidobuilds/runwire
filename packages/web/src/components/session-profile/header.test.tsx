import type { ApiSessionDetail, ApiSessionSummary, ApiTokenTotals } from '@runwire/core';
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
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/node';
import { mockProfileContextTree, mockProfileModelsTree } from '@/mocks/session-profile';
import { Header } from './header';

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Header renders the parent link via the typed router `Link` (to
 * `/sessions/$id`), which needs a real router context to resolve a href.
 * A minimal self-contained tree — just enough for `Link`'s path-template
 * resolution to work — avoids depending on the real app's route tree/data
 * layer for what is otherwise a pure props-component test. */
async function renderHeader(session: ApiSessionDetail) {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    component: () => <Header session={session} />,
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions/$id',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([indexRoute, profileRoute]),
  });
  // The router resolves its initial match asynchronously even with memory
  // history; awaiting `load()` before rendering avoids every call site
  // needing a `findBy*` just to observe Header's own synchronous output.
  await router.load();
  return render(
    <QueryClientProvider client={queryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function tokens(output: number): ApiTokenTotals {
  return { uncachedInput: 100, cachedInput: 20, cacheWrite: 5, output, reasoningOutput: 10 };
}

const baseSummary: ApiSessionSummary = {
  id: 'root-1',
  name: 'Refactor auth module',
  title: 'Refactor auth module',
  parentId: null,
  harness: { id: 'claude-code', displayName: 'Claude Code', adapterVersion: '1.0.0' },
  project: { key: 'runwire', name: 'Runwire' },
  depth: 0,
  relation: null,
  agentType: null,
  startedAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-01T10:30:00.000Z',
  durationMs: 1_800_000,
  modelPrimary: 'claude-sonnet-5',
  modelsOwn: ['claude-sonnet-5'],
  modelsDescendants: [],
  tokensOwn: tokens(500),
  tokensInclusive: tokens(500),
  turnsOwn: 12,
  apiCallsOwn: 12,
  apiCallsInclusive: 12,
  toolCallsOwn: 5,
  toolCallsInclusive: 5,
  compactionsOwn: 0,
  compactionsInclusive: 0,
  costUsd: 0.42,
  childCount: 0,
  descendantCount: 0,
};

const childSummary: ApiSessionSummary = {
  ...baseSummary,
  id: 'root-1/child-a',
  name: 'Subagent: write tests',
  title: 'Subagent: write tests',
  parentId: 'root-1',
  depth: 1,
  relation: 'subagent',
  childCount: 0,
  descendantCount: 0,
};

function detail(overrides: Partial<ApiSessionDetail> = {}): ApiSessionDetail {
  return { ...baseSummary, parent: null, children: [], ...overrides };
}

describe('Header — privacy rule', () => {
  it('shows the title only when present and distinct from the name', async () => {
    await renderHeader(detail({ title: 'Distinct title' }));
    expect(screen.getByText('Distinct title')).toBeInTheDocument();
  });

  it('hides the title when it equals the name', async () => {
    await renderHeader(detail({ title: baseSummary.name }));
    expect(
      screen.queryByText(baseSummary.name, { selector: 'p, [data-slot=card-description]' }),
    ).not.toBeInTheDocument();
    // The name itself still renders exactly once, as the heading.
    expect(screen.getAllByText(baseSummary.name)).toHaveLength(1);
  });

  it('hides the title when it is null', async () => {
    await renderHeader(detail({ title: null }));
    expect(screen.getAllByText(baseSummary.name)).toHaveLength(1);
  });
});

describe('Header — project field', () => {
  it('shows the project name on the line and keeps the key as a hover hint', async () => {
    await renderHeader(detail({ project: { key: 'github.com/acme/widgets', name: 'widgets' } }));
    expect(screen.getByText('widgets')).toBeInTheDocument();
    // The key is not rendered inline next to the name.
    expect(screen.queryByText(/github\.com\/acme\/widgets/)).not.toBeInTheDocument();
    // It is wired to the tooltip trigger for hover.
    expect(screen.getByText('widgets').closest('[data-slot="tooltip-trigger"]')).not.toBeNull();
  });

  it('reveals the key in a tooltip on hover', async () => {
    await renderHeader(detail({ project: { key: 'github.com/acme/widgets', name: 'widgets' } }));
    await userEvent.hover(screen.getByText('widgets'));
    await waitFor(() => {
      expect(screen.getByText('github.com/acme/widgets')).toBeInTheDocument();
    });
  });

  it('renders "no project" plainly when there is none', async () => {
    await renderHeader(detail({ project: null }));
    expect(screen.getByText('no project')).toBeInTheDocument();
    expect(screen.getByText('no project').closest('[data-slot="tooltip-trigger"]')).toBeNull();
  });
});

describe('Header — harness identity', () => {
  it('renders only the SVG icon and reveals the harness identity on hover', async () => {
    const { container } = await renderHeader(detail());

    expect(container.querySelector('img[data-harness-icon="claude-code"]')).not.toBeNull();
    expect(screen.queryByText('Claude Code (claude-code)')).not.toBeInTheDocument();

    await userEvent.hover(screen.getByLabelText('Claude Code (claude-code)'));
    await waitFor(() => {
      expect(screen.getByText('Claude Code (claude-code)')).toBeInTheDocument();
    });
  });
});

describe('Header — token field stacking rule', () => {
  it('renders a single figure per field when there are no children', async () => {
    await renderHeader(detail({ children: [] }));
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.queryByText(/own /)).not.toBeInTheDocument();
  });

  it('stacks inclusive on top and own below when children exist', async () => {
    await renderHeader(
      detail({
        children: [childSummary],
        tokensOwn: tokens(300),
        tokensInclusive: tokens(900),
      }),
    );
    expect(screen.getAllByText(/own /).length).toBeGreaterThan(0);
  });
});

describe('Header — no tool-call/turn/API-call fields (G9)', () => {
  it('does not render tool-call, turn, or API-call counts', async () => {
    await renderHeader(detail());
    expect(screen.queryByText(/tool call/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/turn/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/api call/i)).not.toBeInTheDocument();
  });
});

describe('Header — session navigation', () => {
  it('links the parent into the session profile route', async () => {
    const parentSummary: ApiSessionSummary = { ...baseSummary, id: 'root-0', name: 'Root parent' };
    await renderHeader(detail({ parent: parentSummary }));
    const link = screen.getByRole('link', { name: 'Root parent' });
    expect(link).toHaveAttribute('href', '/sessions/root-0');
  });

  it('does not show child sessions in the header', async () => {
    await renderHeader(detail({ children: [childSummary] }));
    expect(screen.queryByText('Child sessions')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: childSummary.name })).not.toBeInTheDocument();
  });
});

describe('Header — model usage block', () => {
  /** No parent link is rendered here, so the typed router is not needed. */
  function renderDirect(refresh: number, client = queryClient()) {
    return {
      client,
      ...render(
        <QueryClientProvider client={client}>
          <Header refresh={refresh} session={detail()} />
        </QueryClientProvider>,
      ),
    };
  }

  it('mounts the model usage block below the token stats row', async () => {
    renderDirect(0);

    await screen.findByText('Models in this session');
    expect(screen.getByText('Models in subagent sessions')).toBeInTheDocument();

    const text = document.body.textContent ?? '';
    const tokenStatsIndex = text.indexOf('Output');
    const modelUsageIndex = text.indexOf('Models in this session');
    expect(tokenStatsIndex).toBeGreaterThanOrEqual(0);
    expect(modelUsageIndex).toBeGreaterThan(tokenStatsIndex);
  });

  it('threads the refresh prop into the model usage query', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/models', () => {
        calls += 1;
        return HttpResponse.json(mockProfileModelsTree);
      }),
    );

    const client = queryClient();
    const { rerender } = renderDirect(0, client);
    await waitFor(() => expect(calls).toBe(1));

    rerender(
      <QueryClientProvider client={client}>
        <Header refresh={1} session={detail()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls).toBe(2));
  });
});

describe('Header — context pressure block', () => {
  function renderDirect(refresh = 0, client = queryClient()) {
    return {
      client,
      ...render(
        <QueryClientProvider client={client}>
          <Header refresh={refresh} session={detail()} />
        </QueryClientProvider>,
      ),
    };
  }

  it('renders the Context pressure block with tree primary and own secondary', async () => {
    renderDirect(0);
    await screen.findByText('Context pressure');
    // Fixture tree observed-calls is 9; own is 4.
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('own 4')).toBeInTheDocument();
  });

  it('places context pressure after the token stack and before the model charts', async () => {
    renderDirect(0);
    await screen.findByText('Context pressure');
    const text = document.body.textContent ?? '';
    const tokenStatsIndex = text.indexOf('Output');
    const contextIndex = text.indexOf('Context pressure');
    const modelUsageIndex = text.indexOf('Models in this session');
    expect(tokenStatsIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeGreaterThan(tokenStatsIndex);
    expect(modelUsageIndex).toBeGreaterThan(contextIndex);
  });

  it('shows only the tree figure when there are no descendants', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/context', () =>
        HttpResponse.json({ ...mockProfileContextTree, descendants: [] }),
      ),
    );
    renderDirect(0);
    await screen.findByText('Context pressure');
    expect(screen.queryByText(/own /)).not.toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('renders em dashes when every metric is null', async () => {
    const nullMetrics = {
      observedCalls: 0,
      promptInput: null,
      avgPromptInput: null,
      p95PromptInput: null,
      peakPromptInput: null,
      cacheReadShare: null,
    };
    server.use(
      http.get('/api/sessions/:id/profile/context', () =>
        HttpResponse.json({
          ...mockProfileContextTree,
          own: nullMetrics,
          tree: nullMetrics,
          descendants: [],
        }),
      ),
    );
    renderDirect(0);
    await screen.findByText('Context pressure');
    // 4 nullable fields render an em dash; observed calls is a real 0.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('isolates an error with a Retry button that refetches', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/context', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ error: 'boom' }, { status: 500 })
          : HttpResponse.json(mockProfileContextTree);
      }),
    );
    renderDirect(0);
    await screen.findByText('Context metrics unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Context pressure');
    expect(calls).toBe(2);
  });

  it('threads the refresh prop into the context query', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/context', () => {
        calls += 1;
        return HttpResponse.json(mockProfileContextTree);
      }),
    );
    const client = queryClient();
    const { rerender } = renderDirect(0, client);
    await waitFor(() => expect(calls).toBe(1));
    rerender(
      <QueryClientProvider client={client}>
        <Header refresh={1} session={detail()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls).toBe(2));
  });
});
