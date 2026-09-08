import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/node';
import { mockProfileTimelineTree, PROFILE_ROOT_ID } from '@/mocks/session-profile';
import { TokenChart } from './token-chart';

// Exercises the real, composed MSW `handlers` array (registered globally in
// src/test/setup.ts via `@/mocks/node`), not a stubbed `fetch` — see
// verification.md#f3 finding F-5.

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('TokenChart — happy path', () => {
  it('renders one line per fixture model plus a total line', async () => {
    const { container } = render(
      <TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line').length).toBe(
        mockProfileTimelineTree.series.length + 1,
      );
    });
  });

  it('renders one marker per spawn instant', async () => {
    const { container } = render(
      <TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />,
      { wrapper },
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-reference-dot').length).toBe(
        mockProfileTimelineTree.spawns.length,
      );
    });
  });

  it('renders a draggable timeline navigator for zooming', async () => {
    const { container } = render(
      <TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />,
      { wrapper },
    );
    expect(
      await screen.findByText('Drag across the chart or use the timeline handles to zoom'),
    ).toBeInTheDocument();
    expect(container.querySelector('.recharts-brush')).toBeInTheDocument();
  });

  it('shows the excludedNullAtCount footer whenever it is greater than zero', async () => {
    render(<TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />, {
      wrapper,
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          `${mockProfileTimelineTree.excludedNullAtCount} calls without timestamp not shown.`,
        ),
      ).toBeInTheDocument();
    });
  });

  it('compresses long periods without token activity and allows restoring wall-clock time', async () => {
    const user = userEvent.setup();
    const points = [
      { at: '2026-09-01T10:00:00.000Z', totalCumulative: 100 },
      { at: '2026-09-01T10:05:00.000Z', totalCumulative: 200 },
      { at: '2026-09-01T20:05:00.000Z', totalCumulative: 300 },
      { at: '2026-09-01T20:10:00.000Z', totalCumulative: 400 },
    ].map((point) => ({
      ...point,
      cumulative: [point.totalCumulative, 0],
      delta: [100, 0],
      totalDelta: 100,
    }));
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('view') !== 'timeline') return undefined;
        return HttpResponse.json({
          ...mockProfileTimelineTree,
          points,
          spawns: [],
          timeDomain: { start: points[0]?.at, end: points.at(-1)?.at },
        });
      }),
    );

    render(<TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />, {
      wrapper,
    });

    expect(await screen.findByText('No token activity · 10h 0m')).toBeInTheDocument();
    await user.click(screen.getByText('Wall clock'));
    await waitFor(() => {
      expect(screen.queryByText('No token activity · 10h 0m')).not.toBeInTheDocument();
    });
  });
});

describe('TokenChart — field selection', () => {
  it('re-requests the timeline with the new field when the field prop changes', async () => {
    const requestedFields: (string | null)[] = [];
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('view') !== 'timeline') return undefined;
        requestedFields.push(url.searchParams.get('field'));
        return HttpResponse.json(mockProfileTimelineTree);
      }),
    );

    const { rerender } = render(
      <TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />,
      { wrapper },
    );
    await waitFor(() => expect(requestedFields).toContain('output'));

    rerender(
      <TokenChart field="cacheWrite" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />,
    );
    await waitFor(() => expect(requestedFields).toContain('cacheWrite'));
  });
});

describe('TokenChart — F-7 guard', () => {
  it('renders an error state instead of a chart when delta/cumulative length mismatches series.length', async () => {
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('view') !== 'timeline') return undefined;
        return HttpResponse.json({
          ...mockProfileTimelineTree,
          points: [
            {
              at: '2026-09-01T10:01:00.000Z',
              delta: [400],
              cumulative: [400],
              totalDelta: 400,
              totalCumulative: 400,
            },
          ],
        });
      }),
    );

    render(<TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />, {
      wrapper,
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Timeline data is inconsistent.');
    });
  });
});

describe('TokenChart — empty state', () => {
  it('shows "No timed calls in this tree" when there are no points', async () => {
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('view') !== 'timeline') return undefined;
        return HttpResponse.json({
          ...mockProfileTimelineTree,
          points: [],
          spawns: [],
          excludedNullAtCount: 5,
        });
      }),
    );

    render(<TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />, {
      wrapper,
    });
    await waitFor(() => {
      expect(screen.getByText('No timed calls in this tree.')).toBeInTheDocument();
    });
    expect(screen.getByText('5 calls without timestamp not shown.')).toBeInTheDocument();
  });
});

describe('TokenChart — error state', () => {
  it('shows Retry on failure and refetches on click', async () => {
    let calls = 0;
    server.use(
      http.get('/api/session-profiles/:id', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('view') !== 'timeline') return undefined;
        calls += 1;
        if (calls === 1) return HttpResponse.json({ error: 'boom' }, { status: 500 });
        return HttpResponse.json(mockProfileTimelineTree);
      }),
    );

    render(<TokenChart field="output" onFieldChange={() => {}} sessionId={PROFILE_ROOT_ID} />, {
      wrapper,
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    retry.click();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
    expect(calls).toBe(2);
  });
});
