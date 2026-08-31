import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { HarnessAggregate, StatusResponse } from '../api/types';

// See ProjectsList.test.tsx for why the stub precedes the dynamic imports.
vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));

const { queryKeys } = await import('../api/queries');
const { HarnessList, HarnessTable } = await import('./HarnessList');

const NOW = Date.parse('2026-08-31T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const CLAUDE: HarnessAggregate = {
  harness: 'claude-code',
  sessionCount: 370,
  projects: ['github.com/org/alpha', '/home/dev/beta'],
  latestActivityAt: new Date(NOW - 3 * HOUR).toISOString(),
  aggregateUsage: {
    totalInput: { value: 2_400_000, confidence: 'high', source: 'claude-code/usage' },
    output: { value: 800_000, confidence: 'high', source: 'claude-code/usage' },
  },
};

const FAKE: HarnessAggregate = {
  harness: 'fake',
  sessionCount: 4,
  projects: ['/home/dev/beta'],
  aggregateUsage: {},
};

const STATUS: StatusResponse = {
  lastReport: {
    startedAt: new Date(NOW - HOUR).toISOString(),
    durationMs: 10,
    perAdapter: {
      'claude-code': { discovered: 370, parsed: 370, reused: 0, failed: 0, durationMs: 900 },
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
  ],
};

function mount(ui: ReactNode, harnesses: HarnessAggregate[] = [CLAUDE]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.status, STATUS);
  client.setQueryData(queryKeys.harnesses, harnesses);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const noop = () => undefined;
const displayNameFor = (id: string) => (id === 'claude-code' ? 'Claude Code' : id);

describe('HarnessTable', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders the display name, counts, activity and aggregate tokens', () => {
    const view = render(
      <HarnessTable harnesses={[CLAUDE]} displayNameFor={displayNameFor} onOpen={noop} now={NOW} />,
    );
    const cells = within(screen.getAllByRole('row')[1] as HTMLElement)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);

    expect(cells).toEqual(['Claude Code', '370', '2', '3 hours ago', '3.2M']);
    expect(view.baseElement.textContent ?? '').toContain('Harness');
  });

  test('an unknown harness id falls back to the id itself', () => {
    render(
      <HarnessTable harnesses={[FAKE]} displayNameFor={displayNameFor} onOpen={noop} now={NOW} />,
    );
    expect(screen.getByRole('button', { name: 'fake' })).not.toBeNull();
    // No usage at all and no activity: both must read as absent, not as zero.
    const cells = within(screen.getAllByRole('row')[1] as HTMLElement)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual(['fake', '4', '1', 'unknown', '—']);
  });

  test('clicking the Sessions header orders by session count', () => {
    render(
      <HarnessTable
        harnesses={[FAKE, CLAUDE]}
        displayNameFor={displayNameFor}
        onOpen={noop}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Sessions/ }));
    const order = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('button')[0]?.textContent);
    expect(order).toEqual(['Claude Code', 'fake']);
  });

  test('a row opens its harness id', () => {
    const opened: string[] = [];
    render(
      <HarnessTable
        harnesses={[CLAUDE]}
        displayNameFor={displayNameFor}
        onOpen={(id) => opened.push(id)}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getAllByRole('row')[1] as HTMLElement);
    expect(opened).toEqual(['claude-code']);
  });
});

describe('HarnessList', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders the aggregates from the harnesses query', () => {
    mount(<HarnessList onOpen={noop} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Claude Code' })).not.toBeNull();
    expect(screen.getByText('370')).not.toBeNull();
  });

  test('shows the doctor-like empty state when nothing was parsed', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
    client.setQueryData(queryKeys.status, {
      ...STATUS,
      lastReport: {
        ...STATUS.lastReport,
        startedAt: STATUS.lastReport?.startedAt ?? '',
        durationMs: 10,
        diagnostics: [],
        perAdapter: {
          'claude-code': { discovered: 0, parsed: 0, reused: 0, failed: 0, durationMs: 3 },
        },
      },
    } satisfies StatusResponse);
    client.setQueryData(queryKeys.harnesses, []);

    const view = render(
      <QueryClientProvider client={client}>
        <HarnessList onOpen={noop} now={NOW} />
      </QueryClientProvider>,
    );
    // Counted by rows rather than by the presence of a wrapper element: what has
    // to be true is that no list row renders at all.
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(view.baseElement.textContent ?? '').toContain('Run scout doctor for details');
  });
});
