import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { makeRollup, makeSummary, metric } from './fixtures';
import { SessionDetail } from './SessionDetail';

const shared = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  caps: [
    'usage.perCall',
    'usage.cumulative',
    'usage.cacheWrite',
    'usage.reasoning',
    'timing',
    'model',
    'mode',
    'effort',
    'version',
    'turns',
    'toolCalls',
    'compactions',
    'subagents',
    'cost',
    'title',
    'git',
  ] as string[],
}));

vi.mock('../../api/queries', () => ({
  useSession: () => shared.result,
  useAdapterCapabilities: () => shared.caps,
  useAdapterDisplayName: () => 'Fake Harness',
}));

async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });
  const projectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects',
    component: () => null,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$key',
    component: () => null,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions/$id',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, projectsRoute, projectRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  // biome-ignore lint/suspicious/noExplicitAny: the test tree is not the registered app tree.
  return render(<RouterProvider router={router as any} />);
}

const ROOT = makeSummary({
  id: 'fake:root',
  title: { value: 'Rebuild the rollup', contentDerived: true },
  harnessVersion: { first: '1.2.3', last: '1.2.4' },
  git: { branch: 'main', commit: 'a1b2c3d4e5f6', repoName: 'scout' },
  timing: { startedAt: metric('2026-08-31T09:00:00.000Z'), durationMs: metric(3_600_000) },
  model: { primary: metric('sonnet-4'), all: ['sonnet-4'], changes: 0 },
  cost: metric({ usd: 1.5 }),
  usage: { output: metric(4000) },
  counts: { turns: metric(7) },
  children: ['fake:child'],
});

const CHILD = makeSummary({
  id: 'fake:child',
  parentId: 'fake:root',
  depth: 1,
  relation: 'subagent',
  agentType: 'Explore',
});

const LOADED = {
  isPending: false,
  error: null,
  refetch: () => undefined,
  data: {
    summary: ROOT,
    rollup: makeRollup({
      id: 'fake:root',
      exclusive: { usage: ROOT.usage, counts: ROOT.counts },
      inclusive: { usage: { output: metric(9000) }, counts: { subagents: metric(1) } },
      descendants: 1,
    }),
    subtree: {
      summaries: [ROOT, CHILD],
      rollups: {
        'fake:root': makeRollup({ id: 'fake:root', descendants: 1 }),
        'fake:child': makeRollup({ id: 'fake:child' }),
      },
    },
    diagnostics: [
      {
        level: 'warn',
        code: 'usage-total-mismatch',
        message: 'reported total disagrees with the sum of its parts',
        harness: 'fake',
        path: '/w/app/a.jsonl',
        line: 12,
        count: 3,
      },
    ],
  },
};

describe('SessionDetail', () => {
  beforeEach(() => {
    shared.result = { ...LOADED };
  });

  afterEach(() => {
    cleanup();
  });

  test('renders every section of the detail view', async () => {
    await renderInRouter(<SessionDetail id="fake:root" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Rebuild the rollup');
    for (const heading of ['Token breakdown', 'Counts', 'Agents', 'Diagnostics']) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).not.toBeNull();
    }
    expect(screen.getByText('$1.50')).not.toBeNull();
    expect(screen.getByText('1 h 00 min')).not.toBeNull();
    expect(screen.getByText('Explore')).not.toBeNull();
    expect(screen.getByText('reported total disagrees with the sum of its parts')).not.toBeNull();
    expect(screen.getByText('/w/app/a.jsonl:12')).not.toBeNull();
    const diagnosticRow = screen.getByText('usage-total-mismatch').closest('tr');
    expect(diagnosticRow).not.toBeNull();
    expect(diagnosticRow?.textContent).toContain('warn');
    expect(diagnosticRow?.textContent).toContain('3');
  });

  test('no section renders a stringified object or raw JSON', async () => {
    const view = await renderInRouter(<SessionDetail id="fake:root" />);
    expect(view.container.textContent ?? '').not.toContain('[object ');
    expect(view.container.innerHTML).not.toContain('[object ');
    expect(view.container.textContent ?? '').not.toContain('{"');
    expect(view.container.innerHTML).not.toMatch(/\{(&quot;|")/u);
  });

  test('an unknown id renders a not-found state with a way back to projects', async () => {
    shared.result = {
      isPending: false,
      error: new ApiError(404, 'session not found'),
      refetch: () => undefined,
      data: undefined,
    };
    await renderInRouter(<SessionDetail id="fake:missing" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Session not found');
    expect(screen.getByText(/fake:missing/u)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Back to projects' })).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Diagnostics' })).toBeNull();
  });

  test('a transport failure keeps the retry affordance instead of claiming not-found', async () => {
    shared.result = {
      isPending: false,
      error: new Error('connection refused'),
      refetch: () => undefined,
      data: undefined,
    };
    await renderInRouter(<SessionDetail id="fake:root" />);
    expect(screen.getByText('connection refused')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    expect(screen.queryByText('Session not found')).toBeNull();
  });
});
