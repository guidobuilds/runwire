import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import { afterEach, describe, expect, test } from 'vitest';
import type { TokenPoint } from '../../lib/timeline';
import { KIND_COLOR } from '../charts/chart-theme';
import { TimelineProvider, useTimeline } from './TimelineContext';
import { TokenTrack } from './TokenTrack';

afterEach(() => cleanup());

function point(overrides: Partial<TokenPoint> = {}): TokenPoint {
  return {
    id: 'call:s1#0',
    agentId: 's1',
    at: 0,
    cumulative: 10,
    delta: 10,
    input: 6,
    output: 4,
    model: 'claude-x',
    ...overrides,
  };
}

/** Renders inside a real `TimelineProvider`, matching every other track's contract of reading `xScale`/`width`/`setCursorTime` from context rather than owning them. */
function renderTrack(points: readonly TokenPoint[], domain: readonly [number, number] = [0, 1000]) {
  return render(
    <TimelineProvider domain={domain} width={480}>
      <TokenTrack points={points} />
    </TimelineProvider>,
  );
}

describe('empty state', () => {
  test('zero points renders an explicit empty state, not a blank chart', () => {
    const view = renderTrack([]);
    expect(screen.getByText('No token usage data')).not.toBeNull();
    expect(view.container.querySelector('svg')).toBeNull();
  });
});

describe('data -> mark mapping', () => {
  test('one circle marker per TokenPoint, positioned at xScale(point.at) against the shared domain', () => {
    const points = [
      point({ id: 'a', at: 0 }),
      point({ id: 'b', at: 500 }),
      point({ id: 'c', at: 1000 }),
    ];
    const view = renderTrack(points, [0, 1000]);
    const xScale = scaleLinear<number>({ domain: [0, 1000], range: [0, 480] });
    const circles = view.container.querySelectorAll('circle[data-token-point]');
    expect(circles.length).toBe(3);
    expect(Number(circles[0]?.getAttribute('cx'))).toBeCloseTo(xScale(0));
    expect(Number(circles[1]?.getAttribute('cx'))).toBeCloseTo(xScale(500));
    expect(Number(circles[2]?.getAttribute('cx'))).toBeCloseTo(xScale(1000));
  });

  test('markers are colored via KIND_COLOR.model (var() token, never a literal hex)', () => {
    const view = renderTrack([point()]);
    const circle = view.container.querySelector('circle[data-token-point]');
    expect(circle?.getAttribute('fill')).toBe(KIND_COLOR.model);
    expect(circle?.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  test('an AreaClosed fill and a LinePath stroke are both drawn under/along the series', () => {
    const view = renderTrack([
      point({ id: 'a', at: 0 }),
      point({ id: 'b', at: 500, cumulative: 20 }),
    ]);
    expect(view.container.querySelector('path')).not.toBeNull();
    // AreaClosed + LinePath both render <path> elements.
    expect(view.container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
  });
});

describe('tooltip contract (timestamp/cumulative/delta/input/output/agent/model)', () => {
  test('every marker exposes its exact detail via a native SVG <title>, no hover needed to query it', () => {
    const view = renderTrack([
      point({
        id: 'a',
        at: 61_000,
        cumulative: 100,
        delta: 40,
        input: 25,
        output: 15,
        agentId: 'sess-1',
        model: 'claude-x',
      }),
    ]);
    const title = view.container.querySelector('circle[data-token-point] title')?.textContent;
    expect(title).toContain('Timestamp: 1:01');
    expect(title).toContain('Cumulative: 100');
    expect(title).toContain('Delta: 40');
    expect(title).toContain('Input: 25');
    expect(title).toContain('Output: 15');
    expect(title).toContain('Agent: sess-1');
    expect(title).toContain('Model: claude-x');
  });
});

describe('shared cursor wiring', () => {
  function Readout() {
    const { cursorTime } = useTimeline();
    return <div data-testid="cursor">{String(cursorTime)}</div>;
  }

  test('hovering the track calls setCursorTime with a domain value derived from the pointer position', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack
          points={[point({ id: 'a', at: 0 }), point({ id: 'b', at: 1000, cumulative: 20 })]}
        />
        <Readout />
      </TimelineProvider>,
    );

    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('expected an svg element');
    // happy-dom's getBoundingClientRect defaults to a zeroed rect unless
    // stubbed; stub it to a known 480px-wide box aligned with the nominal
    // viewBox width so the pixel->domain math is exact, not coincidental.
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 480,
        top: 0,
        right: 480,
        bottom: 64,
        height: 64,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(svg, { clientX: 240 });
    expect(view.getByTestId('cursor').textContent).toBe('500');
  });

  test('mouse leave clears the cursor back to null', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack points={[point({ id: 'a', at: 0 })]} />
        <Readout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('expected an svg element');
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 480,
        top: 0,
        right: 480,
        bottom: 64,
        height: 64,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(svg, { clientX: 240 });
    expect(view.getByTestId('cursor').textContent).toBe('500');
    fireEvent.mouseLeave(svg);
    expect(view.getByTestId('cursor').textContent).toBe('null');
  });
});

describe('click-to-select (f6)', () => {
  function SelectionProbe() {
    const { selectedEventId } = useTimeline();
    return <div data-testid="selection">{selectedEventId ?? 'null'}</div>;
  }

  test('clicking a marker sets selectedEventId to that TokenPoint.id', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack points={[point({ id: 'a', at: 0 }), point({ id: 'b', at: 500 })]} />
        <SelectionProbe />
      </TimelineProvider>,
    );
    expect(view.getByTestId('selection').textContent).toBe('null');
    const marker = view.container.querySelector('circle[data-token-point="b"]');
    if (!marker) throw new Error('expected marker b');
    fireEvent.click(marker);
    expect(view.getByTestId('selection').textContent).toBe('b');
  });

  test('clicking empty svg space (no marker under the pointer) leaves selection unchanged', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack points={[point({ id: 'a', at: 0 })]} />
        <SelectionProbe />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('expected an svg element');
    fireEvent.click(svg);
    expect(view.getByTestId('selection').textContent).toBe('null');
  });
});
