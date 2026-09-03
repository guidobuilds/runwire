import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import { useRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import type { TokenPoint } from '../../lib/timeline';
import { HOVER_DIM_OPACITY, KIND_COLOR } from '../charts/chart-theme';
import { TimelineProvider, useTimeline } from './TimelineContext';
import { TokenTrack } from './TokenTrack';

/** Stubs `getBoundingClientRect` to a known 480x64 box, matching the "shared cursor wiring" tests' pattern -- happy-dom defaults to a zeroed rect otherwise. */
function stubRect(svg: SVGSVGElement) {
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
}

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
  /** Reads `hoveredMark` from context; renders `renders` so the perf test below can assert bail-out (no re-render) instead of a tautological call count. */
  function Readout() {
    const { hoveredMark } = useTimeline();
    const renders = useRef(0);
    renders.current += 1;
    return (
      <>
        <div data-testid="mark">{hoveredMark?.content ?? 'null'}</div>
        <div data-testid="mark-pos">
          {hoveredMark ? `${hoveredMark.clientX},${hoveredMark.clientY}` : 'null'}
        </div>
        <div data-testid="render-count">{renders.current}</div>
      </>
    );
  }

  test('hovering a marker exposes its exact detail via the shared hoveredMark, no native <title> present', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack
          points={[
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
          ]}
        />
        <Readout />
      </TimelineProvider>,
    );

    // The native <title> element is gone entirely -- MarkTooltip (mounted
    // once elsewhere) is the only tooltip surface now.
    expect(view.container.querySelector('circle[data-token-point] title')).toBeNull();

    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('expected an svg element');
    stubRect(svg);
    const marker = view.container.querySelector('circle[data-token-point="a"]');
    if (!marker) throw new Error('expected marker a');

    fireEvent.mouseMove(marker, { clientX: 10, clientY: 20 });

    const mark = view.getByTestId('mark').textContent;
    expect(mark).toContain('Timestamp: 1:01');
    expect(mark).toContain('Cumulative: 100');
    expect(mark).toContain('Delta: 40');
    expect(mark).toContain('Input: 25');
    expect(mark).toContain('Output: 15');
    expect(mark).toContain('Agent: sess-1');
    expect(mark).toContain('Model: claude-x');
    expect(view.getByTestId('mark-pos').textContent).toBe('10,20');
  });

  test('mouse leave clears hoveredMark back to null', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack points={[point({ id: 'a', at: 0 })]} />
        <Readout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('expected an svg element');
    stubRect(svg);
    const marker = view.container.querySelector('circle[data-token-point="a"]');
    if (!marker) throw new Error('expected marker a');

    fireEvent.mouseMove(marker, { clientX: 10, clientY: 20 });
    expect(view.getByTestId('mark').textContent).not.toBe('null');
    fireEvent.mouseLeave(svg);
    expect(view.getByTestId('mark').textContent).toBe('null');
  });

  test('unchanged-hit-skip: repeated mousemove ticks over the same marker do not re-invoke setHoveredMark (no consumer re-render), but moving to a different marker does', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack
          points={[point({ id: 'a', at: 0 }), point({ id: 'b', at: 500, cumulative: 20 })]}
        />
        <Readout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('expected an svg element');
    stubRect(svg);
    const markerA = view.container.querySelector('circle[data-token-point="a"]');
    const markerB = view.container.querySelector('circle[data-token-point="b"]');
    if (!markerA || !markerB) throw new Error('expected markers a and b');

    // First hit on `a`: hoveredMark transitions from null -> a's content, so
    // Readout (a context consumer) is expected to re-render.
    fireEvent.mouseMove(markerA, { clientX: 1, clientY: 1 });
    const countAfterFirstHitOnA = Number(view.getByTestId('render-count').textContent);
    expect(view.getByTestId('mark').textContent).toContain('Agent: s1');

    // Two more ticks at the EXACT same clientX/clientY (guaranteed same hit
    // target, and also the same `cursorTime` domain value, so this isolates
    // the hoveredMark skip from the unrelated always-fires setCursorTime
    // path) -- must be genuine no-ops: without the ref-based skip,
    // `setHoveredMark` would receive a brand-new object literal each time
    // (identity always differs even when `content` is equal), which would
    // bump `render-count` on every single tick.
    fireEvent.mouseMove(markerA, { clientX: 1, clientY: 1 });
    fireEvent.mouseMove(markerA, { clientX: 1, clientY: 1 });
    expect(Number(view.getByTestId('render-count').textContent)).toBe(countAfterFirstHitOnA);

    // Moving onto a genuinely different mark IS a real transition and must
    // re-render (proves the mechanism isn't just permanently frozen).
    fireEvent.mouseMove(markerB, { clientX: 4, clientY: 4 });
    expect(Number(view.getByTestId('render-count').textContent)).toBeGreaterThan(
      countAfterFirstHitOnA,
    );
    expect(view.getByTestId('mark').textContent).toContain('Agent: s1');
  });

  test('keyboard parity: focusing a marker sets hoveredMark, blurring clears it', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack points={[point({ id: 'a', at: 0, agentId: 'sess-1' })]} />
        <Readout />
      </TimelineProvider>,
    );
    const marker = view.container.querySelector('circle[data-token-point="a"]');
    if (!marker) throw new Error('expected marker a');

    expect(view.getByTestId('mark').textContent).toBe('null');
    fireEvent.focus(marker);
    expect(view.getByTestId('mark').textContent).toContain('Agent: sess-1');
    fireEvent.blur(marker);
    expect(view.getByTestId('mark').textContent).toBe('null');
  });
});

describe('hover-dim by agent (f1-t3)', () => {
  test('with no hoveredAgentId, neither marker is dimmed (baseline unchanged)', () => {
    const view = renderTrack([
      point({ id: 'a', at: 0, agentId: 'agent-1' }),
      point({ id: 'b', at: 500, agentId: 'agent-2' }),
    ]);
    const a = view.container.querySelector('circle[data-token-point="a"]');
    const b = view.container.querySelector('circle[data-token-point="b"]');
    for (const el of [a, b]) {
      const opacity = el?.getAttribute('fill-opacity');
      expect(opacity === null || opacity === '1').toBe(true);
    }
  });

  test('with a hoveredAgentId set, the non-matching marker dims to HOVER_DIM_OPACITY and the matching one stays undimmed', () => {
    function HoverSetter() {
      const { setHoveredAgentId } = useTimeline();
      return (
        <button
          type="button"
          data-testid="hover-agent-1"
          onClick={() => setHoveredAgentId('agent-1')}
        >
          hover
        </button>
      );
    }

    const view = render(
      <TimelineProvider domain={[0, 1000]} width={480}>
        <TokenTrack
          points={[
            point({ id: 'a', at: 0, agentId: 'agent-1' }),
            point({ id: 'b', at: 500, agentId: 'agent-2' }),
          ]}
        />
        <HoverSetter />
      </TimelineProvider>,
    );

    fireEvent.click(view.getByTestId('hover-agent-1'));

    const a = view.container.querySelector('circle[data-token-point="a"]');
    const b = view.container.querySelector('circle[data-token-point="b"]');
    const aOpacity = a?.getAttribute('fill-opacity');
    expect(aOpacity === null || aOpacity === '1').toBe(true);
    expect(b?.getAttribute('fill-opacity')).toBe(String(HOVER_DIM_OPACITY));
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
