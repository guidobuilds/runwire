import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/node';
import { PROFILE_ROOT_ID } from '@/mocks/session-profile';
import { EventsTable } from './events-table';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

function renderTable(props: Partial<React.ComponentProps<typeof EventsTable>> = {}) {
  return render(<EventsTable sessionId={PROFILE_ROOT_ID} {...props} />, { wrapper });
}

describe('EventsTable — request shape', () => {
  it('requests scope=tree, filter=signals, limit=50, offset=0 by default, via the real handlers', async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.get('/api/sessions/:id/profile/events', ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({
          view: 'merged',
          sessionId: PROFILE_ROOT_ID,
          scope: 'tree',
          filter: 'signals',
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          excludedNullAtCount: 0,
        });
      }),
    );

    renderTable();

    await screen.findByText('No events for this filter');
    expect(capturedUrl?.pathname).toBe(
      `/api/sessions/${encodeURIComponent(PROFILE_ROOT_ID)}/profile/events`,
    );
    expect(capturedUrl?.searchParams.get('view')).toBeNull();
    expect(capturedUrl?.searchParams.get('scope')).toBe('tree');
    expect(capturedUrl?.searchParams.get('filter')).toBe('signals');
    expect(capturedUrl?.searchParams.get('limit')).toBe('50');
    expect(capturedUrl?.searchParams.get('offset')).toBe('0');
  });
});

describe('EventsTable — loaded state', () => {
  it('renders the default fixture rows and the total/excludedNullAtCount footer', async () => {
    renderTable();

    await screen.findByRole('row', { name: /compaction/i });
    expect(screen.getByText(/events total/)).toBeInTheDocument();
    expect(screen.getByText(/events without timestamp not shown/)).toBeInTheDocument();
  });

  it('renders detail as metadata only (category · toolName), never args/paths', async () => {
    renderTable();

    const row = await screen.findByRole('row', { name: /mcp/i });
    expect(within(row).getByText('mcp · mcp__plugin_engram_engram__mem_save')).toBeInTheDocument();
  });

  it('shows an error badge only on the error-flagged row', async () => {
    renderTable({ initialFilter: 'all' });

    await screen.findByRole('row', { name: /compaction/i });
    const rows = screen.getAllByRole('row');
    const errorRows = rows.filter((row) => within(row).queryByText('error'));
    expect(errorRows).toHaveLength(1);
  });

  it('renders the mcp tool row model in the Model column', async () => {
    renderTable();

    const row = await screen.findByRole('row', { name: /mcp/i });
    const cells = within(row).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('claude-sonnet-5');
  });

  it('renders the em dash in the Model column for a tool row with a null model', async () => {
    renderTable({ initialFilter: 'all' });

    const row = await screen.findByRole('row', { name: /bash/i });
    const cells = within(row).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('—');
  });
});

describe('EventsTable — empty state', () => {
  it('shows a single "No events for this filter" row when items is empty', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/events', () =>
        HttpResponse.json({
          view: 'merged',
          sessionId: PROFILE_ROOT_ID,
          scope: 'tree',
          filter: 'signals',
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          excludedNullAtCount: 0,
        }),
      ),
    );

    renderTable();

    expect(await screen.findByText('No events for this filter')).toBeInTheDocument();
  });
});

describe('EventsTable — error + retry', () => {
  it('shows an inline error and Retry, which recovers on success', async () => {
    let failNext = true;
    server.use(
      http.get('/api/sessions/:id/profile/events', () => {
        if (failNext) {
          failNext = false;
          return HttpResponse.json({ error: 'internal error' }, { status: 500 });
        }
        return HttpResponse.json({
          view: 'merged',
          sessionId: PROFILE_ROOT_ID,
          scope: 'tree',
          filter: 'signals',
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          excludedNullAtCount: 0,
        });
      }),
    );

    renderTable();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No events for this filter')).toBeInTheDocument();
  });
});

describe('EventsTable — pagination', () => {
  it('changing the local page changes the offset requested (via limit=1 against the 2-item signals fixture)', async () => {
    const user = userEvent.setup();
    renderTable({ initialPage: 1, pageSize: 1 });

    await screen.findByRole('row', { name: /compaction/i });
    expect(screen.queryByRole('row', { name: /mcp/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to next page' }));

    await screen.findByRole('row', { name: /mcp/i });
    expect(screen.queryByRole('row', { name: /compaction/i })).not.toBeInTheDocument();
  });
});

describe('EventsTable — filter change', () => {
  it('resets to page 1 and requests the new filter when the select changes', async () => {
    const user = userEvent.setup();
    const requests: URL[] = [];
    server.use(
      http.get('/api/sessions/:id/profile/events', ({ request }) => {
        requests.push(new URL(request.url));
        return undefined;
      }),
    );

    renderTable({ initialPage: 2, pageSize: 1 });

    await screen.findByRole('combobox', { name: 'Event filter' });
    await user.click(screen.getByRole('combobox', { name: 'Event filter' }));
    await user.click(await screen.findByRole('option', { name: 'All events' }));

    await screen.findByRole('row', { name: /compaction/i });
    expect(
      requests.some(
        (url) => url.searchParams.get('filter') === 'all' && url.searchParams.get('offset') === '0',
      ),
    ).toBe(true);
  });
});
