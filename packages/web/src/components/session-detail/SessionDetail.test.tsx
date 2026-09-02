import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { SessionTrace, TraceStep } from '../../api/types';
import { makeRollup, makeSummary, metric } from './fixtures';
import { SessionDetail } from './SessionDetail';

const shared = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  traceResult: { isPending: false, error: null, data: undefined } as Record<string, unknown>,
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
  useTrace: () => shared.traceResult,
  // `SessionTimeline` (appended after Trace) composes its own
  // `useSessionTimelineData`, which fetches one `useTraces`-shaped result per
  // subtree member. No fixture here has real per-step timestamps, so every
  // id resolves to a settled-but-empty result -- consistent with
  // `shared.traceResult`'s own unset default (`resolveRootAnchor` stays
  // undefined either way, so `SessionTimeline` renders its own empty state).
  useTraces: (ids: readonly string[]) =>
    ids.map(() => ({ isPending: false, error: null, data: undefined })),
  useAdapterCapabilities: () => shared.caps,
  useAdapterDisplayName: () => 'Fake Harness',
}));

function trace(steps: TraceStep[]): SessionTrace {
  return {
    id: 'fake:root',
    steps,
    models: ['sonnet-4'],
    axis: { steps: steps.length },
    totals: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
  };
}

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
    shared.traceResult = { isPending: false, error: null, data: undefined };
  });

  afterEach(() => {
    cleanup();
  });

  test('renders every section of the detail view', async () => {
    await renderInRouter(<SessionDetail id="fake:root" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Rebuild the rollup');
    for (const heading of ['Token breakdown', 'Counts', 'Agents', 'Diagnostics', 'Trace']) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).not.toBeNull();
    }
    expect(screen.getByText('$1.50')).not.toBeNull();
    // Rendered twice: the header's own "Duration" fact, and
    // `SessionTimeline`'s `TimelineSummaryBar` (session-timeline f7-t1),
    // which reuses this same `summary.timing.durationMs` metric rather than
    // re-deriving a second duration figure.
    expect(screen.getAllByText('1 h 00 min')).toHaveLength(2);
    // Also rendered twice: `AgentTree`'s row label and `SessionTimeline`'s
    // `AgentTrack` lane label both show the same subagent's `agentType`.
    expect(screen.getAllByText('Explore').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('reported total disagrees with the sum of its parts')).not.toBeNull();
    expect(screen.getByText('/w/app/a.jsonl:12')).not.toBeNull();
    const diagnosticRow = screen.getByText('usage-total-mismatch').closest('tr');
    expect(diagnosticRow).not.toBeNull();
    expect(diagnosticRow?.textContent).toContain('warn');
    expect(diagnosticRow?.textContent).toContain('3');
  });

  test('no skill/mcp event-log element exists anywhere in the output (D38)', async () => {
    await renderInRouter(<SessionDetail id="fake:root" />);
    expect(screen.queryByRole('heading', { level: 2, name: /event.?log/iu })).toBeNull();
    expect(screen.queryByText(/skill/iu)).toBeNull();
  });

  test('a session with diagnostics shows the amber banner before any interaction', async () => {
    await renderInRouter(<SessionDetail id="fake:root" />);
    // `role="status"` also matches TokenBreakdown's big-total line; the
    // diagnostics banner is the one carrying the fixed banner text.
    const banners = screen
      .getAllByRole('status')
      .filter((el) =>
        (el.textContent ?? '').includes('This session has data-quality diagnostics.'),
      );
    expect(banners).toHaveLength(1);
  });

  test('a clean session (no diagnostics) is distinguishable from one with diagnostics by text, not color alone', async () => {
    shared.result = {
      ...LOADED,
      data: { ...LOADED.data, diagnostics: [] },
    };
    await renderInRouter(<SessionDetail id="fake:root" />);
    expect(screen.getByText('No diagnostics for this session.')).not.toBeNull();
    expect(screen.queryByText('This session has data-quality diagnostics.')).toBeNull();
  });

  test('the trace card embeds TraceRibbon and renders real trace data', async () => {
    shared.traceResult = {
      isPending: false,
      error: null,
      data: trace([
        {
          kind: 'call',
          i: 0,
          model: 'sonnet-4',
          cum: { uncachedInput: 10, cachedInput: 0, cacheWrite: 0, output: 5, reasoningOutput: 0 },
          blocks: { text: 1, thinking: 0, toolUse: 0 },
        },
        { kind: 'tool', i: 1, category: 'read', name: 'read-file' },
      ]),
    };
    await renderInRouter(<SessionDetail id="fake:root" />);
    expect(screen.getByRole('img', { name: /Trace ribbon/u })).not.toBeNull();
    expect(screen.queryByText('No trace data')).toBeNull();
  });

  test('the trace card shows the explicit empty state when no trace is available', async () => {
    await renderInRouter(<SessionDetail id="fake:root" />);
    expect(screen.getByText('No trace data')).not.toBeNull();
  });

  test('SessionTimeline is rendered after Trace, with no reordering of the sections above it (session-timeline f7-t3)', async () => {
    const view = await renderInRouter(<SessionDetail id="fake:root" />);
    const headings = Array.from(view.container.querySelectorAll('h2')).map(
      (heading) => heading.textContent,
    );
    const traceIndex = headings.indexOf('Trace');
    const timelineIndex = headings.indexOf('Timeline');
    expect(traceIndex).toBeGreaterThanOrEqual(0);
    expect(timelineIndex).toBe(traceIndex + 1);
    expect(headings.slice(0, traceIndex + 1)).toEqual([
      'Diagnostics',
      'Token breakdown',
      'Counts',
      'Agents',
      'Trace',
    ]);
  });

  test("TimelineSummaryBar's root-inclusive Agents count and CountsPanel's root-exclusive Subagents count are two distinct, intentionally-related numbers, not drift (session-timeline f7 fix)", async () => {
    // LOADED's subtree is 1 root + 1 subagent (CHILD), and
    // rollup.inclusive.counts.subagents is 1 (root-exclusive by
    // construction -- packages/core/src/link/link.ts's `descendants` never
    // includes the root). TimelineSummaryBar's "Agents" stat is
    // subtree.summaries.length (root-inclusive), so on this same fixture it
    // must be exactly one more than CountsPanel's "Subagents" row -- never
    // equal to it. This locks in the intentional relationship documented in
    // TimelineSummaryBar.tsx's header comment and f7's archiveWhen, so a
    // future change to either derivation can't silently break the other
    // without a test noticing.
    await renderInRouter(<SessionDetail id="fake:root" />);

    const subagentsRow = screen.getByText('Subagents').closest('tr');
    expect(subagentsRow).not.toBeNull();
    const subagentsCells = within(subagentsRow as HTMLElement).getAllByRole('cell');
    const subagentCount = Number(subagentsCells[subagentsCells.length - 1]?.textContent);

    const summaryBar = document.querySelector('[data-slot="timeline-summary-bar"]');
    expect(summaryBar).not.toBeNull();
    const agentsDt = within(summaryBar as HTMLElement).getByText('Agents');
    const agentCount = Number(agentsDt.nextElementSibling?.textContent);

    expect(subagentCount).toBe(1);
    expect(agentCount).toBe(2);
    expect(agentCount).toBe(subagentCount + 1);
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
