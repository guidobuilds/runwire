import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ProjectAggregate, StatusResponse } from '../api/types';

/*
 * Everything these tests need is seeded into the query cache, so no request
 * should ever leave the component. `fetch` is stubbed with a promise that never
 * settles so an accidental request fails loudly as a hang instead of quietly
 * hitting happy-dom's origin — and it is installed before the dynamic imports
 * because `api/client.ts` binds `fetch` at module-evaluation time (lessons.md
 * `web-api-module-fetch-binding`).
 */
vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));

const { queryKeys } = await import('../api/queries');
const { aggregateTokens, ProjectsList, ProjectsTable } = await import('./ProjectsList');

const NOW = Date.parse('2026-08-31T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ALPHA: ProjectAggregate = {
  project: { key: 'github.com/org/alpha', name: 'alpha', identity: 'remote' },
  sessionCount: 2,
  harnesses: ['claude-code'],
  latestActivityAt: new Date(NOW - 2 * HOUR).toISOString(),
  aggregateUsage: {
    totalInput: { value: 12_000, confidence: 'high', source: 'claude-code/usage' },
    output: { value: 3_000, confidence: 'high', source: 'claude-code/usage' },
  },
};

const BETA: ProjectAggregate = {
  project: { key: '/home/dev/beta', name: 'beta', identity: 'cwd', worktree: 'feature-wt' },
  sessionCount: 9,
  harnesses: ['claude-code', 'fake'],
  latestActivityAt: new Date(NOW - 3 * DAY).toISOString(),
  aggregateUsage: {
    // Output is absent on purpose: the sum is then a floor, not a measurement.
    totalInput: { value: 900, confidence: 'medium', source: 'claude-code/derived' },
  },
};

function status(parsed: number): StatusResponse {
  return {
    lastReport: {
      startedAt: new Date(NOW - HOUR).toISOString(),
      durationMs: 10,
      perAdapter: {
        'claude-code': { discovered: parsed, parsed, reused: 0, failed: 0, durationMs: 8 },
      },
      diagnostics: [],
    },
    adapters: [
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        capabilities: [],
        probe: { installed: true, roots: ['/home/dev/.claude'], notes: [] },
      },
      {
        id: 'fake',
        displayName: 'Fake Harness',
        capabilities: [],
        probe: { installed: true, roots: [], notes: [] },
      },
    ],
  };
}

function mount(ui: ReactNode, options: { parsed?: number; projects?: ProjectAggregate[] } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.status, status(options.parsed ?? 12));
  client.setQueryData(queryKeys.projects, options.projects ?? [ALPHA, BETA]);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Row order by project name; the name button is each row's first control. */
function names(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button')[0]?.textContent ?? '');
}

const noop = () => undefined;

describe('aggregateTokens', () => {
  test('sums both halves and keeps the weakest reported confidence', () => {
    expect(
      aggregateTokens({
        totalInput: { value: 1_000, confidence: 'high', source: 'a' },
        output: { value: 500, confidence: 'medium', source: 'b' },
      }),
    ).toMatchObject({ total: 1_500, confidence: 'medium' });
  });

  test('a missing half is counted as 0 and caps the sum at low confidence', () => {
    const result = aggregateTokens({
      totalInput: { value: 1_000, confidence: 'high', source: 'a' },
    });
    expect(result.total).toBe(1_000);
    expect(result.confidence).toBe('low');
    expect(result.title).toContain('Output — not reported');
  });

  test('neither half reported means there is no total at all', () => {
    expect(aggregateTokens({}).total).toBeUndefined();
  });
});

describe('ProjectsTable', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders the PRODUCT.md columns for every aggregate', () => {
    const view = render(
      <ProjectsTable
        projects={[ALPHA, BETA]}
        displayNameFor={(id) => (id === 'claude-code' ? 'Claude Code' : 'Fake Harness')}
        onOpen={noop}
        now={NOW}
      />,
    );
    const text = view.baseElement.textContent ?? '';

    expect(screen.getByRole('button', { name: 'alpha' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'beta' })).not.toBeNull();
    expect(screen.getByText('remote')).not.toBeNull();
    expect(screen.getByText('cwd')).not.toBeNull();
    expect(screen.getByText('worktree: feature-wt')).not.toBeNull();
    expect(screen.getAllByText('Claude Code')).toHaveLength(2);
    expect(screen.getByText('Fake Harness')).not.toBeNull();
    expect(text).toContain('2 hours ago');
    expect(text).toContain('3 days ago');
    // alpha: 12k input + 3k output, both high -> no marker.
    expect(text).toContain('15.0k');
    // beta: input only -> low confidence, so the '?' marker is on screen.
    expect(text).toContain('?900');
  });

  test('the aggregate-token hover names both halves, including the missing one', () => {
    render(<ProjectsTable projects={[BETA]} displayNameFor={(id) => id} onOpen={noop} now={NOW} />);
    const cell = screen.getByTitle(/Output — not reported/);
    expect(cell.textContent).toBe('?900');
    expect(cell.getAttribute('title')).toContain('Input 900 · medium confidence');
  });

  test('defaults to latest activity, newest first', () => {
    render(
      <ProjectsTable
        projects={[BETA, ALPHA]}
        displayNameFor={(id) => id}
        onOpen={noop}
        now={NOW}
      />,
    );
    expect(names()).toEqual(['alpha', 'beta']);
  });

  test('clicking the Sessions header sorts by session count, then reverses', () => {
    render(
      <ProjectsTable
        projects={[ALPHA, BETA]}
        displayNameFor={(id) => id}
        onOpen={noop}
        now={NOW}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Sessions/ }));
    expect(names()).toEqual(['beta', 'alpha']);
    expect(screen.getByRole('columnheader', { name: /Sessions/ }).getAttribute('aria-sort')).toBe(
      'descending',
    );

    fireEvent.click(screen.getByRole('button', { name: /^Sessions/ }));
    expect(names()).toEqual(['alpha', 'beta']);
    expect(screen.getByRole('columnheader', { name: /Sessions/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
  });

  test('a row hands the raw project key — slashes and all — to onOpen', () => {
    const opened: string[] = [];
    render(
      <ProjectsTable
        projects={[ALPHA]}
        displayNameFor={(id) => id}
        onOpen={(key) => opened.push(key)}
        now={NOW}
      />,
    );

    fireEvent.click(screen.getAllByRole('row')[1] as HTMLElement);
    expect(opened).toEqual(['github.com/org/alpha']);

    fireEvent.click(screen.getByRole('button', { name: 'alpha' }));
    // The in-cell button must not double-fire through the row handler.
    expect(opened).toEqual(['github.com/org/alpha', 'github.com/org/alpha']);
  });
});

describe('ProjectsList', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders the aggregates from the projects query', () => {
    mount(<ProjectsList onOpen={noop} now={NOW} />);
    expect(screen.getByRole('button', { name: 'alpha' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'beta' })).not.toBeNull();
    // Harness ids resolved through the status query, not printed raw.
    expect(screen.getAllByText('Claude Code')).toHaveLength(2);
    expect(screen.getByText('Fake Harness')).not.toBeNull();
  });

  test('shows the doctor-like empty state when nothing was parsed', () => {
    const view = mount(<ProjectsList onOpen={noop} now={NOW} />, { parsed: 0, projects: [] });
    // Counted by rows rather than by the presence of a wrapper element: what has
    // to be true is that no list row renders at all.
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(view.baseElement.textContent ?? '').toContain('Run scout doctor for details');
  });
});
