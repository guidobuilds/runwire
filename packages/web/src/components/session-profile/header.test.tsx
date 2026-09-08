import type { ApiSessionDetail, ApiSessionSummary, ApiTokenTotals } from '@scout/core';
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
import { describe, expect, it } from 'vitest';
import { Header } from './header';

/** Header renders parent/child links via the typed router `Link` (to
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
  return render(<RouterProvider router={router} />);
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
  project: { key: 'scout', name: 'Scout' },
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

describe('Header — parent/child links', () => {
  it('links the parent into the session profile route', async () => {
    const parentSummary: ApiSessionSummary = { ...baseSummary, id: 'root-0', name: 'Root parent' };
    await renderHeader(detail({ parent: parentSummary }));
    const link = screen.getByRole('link', { name: 'Root parent' });
    expect(link).toHaveAttribute('href', '/sessions/root-0');
  });

  it('links each child into the session profile route, percent-encoding slashes in the id', async () => {
    await renderHeader(detail({ children: [childSummary] }));
    const link = screen.getByRole('link', { name: childSummary.name });
    expect(link).toHaveAttribute('href', `/sessions/${encodeURIComponent(childSummary.id)}`);
    expect(link.getAttribute('href')).not.toContain('root-1/child-a');
  });
});
