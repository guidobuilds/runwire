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

const emptyResponse = {
  view: 'merged',
  sessionId: PROFILE_ROOT_ID,
  scope: 'tree',
  sort: 'time',
  dir: 'asc',
  items: [],
  total: 0,
  limit: 10,
  offset: 0,
  excludedNullAtCount: 0,
};

describe('EventsTable — request shape', () => {
  it('requests the default sort/scope/pagination (no legacy filter) via the real handlers', async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.get('/api/sessions/:id/profile/events', ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json(emptyResponse);
      }),
    );

    renderTable();

    await screen.findByText('No events for this filter');
    expect(capturedUrl?.pathname).toBe(
      `/api/sessions/${encodeURIComponent(PROFILE_ROOT_ID)}/profile/events`,
    );
    expect(capturedUrl?.searchParams.get('scope')).toBe('tree');
    expect(capturedUrl?.searchParams.get('sort')).toBe('time');
    expect(capturedUrl?.searchParams.get('dir')).toBe('asc');
    expect(capturedUrl?.searchParams.get('limit')).toBe('10');
    expect(capturedUrl?.searchParams.get('offset')).toBe('0');
    expect(capturedUrl?.searchParams.get('filter')).toBeNull();
  });

  it('sends a kind CSV filter and resets to page 1 when the kind select changes', async () => {
    const user = userEvent.setup();
    const requests: URL[] = [];
    server.use(
      http.get('/api/sessions/:id/profile/events', ({ request }) => {
        requests.push(new URL(request.url));
        return undefined;
      }),
    );

    renderTable({ initialPage: 2, pageSize: 1 });

    await screen.findByRole('combobox', { name: 'Event kind' });
    await user.click(screen.getByRole('combobox', { name: 'Event kind' }));
    await user.click(await screen.findByRole('option', { name: 'Tool' }));

    await screen.findByRole('row', { name: /mcp/i });
    expect(
      requests.some(
        (url) => url.searchParams.get('kind') === 'tool' && url.searchParams.get('offset') === '0',
      ),
    ).toBe(true);
  });

  it('sends a status filter and resets to page 1 when the status select changes', async () => {
    const user = userEvent.setup();
    const requests: URL[] = [];
    server.use(
      http.get('/api/sessions/:id/profile/events', ({ request }) => {
        requests.push(new URL(request.url));
        return undefined;
      }),
    );

    renderTable({ initialPage: 2, pageSize: 1 });

    await screen.findByRole('combobox', { name: 'Event status' });
    await user.click(screen.getByRole('combobox', { name: 'Event status' }));
    await user.click(await screen.findByRole('option', { name: 'Error' }));

    await screen.findByRole('row', { name: /bash/i });
    expect(
      requests.some(
        (url) =>
          url.searchParams.get('status') === 'error' && url.searchParams.get('offset') === '0',
      ),
    ).toBe(true);
  });

  it('sorts by a clicked column header and toggles direction on the second click', async () => {
    const user = userEvent.setup();
    const requests: URL[] = [];
    server.use(
      http.get('/api/sessions/:id/profile/events', ({ request }) => {
        requests.push(new URL(request.url));
        return undefined;
      }),
    );

    renderTable();
    await screen.findByRole('row', { name: /compaction/i });

    await user.click(screen.getByRole('button', { name: 'Kind' }));
    await screen.findByRole('row', { name: /compaction/i });
    expect(
      requests.some(
        (url) => url.searchParams.get('sort') === 'kind' && url.searchParams.get('dir') === 'asc',
      ),
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Kind' }));
    await screen.findByRole('row', { name: /compaction/i });
    expect(
      requests.some(
        (url) => url.searchParams.get('sort') === 'kind' && url.searchParams.get('dir') === 'desc',
      ),
    ).toBe(true);
  });
});

describe('EventsTable — loaded state', () => {
  it('renders the default fixture rows and the total/excludedNullAtCount footer', async () => {
    renderTable();

    await screen.findByRole('row', { name: /compaction/i });
    expect(screen.getByText(/events total/)).toBeInTheDocument();
    expect(screen.getByText(/events without timestamp not shown/)).toBeInTheDocument();
  });

  it('renders the server-owned action label and subject for tool rows', async () => {
    renderTable();

    const row = await screen.findByRole('row', { name: /mcp/i });
    expect(within(row).getByText('MCP')).toBeInTheDocument();
    expect(within(row).getByText('mcp__plugin_engram_engram__mem_save')).toBeInTheDocument();
    // The legacy "category · toolName" concatenation is gone.
    expect(
      within(row).queryByText('mcp · mcp__plugin_engram_engram__mem_save'),
    ).not.toBeInTheDocument();
  });

  it('shows an error badge only on the error-flagged row', async () => {
    renderTable();

    const row = await screen.findByRole('row', { name: /bash/i });
    expect(within(row).getByText('Error')).toBeInTheDocument();
    const compaction = screen.getByRole('row', { name: /compaction/i });
    expect(within(compaction).queryByText('Error')).not.toBeInTheDocument();
    expect(within(compaction).getByText('OK')).toBeInTheDocument();
  });

  it('renders the model column for a tool row (value and em dash)', async () => {
    renderTable();

    const mcpRow = await screen.findByRole('row', { name: /mcp/i });
    expect(within(mcpRow).getAllByRole('cell')[5]).toHaveTextContent('claude-sonnet-5');
    const bashRow = screen.getByRole('row', { name: /bash/i });
    expect(within(bashRow).getAllByRole('cell')[5]).toHaveTextContent('—');
  });
});

describe('EventsTable — empty state', () => {
  it('shows a single "No events for this filter" row when items is empty', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/events', () => HttpResponse.json(emptyResponse)),
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
        return HttpResponse.json(emptyResponse);
      }),
    );

    renderTable();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No events for this filter')).toBeInTheDocument();
  });
});

describe('EventsTable — pagination', () => {
  it('changing the local page changes the offset requested (limit=1 against the 3-item fixture)', async () => {
    const user = userEvent.setup();
    renderTable({ initialPage: 1, pageSize: 1 });

    await screen.findByRole('row', { name: /compaction/i });
    expect(screen.queryByRole('row', { name: /mcp/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to next page' }));

    await screen.findByRole('row', { name: /mcp/i });
    expect(screen.queryByRole('row', { name: /compaction/i })).not.toBeInTheDocument();
  });
});
