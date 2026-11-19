import type { ApiSessionSummary } from '@runwire/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterContextProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from '@/components/data-table';
import { formatDateTime } from '@/components/relative-date';
import { EMPTY_FILTERS, type SessionsFilters } from '@/lib/sessions-table';

const sessionA: ApiSessionSummary = {
  id: 'a',
  name: 'Session A',
  title: 'Session A',
  parentId: null,
  harness: { id: 'opencode', displayName: 'OpenCode', adapterVersion: '1' },
  project: null,
  depth: 0,
  relation: null,
  agentType: null,
  startedAt: null,
  endedAt: null,
  lastActivity: null,
  durationMs: null,
  modelPrimary: null,
  modelsOwn: [],
  modelsDescendants: [],
  tokensOwn: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
  tokensInclusive: {
    uncachedInput: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoningOutput: 0,
  },
  turnsOwn: 0,
  apiCallsOwn: 0,
  apiCallsInclusive: 0,
  toolCallsOwn: 0,
  toolCallsInclusive: 0,
  compactionsOwn: 0,
  compactionsInclusive: 0,
  costUsd: null,
  childCount: 0,
  descendantCount: 0,
  subagentChildCount: 7,
  subagentDescendantCount: 12,
};

const sessionB: ApiSessionSummary = { ...sessionA, id: 'b', name: 'Session B', title: 'Session B' };

const DAY_MS = 24 * 60 * 60 * 1000;

function pastIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS - 60_000).toISOString();
}

type DataTableProps = React.ComponentProps<typeof DataTable>;

function createTestRouter() {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    component: () => null,
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const profileRoute = createRoute({
    component: () => null,
    getParentRoute: () => rootRoute,
    path: '/sessions/$id',
  });
  return createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([indexRoute, profileRoute]),
  });
}

function makeProps(overrides: Partial<DataTableProps> = {}): DataTableProps {
  return {
    data: [sessionA, sessionB],
    total: 2,
    isFetching: false,
    filters: EMPTY_FILTERS,
    sort: null,
    pagination: { pageIndex: 0, pageSize: 10 },
    onFiltersChange: vi.fn(),
    onSortChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...overrides,
  };
}

function renderTable(overrides: Partial<DataTableProps> = {}) {
  const router = createTestRouter();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const table = (props: DataTableProps) => (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <DataTable {...props} />
      </RouterContextProvider>
    </QueryClientProvider>
  );
  const result = render(table(makeProps(overrides)));
  const rerender = (next: Partial<DataTableProps> = {}) => result.rerender(table(makeProps(next)));
  return { ...result, rerender, router };
}

function toolbarMenuTrigger(name: RegExp): HTMLElement {
  const trigger = screen
    .getAllByRole('button', { name })
    .find((button) => button.getAttribute('aria-haspopup') === 'menu');
  if (!trigger) throw new Error(`No toolbar menu trigger matching ${name}`);
  return trigger;
}

describe('DataTable prop-sync', () => {
  it('updates its rendered rows when the `data` prop changes after a refetch', () => {
    const { rerender } = renderTable({ data: [sessionA] });
    expect(screen.getByText('Session A')).toBeInTheDocument();

    rerender({ data: [sessionB] });

    expect(screen.queryByText('Session B')).toBeInTheDocument();
    expect(screen.queryByText('Session A')).not.toBeInTheDocument();
  });
});

describe('DataTable token totals', () => {
  it('excludes reasoningOutput from the Total Tokens figure (225, never 275)', () => {
    const totals = {
      uncachedInput: 100,
      cachedInput: 50,
      cacheWrite: 25,
      output: 50,
      reasoningOutput: 50,
    };
    const session: ApiSessionSummary = { ...sessionA, tokensOwn: totals, tokensInclusive: totals };
    renderTable({ data: [session] });

    expect(screen.getByText('225')).toBeInTheDocument();
    expect(screen.queryByText('275')).not.toBeInTheDocument();
  });
});

describe('DataTable session name navigation (UX-1)', () => {
  it('links the name to the full profile route and never opens a mini profile', async () => {
    const user = userEvent.setup();
    const { router } = renderTable();

    expect(screen.getByRole('link', { name: 'Session A' })).toHaveAttribute('href', '/sessions/a');
    const nameLink = screen.getByRole('link', { name: 'Session B' });
    expect(nameLink).toHaveAttribute('href', '/sessions/b');

    await user.click(nameLink);

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/b'));
    expect(screen.getByText('Session B')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('DataTable subagent count columns (UX-2)', () => {
  it('shows Direct/Full tree headers and their DTO values by default, without a sort button', () => {
    renderTable({ data: [sessionA] });

    expect(screen.getByRole('columnheader', { name: 'Direct' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Full tree' })).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Direct' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full tree' })).not.toBeInTheDocument();
  });

  it('lists human labels (not raw DTO ids) in the Columns menu and can hide a column', async () => {
    const user = userEvent.setup();
    renderTable({ data: [sessionA] });

    await user.click(toolbarMenuTrigger(/Columns/));

    expect(await screen.findByRole('menuitemcheckbox', { name: 'Direct' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Full tree' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Started At' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'subagentChildCount' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'subagentDescendantCount' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'startedAt' })).toBeNull();

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Direct' }));
    expect(screen.queryByRole('columnheader', { name: 'Direct' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Full tree' })).toBeInTheDocument();
    expect(screen.queryByText('7')).toBeNull();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});

describe('DataTable date column toggling (T5)', () => {
  const startedA = pastIso(3);
  const startedB = pastIso(5);
  const lastA = pastIso(1);
  const lastB = pastIso(2);

  const datedA: ApiSessionSummary = { ...sessionA, startedAt: startedA, lastActivity: lastA };
  const datedB: ApiSessionSummary = { ...sessionB, startedAt: startedB, lastActivity: lastB };

  function renderDated(overrides: Partial<DataTableProps> = {}) {
    return renderTable({ data: [datedA, datedB], total: 2, ...overrides });
  }

  it('switches every date in the clicked column together and leaves the other column relative', () => {
    renderDated();

    expect(screen.getByRole('button', { name: '3d ago' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5d ago' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3d ago' }));

    expect(screen.getByRole('button', { name: formatDateTime(startedA) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: formatDateTime(startedB) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1d ago' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2d ago' })).toBeInTheDocument();
  });

  it('toggles the whole column back on a second click', () => {
    renderDated();

    fireEvent.click(screen.getByRole('button', { name: '3d ago' }));
    fireEvent.click(screen.getByRole('button', { name: formatDateTime(startedA) }));

    expect(screen.getByRole('button', { name: '3d ago' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5d ago' })).toBeInTheDocument();
  });

  it('keeps Started At and Last Activity column states independent', () => {
    renderDated();

    fireEvent.click(screen.getByRole('button', { name: '1d ago' }));

    expect(screen.getByRole('button', { name: formatDateTime(lastA) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: formatDateTime(lastB) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3d ago' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5d ago' })).toBeInTheDocument();
  });

  it('never changes a dashboard date format on hover, before or after toggling', () => {
    renderDated();

    const relative = screen.getByRole('button', { name: '3d ago' });
    fireEvent.mouseEnter(relative);
    expect(screen.getByRole('button', { name: '3d ago' })).toBeInTheDocument();
    fireEvent.mouseLeave(relative);

    fireEvent.click(relative);
    const absolute = screen.getByRole('button', { name: formatDateTime(startedA) });
    fireEvent.mouseEnter(absolute);
    expect(screen.getByRole('button', { name: formatDateTime(startedA) })).toBeInTheDocument();
    fireEvent.mouseLeave(absolute);
    expect(screen.getByRole('button', { name: formatDateTime(startedA) })).toBeInTheDocument();
  });

  it('keeps the column mode across a mounted data refresh/rerender', () => {
    const { rerender } = renderDated();
    fireEvent.click(screen.getByRole('button', { name: '3d ago' }));

    rerender({ data: [{ ...datedA }, { ...datedB }] });

    expect(screen.getByRole('button', { name: formatDateTime(startedA) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: formatDateTime(startedB) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1d ago' })).toBeInTheDocument();
  });

  it('toggles the whole column with Enter/Space and never navigates the row', async () => {
    const user = userEvent.setup();
    const { router } = renderDated();

    const cell = screen.getByRole('button', { name: '3d ago' });
    cell.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: formatDateTime(startedA) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: formatDateTime(startedB) })).toBeInTheDocument();

    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: '3d ago' })).toBeInTheDocument();

    expect(router.state.location.pathname).toBe('/');
  });

  it('leaves a null date as a plain em dash through a column toggle', () => {
    const lastAt = pastIso(1);
    renderTable({ data: [{ ...sessionA, startedAt: null, lastActivity: lastAt }], total: 1 });

    expect(screen.queryByRole('button', { name: '—' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1d ago' }));

    expect(screen.queryByRole('button', { name: '—' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: formatDateTime(lastAt) })).toBeInTheDocument();
  });
});

describe('DataTable last activity column', () => {
  it('adds a sortable Last Activity header and keeps Started At', () => {
    renderTable();

    expect(screen.getByRole('columnheader', { name: 'Last Activity' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Started At' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last Activity' })).toBeInTheDocument();
  });

  it('labels the column in the Columns menu and never leaks the raw DTO id', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(toolbarMenuTrigger(/Columns/));
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Last Activity' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'lastActivity' })).toBeNull();
  });

  it('renders Started At and Last Activity as relative dates by default', () => {
    const startedAt = pastIso(3);
    const lastActivity = pastIso(1);
    renderTable({ data: [{ ...sessionA, startedAt, lastActivity }] });

    expect(screen.getByRole('button', { name: '3d ago' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1d ago' })).toBeInTheDocument();
  });

  it('marks Last Activity as the active descending sort while the sort is null (server default)', () => {
    renderTable({ sort: null });

    const lastActivity = screen.getByRole('button', { name: 'Last Activity' });
    expect(lastActivity.querySelector('.lucide-arrow-down')).not.toBeNull();

    const startedAt = screen.getByRole('button', { name: 'Started At' });
    expect(startedAt.querySelector('.lucide-arrow-down')).toBeNull();
    expect(startedAt.querySelector('.lucide-chevrons-up-down')).not.toBeNull();
  });

  it('cycles Last Activity asc -> desc -> default on header clicks, preserving the 3-state cycle', () => {
    const onSortChange = vi.fn();
    const { rerender } = renderTable({ sort: null, onSortChange });

    fireEvent.click(screen.getByRole('button', { name: 'Last Activity' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'lastActivity', desc: false });

    rerender({ sort: { id: 'lastActivity', desc: false }, onSortChange });
    fireEvent.click(screen.getByRole('button', { name: 'Last Activity' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'lastActivity', desc: true });

    rerender({ sort: { id: 'lastActivity', desc: true }, onSortChange });
    fireEvent.click(screen.getByRole('button', { name: 'Last Activity' }));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });
});

describe('DataTable harness identity', () => {
  it('renders only the SVG icon and reveals the harness name on hover', async () => {
    const { container } = renderTable({ data: [sessionA] });

    expect(container.querySelector('img[data-harness-icon="opencode"]')).not.toBeNull();
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument();

    await userEvent.hover(screen.getByLabelText('OpenCode'));
    await waitFor(() => expect(screen.getByText('OpenCode')).toBeInTheDocument());
  });
});

describe('DataTable sorting', () => {
  it('shows an up/down arrow for the active sort and a hover chevron otherwise', () => {
    const nameHeader = () => screen.getByRole('button', { name: 'Name' });

    const { rerender } = renderTable({ sort: null });
    expect(nameHeader().querySelector('.lucide-chevrons-up-down')).not.toBeNull();
    expect(nameHeader().querySelector('.lucide-arrow-up')).toBeNull();

    rerender({ sort: { id: 'name', desc: false } });
    expect(nameHeader().querySelector('.lucide-arrow-up')).not.toBeNull();

    rerender({ sort: { id: 'name', desc: true } });
    expect(nameHeader().querySelector('.lucide-arrow-down')).not.toBeNull();
  });

  it('cycles a header click asc -> desc and delegates to onSortChange', () => {
    const onSortChange = vi.fn();
    const { rerender } = renderTable({ sort: null, onSortChange });

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'name', desc: false });

    rerender({ sort: { id: 'name', desc: false }, onSortChange });
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: 'name', desc: true });
  });
});

describe('DataTable filters', () => {
  it('emits raw search text without immediate commit', () => {
    const onFiltersChange = vi.fn();
    renderTable({ onFiltersChange });

    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'auth' } });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const [next, options] = onFiltersChange.mock.calls[0] as [SessionsFilters, unknown];
    expect(next).toEqual({ ...EMPTY_FILTERS, q: 'auth' });
    expect(options).toBeUndefined();
  });

  it('clears the search immediately', () => {
    const onFiltersChange = vi.fn();
    renderTable({ filters: { ...EMPTY_FILTERS, q: 'auth' }, onFiltersChange });

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_FILTERS, { immediate: true });
  });

  it("commits the '≥ 30m' duration preset immediately", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderTable({ onFiltersChange });

    await user.click(toolbarMenuTrigger(/Duration/));
    await user.click(await screen.findByRole('menuitemradio', { name: '≥ 30m' }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      { ...EMPTY_FILTERS, duration: '30m' },
      { immediate: true },
    );
  });

  it('toggles a harness id from the harness dropdown', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderTable({ onFiltersChange });

    await user.click(toolbarMenuTrigger(/Harness/));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Claude Code/ }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      { ...EMPTY_FILTERS, harnessIds: ['claude-code'] },
      { immediate: true },
    );
  });
});

describe('DataTable footer and loading', () => {
  it('reports the visible range and page-size changes', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    renderTable({ onPageSizeChange });

    expect(screen.getByText('1–2 of 2 rows')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Rows per page'));
    await user.click(await screen.findByRole('option', { name: '20' }));

    expect(onPageSizeChange).toHaveBeenCalledWith(20);
  });

  it('reports the range on a later page and 0 of 0 when empty', () => {
    const { unmount } = renderTable({
      data: [sessionB],
      total: 2,
      pagination: { pageIndex: 1, pageSize: 1 },
    });
    expect(screen.getByText('2–2 of 2 rows')).toBeInTheDocument();
    unmount();

    renderTable({ data: [], total: 0 });
    expect(screen.getByText('0 of 0 rows')).toBeInTheDocument();
  });

  it('marks the table busy while refetching but keeps the previous rows', () => {
    const { container } = renderTable({ isFetching: true });

    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect((busy as HTMLElement).className).toContain('opacity-60');

    expect(screen.getByText('Refreshing sessions…')).toBeInTheDocument();
    expect(screen.getByText('Session A')).toBeInTheDocument();
    expect(screen.getByText('Session B')).toBeInTheDocument();
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument();
  });
});
