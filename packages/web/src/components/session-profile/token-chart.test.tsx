import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/node';
import { mockProfileTimelineTree, PROFILE_ROOT_ID } from '@/mocks/session-profile';
import { TokenChart } from './token-chart';

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

const ZERO_TOKENS = {
  uncachedInput: 0,
  cachedInput: 0,
  cacheWrite: 0,
  output: 0,
  reasoningOutput: 0,
};

type TimelineRow = { cumulative: (number | null)[]; totalCumulative: number };

function timelinePayload(models: readonly string[], rows: readonly TimelineRow[]) {
  const series = models.map((model) => ({
    model,
    totals: { ...ZERO_TOKENS },
    callsWithField: { ...ZERO_TOKENS },
    callCount: 1,
  }));
  let previousTotal = 0;
  const points = rows.map((row, index) => {
    const totalDelta = row.totalCumulative - previousTotal;
    previousTotal = row.totalCumulative;
    return {
      at: new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString(),
      cumulative: row.cumulative,
      delta: row.cumulative,
      totalDelta,
      totalCumulative: row.totalCumulative,
    };
  });
  return {
    ...mockProfileTimelineTree,
    series,
    points,
    spawns: [],
    timeDomain: { start: null, end: null },
  };
}

async function renderChart(payload: ReturnType<typeof timelinePayload>) {
  server.use(http.get('/api/sessions/:id/profile/timeline', () => HttpResponse.json(payload)));
  const view = render(<TokenChart sessionId={PROFILE_ROOT_ID} />, { wrapper });
  await waitFor(() => {
    expect(view.container.querySelector('.recharts-line-curve')).toBeInTheDocument();
  });
  return view;
}

function curvePath(container: HTMLElement, stroke: string): string {
  const curve = [...container.querySelectorAll('.recharts-line-curve')].find(
    (element) => element.getAttribute('stroke') === stroke,
  );
  if (!curve) throw new Error(`No rendered line for stroke ${stroke}`);
  return curve.getAttribute('d') ?? '';
}

function onCurvePoints(path: string): { x: number; y: number }[] {
  return (path.match(/[MCL][^MCL]*/g) ?? []).map((segment) => {
    const numbers = segment
      .slice(1)
      .split(/[\s,]+/)
      .filter((token) => token.length > 0)
      .map(Number);
    return { x: numbers.at(-2) ?? Number.NaN, y: numbers.at(-1) ?? Number.NaN };
  });
}

function legendNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.recharts-legend-item-text')].map(
    (item) => item.textContent ?? '',
  );
}

async function expectTooltip(
  container: HTMLElement,
  clientX: number,
  options: { includes?: string[]; excludes?: string[] },
) {
  const wrapperElement = container.querySelector('.recharts-wrapper');
  if (!wrapperElement) throw new Error('No rendered chart wrapper');
  await act(async () => {
    fireEvent.mouseEnter(wrapperElement, { clientX, clientY: 100 });
    fireEvent.mouseMove(wrapperElement, { clientX, clientY: 100 });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await waitFor(() => {
    const text = container.querySelector('.recharts-tooltip-wrapper')?.textContent ?? '';
    for (const name of options.includes ?? []) expect(text).toContain(name);
  });
  const text = container.querySelector('.recharts-tooltip-wrapper')?.textContent ?? '';
  for (const name of options.excludes ?? []) expect(text).not.toContain(name);
}

async function dragZoom(container: HTMLElement, fromX: number, toX: number) {
  const wrapperElement = container.querySelector('.recharts-wrapper');
  if (!wrapperElement) throw new Error('No rendered chart wrapper');
  const settle = async (clientX: number) => {
    await act(async () => {
      fireEvent.mouseMove(wrapperElement, { clientX, clientY: 100 });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  };
  await settle(fromX);
  await act(async () => {
    fireEvent.mouseDown(wrapperElement, { clientX: fromX, clientY: 100 });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await settle(toX);
  await act(async () => {
    fireEvent.mouseUp(wrapperElement, { clientX: toX, clientY: 100 });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('TokenChart — happy path', () => {
  it('renders one line per fixture model plus a total line', async () => {
    const { container } = render(<TokenChart sessionId={PROFILE_ROOT_ID} />, { wrapper });
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-line').length).toBe(
        mockProfileTimelineTree.series.length + 1,
      );
    });
  });

  it('renders one marker per spawn instant', async () => {
    const { container } = render(<TokenChart sessionId={PROFILE_ROOT_ID} />, { wrapper });
    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-reference-dot').length).toBe(
        mockProfileTimelineTree.spawns.length,
      );
    });
  });

  it('renders a draggable timeline navigator for zooming', async () => {
    const { container } = render(<TokenChart sessionId={PROFILE_ROOT_ID} />, { wrapper });
    expect(
      await screen.findByText('Drag across the chart or use the timeline handles to zoom'),
    ).toBeInTheDocument();
    expect(container.querySelector('.recharts-brush')).toBeInTheDocument();
  });

  it('shows the excludedNullAtCount footer whenever it is greater than zero', async () => {
    render(<TokenChart sessionId={PROFILE_ROOT_ID} />, {
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
      http.get('/api/sessions/:id/profile/timeline', () =>
        HttpResponse.json({
          ...mockProfileTimelineTree,
          points,
          spawns: [],
          timeDomain: { start: points[0]?.at, end: points.at(-1)?.at },
        }),
      ),
    );

    render(<TokenChart sessionId={PROFILE_ROOT_ID} />, {
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
  it('re-requests the timeline with the new field when the local selector changes', async () => {
    const user = userEvent.setup();
    const requestedFields: (string | null)[] = [];
    server.use(
      http.get('/api/sessions/:id/profile/timeline', ({ request }) => {
        const url = new URL(request.url);
        requestedFields.push(url.searchParams.get('field'));
        return HttpResponse.json(mockProfileTimelineTree);
      }),
    );

    render(<TokenChart sessionId={PROFILE_ROOT_ID} />, { wrapper });
    await waitFor(() => expect(requestedFields).toContain('output'));

    await user.click(screen.getByRole('combobox', { name: 'Token field' }));
    await user.click(await screen.findByRole('option', { name: 'Cache write' }));

    await waitFor(() => expect(requestedFields).toContain('cacheWrite'));
  });
});

describe('TokenChart — first-positive model visibility', () => {
  it('starts a late model at its first positive value and hides earlier points from the tooltip', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha', 'beta'],
        [
          { cumulative: [0, null], totalCumulative: 0 },
          { cumulative: [0, null], totalCumulative: 0 },
          { cumulative: [5, 8], totalCumulative: 13 },
          { cumulative: [5, 8], totalCumulative: 13 },
        ],
      ),
    );

    const alpha = onCurvePoints(curvePath(container, 'var(--token-model-1)'));
    const total = onCurvePoints(curvePath(container, 'var(--foreground)'));
    expect(alpha.length).toBe(2);
    expect(alpha[0]?.x).toBeGreaterThan(total[0]?.x ?? Number.POSITIVE_INFINITY);

    await expectTooltip(container, total[0]?.x ?? 0, {
      includes: ['Total Output'],
      excludes: ['alpha', 'beta'],
    });
    await expectTooltip(container, total[2]?.x ?? 0, {
      includes: ['alpha', 'beta', 'Total Output'],
    });
  });

  it('omits a never-positive model and keeps remaining colors tied to original series indices', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha', 'beta', 'gamma'],
        [
          { cumulative: [0, null, 0], totalCumulative: 0 },
          { cumulative: [5, null, 7], totalCumulative: 12 },
          { cumulative: [5, null, 12], totalCumulative: 17 },
        ],
      ),
    );

    expect(container.querySelectorAll('.recharts-line').length).toBe(3);
    const names = legendNames(container);
    expect(names).toEqual(expect.arrayContaining(['alpha', 'gamma', 'Total Output']));
    expect(names).not.toContain('beta');

    const strokes = [...container.querySelectorAll('.recharts-line-curve')].map((element) =>
      element.getAttribute('stroke'),
    );
    expect(strokes).toEqual(
      expect.arrayContaining(['var(--token-model-1)', 'var(--token-model-3)', 'var(--foreground)']),
    );
    expect(strokes).not.toContain('var(--token-model-2)');
  });

  it('does not activate a model on an observed zero and starts its line at the first positive value', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha', 'beta'],
        [
          { cumulative: [0, null], totalCumulative: 0 },
          { cumulative: [0, 0], totalCumulative: 1 },
          { cumulative: [0, 4], totalCumulative: 5 },
          { cumulative: [0, 4], totalCumulative: 5 },
        ],
      ),
    );

    const names = legendNames(container);
    expect(names).not.toContain('alpha');
    expect(names).toContain('beta');

    const beta = onCurvePoints(curvePath(container, 'var(--token-model-2)'));
    const total = onCurvePoints(curvePath(container, 'var(--foreground)'));
    expect(beta.length).toBe(2);
    expect(beta[0]?.x).toBeCloseTo(total[2]?.x ?? Number.NaN);
    expect(beta[0]?.x).toBeGreaterThan(total[1]?.x ?? Number.POSITIVE_INFINITY);
  });

  it('keeps cumulative plateaus after the first positive value', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha'],
        [
          { cumulative: [0], totalCumulative: 0 },
          { cumulative: [5], totalCumulative: 5 },
          { cumulative: [5], totalCumulative: 5 },
          { cumulative: [9], totalCumulative: 9 },
        ],
      ),
    );

    const alpha = onCurvePoints(curvePath(container, 'var(--token-model-1)'));
    expect(alpha.length).toBe(3);
    expect(alpha[1]?.y).toBeCloseTo(alpha[0]?.y ?? Number.NaN);
    expect(alpha[2]?.y).toBeLessThan(alpha[1]?.y ?? Number.NEGATIVE_INFINITY);
  });

  it('marks a series with exactly one visible point and leaves multi-point lines dotless', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha', 'beta'],
        [
          { cumulative: [0, null], totalCumulative: 0 },
          { cumulative: [5, null], totalCumulative: 5 },
          { cumulative: [8, null], totalCumulative: 8 },
          { cumulative: [8, 9], totalCumulative: 9 },
        ],
      ),
    );

    const dots = [...container.querySelectorAll('.recharts-line-dot')];
    expect(dots.length).toBe(1);
    const total = onCurvePoints(curvePath(container, 'var(--foreground)'));
    expect(Number(dots[0]?.getAttribute('cx'))).toBeCloseTo(total.at(-1)?.x ?? Number.NaN);
    expect(Number(dots[0]?.getAttribute('cy'))).toBeCloseTo(total.at(-1)?.y ?? Number.NaN);
  });

  it('recomputes visibility when the token field changes', async () => {
    const user = userEvent.setup();
    const outputPayload = timelinePayload(
      ['alpha', 'beta'],
      [
        { cumulative: [0, null], totalCumulative: 0 },
        { cumulative: [5, null], totalCumulative: 5 },
        { cumulative: [9, null], totalCumulative: 9 },
      ],
    );
    const cacheWritePayload = timelinePayload(
      ['alpha', 'beta'],
      [
        { cumulative: [0, null], totalCumulative: 0 },
        { cumulative: [0, 6], totalCumulative: 6 },
        { cumulative: [0, 6], totalCumulative: 6 },
      ],
    );
    server.use(
      http.get('/api/sessions/:id/profile/timeline', ({ request }) => {
        const field = new URL(request.url).searchParams.get('field');
        return HttpResponse.json(field === 'cacheWrite' ? cacheWritePayload : outputPayload);
      }),
    );

    const { container } = render(<TokenChart sessionId={PROFILE_ROOT_ID} />, { wrapper });
    await waitFor(() => expect(legendNames(container)).toContain('alpha'));
    expect(legendNames(container)).not.toContain('beta');

    await user.click(screen.getByRole('combobox', { name: 'Token field' }));
    await user.click(await screen.findByRole('option', { name: 'Cache write' }));

    await waitFor(() => expect(legendNames(container)).toContain('beta'));
    expect(legendNames(container)).not.toContain('alpha');
  });

  it('keeps a model that consumes from the first bucket visible', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha'],
        [
          { cumulative: [3], totalCumulative: 3 },
          { cumulative: [3], totalCumulative: 3 },
        ],
      ),
    );

    expect(legendNames(container)).toContain('alpha');
    const alpha = onCurvePoints(curvePath(container, 'var(--token-model-1)'));
    const total = onCurvePoints(curvePath(container, 'var(--foreground)'));
    expect(alpha.length).toBe(2);
    expect(alpha[0]?.x).toBeCloseTo(total[0]?.x ?? Number.NaN);
  });

  it('marks a multi-point model that is zoomed down to a single visible point, and reset restores it dotless', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha'],
        [
          { cumulative: [0], totalCumulative: 0 },
          { cumulative: [0], totalCumulative: 0 },
          { cumulative: [5], totalCumulative: 5 },
          { cumulative: [8], totalCumulative: 8 },
        ],
      ),
    );

    expect(container.querySelectorAll('.recharts-line-dot').length).toBe(0);
    const total = onCurvePoints(curvePath(container, 'var(--foreground)'));

    await dragZoom(container, total[1]?.x ?? 0, total[2]?.x ?? 0);
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeInTheDocument();

    const dots = [...container.querySelectorAll('.recharts-line-dot')];
    expect(dots.length).toBe(1);
    const zoomedTotal = onCurvePoints(curvePath(container, 'var(--foreground)'));
    expect(Number(dots[0]?.getAttribute('cx'))).toBeCloseTo(zoomedTotal.at(-1)?.x ?? Number.NaN);
    expect(Number(dots[0]?.getAttribute('cy'))).toBeCloseTo(zoomedTotal.at(-1)?.y ?? Number.NaN);

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot').length).toBe(0));
  });

  it('does not invent a marker when the zoom range holds no visible model points', async () => {
    const { container } = await renderChart(
      timelinePayload(
        ['alpha'],
        [
          { cumulative: [0], totalCumulative: 0 },
          { cumulative: [0], totalCumulative: 0 },
          { cumulative: [5], totalCumulative: 5 },
          { cumulative: [8], totalCumulative: 8 },
        ],
      ),
    );
    const total = onCurvePoints(curvePath(container, 'var(--foreground)'));

    await dragZoom(container, total[0]?.x ?? 0, total[1]?.x ?? 0);
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-line-dot').length).toBe(0);
    expect(legendNames(container)).toContain('alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reset zoom' })).not.toBeInTheDocument(),
    );
  });

  it('leaves the total line untouched when model visibility changes', async () => {
    const first = await renderChart(
      timelinePayload(
        ['alpha'],
        [
          { cumulative: [0], totalCumulative: 0 },
          { cumulative: [9], totalCumulative: 9 },
          { cumulative: [9], totalCumulative: 9 },
        ],
      ),
    );
    const firstTotal = curvePath(first.container, 'var(--foreground)');
    first.unmount();

    const second = await renderChart(
      timelinePayload(
        ['alpha'],
        [
          { cumulative: [0], totalCumulative: 0 },
          { cumulative: [0], totalCumulative: 9 },
          { cumulative: [0], totalCumulative: 9 },
        ],
      ),
    );
    expect(curvePath(second.container, 'var(--foreground)')).toBe(firstTotal);
  });
});

describe('TokenChart — F-7 guard', () => {
  it('renders an error state instead of a chart when delta/cumulative length mismatches series.length', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/timeline', () =>
        HttpResponse.json({
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
        }),
      ),
    );

    render(<TokenChart sessionId={PROFILE_ROOT_ID} />, {
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
      http.get('/api/sessions/:id/profile/timeline', () =>
        HttpResponse.json({
          ...mockProfileTimelineTree,
          points: [],
          spawns: [],
          excludedNullAtCount: 5,
        }),
      ),
    );

    render(<TokenChart sessionId={PROFILE_ROOT_ID} />, {
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
      http.get('/api/sessions/:id/profile/timeline', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ error: 'boom' }, { status: 500 });
        return HttpResponse.json(mockProfileTimelineTree);
      }),
    );

    render(<TokenChart sessionId={PROFILE_ROOT_ID} />, {
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
