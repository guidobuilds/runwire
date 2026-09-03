import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildAgentSpans } from '../../lib/timeline';
import { buildAgentTree } from '../../lib/tree';
import { HOVER_DIM_OPACITY, KIND_COLOR } from '../charts/chart-theme';
import { makeSummary, metric } from '../session-detail/fixtures';
import { AgentTrack } from './AgentTrack';
import { AGENT_ROW_HEIGHT_PRESETS, TimelineProvider, useTimeline } from './TimelineContext';

/**
 * `AgentTrack`'s "Quick view" popup mounts `AgentTimelineOverlay`, which
 * mounts the real `SessionTimeline` -- mocked here so this file stays
 * scoped to AgentTrack's own contract (which agentId opened it, not whether
 * SessionTimeline's own data pipeline renders correctly, already covered by
 * SessionTimeline.test.tsx/AgentTimelineOverlay.test.tsx).
 */
vi.mock('./SessionTimeline', () => ({
  SessionTimeline: ({ id }: { id: string }) => (
    <div data-testid="quick-view-session-timeline">{id}</div>
  ),
}));

afterEach(() => cleanup());

const ROOT_ANCHOR = '2026-08-31T09:00:00.000Z';

/**
 * A real multi-agent subtree: root -> explore (depth 1) -> deep (depth 2),
 * plus a sibling plan (depth 1) that starts later. `flattenTree`'s DFS order
 * on this shape is root, explore, deep, plan (explore's subtree is walked
 * before its sibling plan) -- distinct from summaries-array order, so an
 * ordering bug (e.g. rendering the raw subtree array instead of the flattened
 * tree) would produce a different, observably wrong lane order.
 */
const SUMMARIES = [
  makeSummary({
    id: 'root',
    depth: 0,
    timing: { startedAt: metric(ROOT_ANCHOR), endedAt: metric('2026-08-31T09:10:00.000Z') },
  }),
  makeSummary({
    id: 'explore',
    parentId: 'root',
    depth: 1,
    relation: 'subagent',
    agentType: 'Explore',
    model: { primary: metric('claude-explore'), all: [], changes: 0 },
    timing: {
      startedAt: metric('2026-08-31T09:01:00.000Z'),
      endedAt: metric('2026-08-31T09:02:00.000Z'),
    },
  }),
  makeSummary({
    id: 'deep',
    parentId: 'explore',
    depth: 2,
    relation: 'subagent',
    agentType: 'Deep',
    timing: {
      startedAt: metric('2026-08-31T09:01:30.000Z'),
      endedAt: metric('2026-08-31T09:01:45.000Z'),
    },
  }),
  makeSummary({
    id: 'plan',
    parentId: 'root',
    depth: 1,
    relation: 'subagent',
    agentType: 'Plan',
    timing: {
      startedAt: metric('2026-08-31T09:03:00.000Z'),
      endedAt: metric('2026-08-31T09:04:00.000Z'),
    },
  }),
];

function fixture() {
  const root = buildAgentTree('root', SUMMARIES);
  if (!root) throw new Error('fixture root missing');
  const spans = buildAgentSpans(ROOT_ANCHOR, SUMMARIES);
  return { root, spans };
}

function renderTrack(domain: readonly [number, number] = [0, 600_000]) {
  const { root, spans } = fixture();
  return render(
    <TimelineProvider domain={domain} width={480}>
      <AgentTrack root={root} spans={spans} />
    </TimelineProvider>,
  );
}

/** Stubs `getBoundingClientRect` to a known box for a given SVG lane, matching TokenTrack/HarnessTrack's pattern -- happy-dom defaults to a zeroed rect otherwise. */
function stubRect(svg: SVGSVGElement, height: number) {
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      width: 480,
      top: 0,
      right: 480,
      bottom: height,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Mounts `AgentTrack` (inside `TimelineProvider`) as the index route of a
 * real in-memory router with a `/sessions/$id` sibling route -- required for
 * "Go to session" (`useNavigate`) to actually navigate rather than silently
 * no-op, matching `CommandPalette.test.tsx`/`SessionHeader.test.tsx`'s own
 * established router-test-harness pattern.
 */
async function renderInRouter(ui: ReactNode) {
  let openedSessionId: string | null = null;
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions/$id',
    component: () => {
      const { id } = sessionRoute.useParams();
      openedSessionId = id;
      return <p>session route {id}</p>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router as never} />);
  return { view, getOpenedSessionId: () => openedSessionId };
}

describe('lane ordering via flattenTree', () => {
  test('renders exactly one lane per subtree member (4 summaries -> 4 lanes)', () => {
    const view = renderTrack();
    expect(view.container.querySelectorAll('[data-slot="agent-track"] > div').length).toBe(4);
  });

  test('lanes render in DFS order (root, explore, deep, plan) -- deep before plan, not summaries-array order', () => {
    const view = renderTrack();
    const labels = Array.from(
      view.container.querySelectorAll('[data-slot="agent-track"] > div'),
    ).map((row) => row.querySelector('span > span')?.textContent);
    expect(labels).toEqual(['root', 'Explore', 'Deep', 'Plan']);
  });

  test("lane indentation reuses AgentTree.tsx's depthPaddingClass (pl-0/pl-4/pl-8 for depth 0/1/2)", () => {
    const view = renderTrack();
    const labelWrappers = view.container.querySelectorAll('[data-slot="agent-track"] > div > span');
    expect(labelWrappers[0]?.className).toContain('pl-0');
    expect(labelWrappers[1]?.className).toContain('pl-4');
    expect(labelWrappers[2]?.className).toContain('pl-8');
    expect(labelWrappers[3]?.className).toContain('pl-4');
  });
});

describe('bar geometry', () => {
  test('a bar spans xScale(start) -> xScale(end), colored via KIND_COLOR.agent', () => {
    const view = renderTrack();
    const xScale = scaleLinear<number>({ domain: [0, 600_000], range: [0, 480] });
    // explore: started 60_000ms after root anchor, ended 120_000ms after.
    const exploreBar = view.container.querySelector('rect[data-agent-span="explore"]');
    expect(exploreBar).not.toBeNull();
    expect(Number(exploreBar?.getAttribute('x'))).toBeCloseTo(xScale(60_000));
    const expectedWidth = xScale(120_000) - xScale(60_000);
    expect(Number(exploreBar?.getAttribute('width'))).toBeCloseTo(expectedWidth);
    expect(exploreBar?.getAttribute('fill')).toBe(KIND_COLOR.agent);
    expect(exploreBar?.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(exploreBar?.getAttribute('opacity')).toBe('1');
  });

  test('a span missing one bound renders an open bar clipped to the domain edge, plus a ConfidenceDot in the row label, instead of a zero-width mark', () => {
    const openSummaries = [
      makeSummary({
        id: 'root',
        depth: 0,
        timing: { startedAt: metric(ROOT_ANCHOR), endedAt: metric('2026-08-31T09:10:00.000Z') },
      }),
      makeSummary({
        id: 'open-child',
        parentId: 'root',
        depth: 1,
        relation: 'subagent',
        agentType: 'OpenChild',
        // endedAt entirely absent -> AgentSpan.end is undefined, not just low confidence.
        timing: { startedAt: metric('2026-08-31T09:02:00.000Z') },
      }),
    ];
    const root = buildAgentTree('root', openSummaries);
    if (!root) throw new Error('fixture root missing');
    const spans = buildAgentSpans(ROOT_ANCHOR, openSummaries);

    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
      </TimelineProvider>,
    );

    const xScale = scaleLinear<number>({ domain: [0, 600_000], range: [0, 480] });
    const bar = view.container.querySelector('rect[data-agent-span="open-child"]');
    expect(bar).not.toBeNull();
    // start = elapsed 120_000ms; end is unknown -> clipped to domainMax (600_000).
    expect(Number(bar?.getAttribute('x'))).toBeCloseTo(xScale(120_000));
    expect(Number(bar?.getAttribute('width'))).toBeCloseTo(xScale(600_000) - xScale(120_000));
    expect(Number(bar?.getAttribute('width'))).toBeGreaterThan(1);
    expect(screen.getByRole('img', { name: 'low confidence' })).not.toBeNull();
  });

  test('medium/low confidenceLevel renders at reduced opacity (0.6), independent of bar geometry', () => {
    const lowConfSummaries = [
      makeSummary({ id: 'root', depth: 0, timing: { startedAt: metric(ROOT_ANCHOR) } }),
      makeSummary({
        id: 'shaky',
        parentId: 'root',
        depth: 1,
        relation: 'subagent',
        agentType: 'Shaky',
        timing: {
          startedAt: metric('2026-08-31T09:01:00.000Z', { confidence: 'medium' }),
          endedAt: metric('2026-08-31T09:02:00.000Z', { confidence: 'medium' }),
        },
      }),
    ];
    const root = buildAgentTree('root', lowConfSummaries);
    if (!root) throw new Error('fixture root missing');
    const spans = buildAgentSpans(ROOT_ANCHOR, lowConfSummaries);

    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
      </TimelineProvider>,
    );
    const bar = view.container.querySelector('rect[data-agent-span="shaky"]');
    expect(bar?.getAttribute('opacity')).toBe('0.6');
  });
});

describe('tooltip contract (name/start-end/duration/tokens/model/parent, f2-t3)', () => {
  /** Reads `hoveredMark` from context; renders a render-count probe so the perf test below can assert bail-out (no re-render) instead of a tautological call count. */
  function Readout() {
    const { hoveredMark } = useTimeline();
    const renders = useRef(0);
    renders.current += 1;
    return (
      <>
        <div data-testid="mark">{hoveredMark?.content ?? 'null'}</div>
        <div data-testid="render-count">{renders.current}</div>
      </>
    );
  }

  test('the native <title> element is gone entirely -- MarkTooltip is the only tooltip surface now', () => {
    const view = renderTrack();
    expect(view.container.querySelector('rect[data-agent-span] title')).toBeNull();
  });

  test('hovering a bar exposes its exact detail via the shared hoveredMark', () => {
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={fixture().root} spans={fixture().spans} />
        <Readout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg[aria-label="Explore span"]');
    if (!svg) throw new Error('expected the explore lane svg');
    stubRect(svg as SVGSVGElement, 22);
    const bar = view.container.querySelector('rect[data-agent-span="explore"]');
    if (!bar) throw new Error('expected explore bar');

    fireEvent.mouseMove(bar, { clientX: 10, clientY: 20 });

    const mark = view.getByTestId('mark').textContent;
    expect(mark).toContain('Name: Explore');
    expect(mark).toContain('Start: 1:00');
    expect(mark).toContain('End: 2:00');
    expect(mark).toContain('Duration: 1:00');
    expect(mark).toContain('Model: claude-explore');
    expect(mark).toContain('Parent: root');
  });

  test('a root span with no parent reports "none"', () => {
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={fixture().root} spans={fixture().spans} />
        <Readout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg[aria-label="root span"]');
    if (!svg) throw new Error('expected the root lane svg');
    stubRect(svg as SVGSVGElement, 22);
    const bar = view.container.querySelector('rect[data-agent-span="root"]');
    if (!bar) throw new Error('expected root bar');

    fireEvent.mouseMove(bar, { clientX: 10, clientY: 20 });
    expect(view.getByTestId('mark').textContent).toContain('Parent: none');
  });

  test('mouse leave clears hoveredMark back to null', () => {
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={fixture().root} spans={fixture().spans} />
        <Readout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg[aria-label="Explore span"]');
    if (!svg) throw new Error('expected the explore lane svg');
    stubRect(svg as SVGSVGElement, 22);
    const bar = view.container.querySelector('rect[data-agent-span="explore"]');
    if (!bar) throw new Error('expected explore bar');

    fireEvent.mouseMove(bar, { clientX: 10, clientY: 20 });
    expect(view.getByTestId('mark').textContent).not.toBe('null');
    fireEvent.mouseLeave(svg);
    expect(view.getByTestId('mark').textContent).toBe('null');
  });

  test('unchanged-hit-skip: repeated mousemove ticks over the same bar do not re-invoke setHoveredMark (no consumer re-render), but moving to a different bar does', () => {
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={fixture().root} spans={fixture().spans} />
        <Readout />
      </TimelineProvider>,
    );
    const exploreSvg = view.container.querySelector('svg[aria-label="Explore span"]');
    const planSvg = view.container.querySelector('svg[aria-label="Plan span"]');
    if (!exploreSvg || !planSvg) throw new Error('expected explore and plan lane svgs');
    stubRect(exploreSvg as SVGSVGElement, 22);
    stubRect(planSvg as SVGSVGElement, 22);
    const exploreBar = view.container.querySelector('rect[data-agent-span="explore"]');
    const planBar = view.container.querySelector('rect[data-agent-span="plan"]');
    if (!exploreBar || !planBar) throw new Error('expected explore and plan bars');

    fireEvent.mouseMove(exploreBar, { clientX: 1, clientY: 1 });
    const countAfterFirstHit = Number(view.getByTestId('render-count').textContent);
    expect(view.getByTestId('mark').textContent).toContain('Name: Explore');

    fireEvent.mouseMove(exploreBar, { clientX: 1, clientY: 1 });
    fireEvent.mouseMove(exploreBar, { clientX: 1, clientY: 1 });
    expect(Number(view.getByTestId('render-count').textContent)).toBe(countAfterFirstHit);

    fireEvent.mouseMove(planBar, { clientX: 4, clientY: 4 });
    expect(Number(view.getByTestId('render-count').textContent)).toBeGreaterThan(
      countAfterFirstHit,
    );
    expect(view.getByTestId('mark').textContent).toContain('Name: Plan');
  });

  test('keyboard parity: focusing a bar sets hoveredMark, blurring clears it', () => {
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={fixture().root} spans={fixture().spans} />
        <Readout />
      </TimelineProvider>,
    );
    const bar = view.container.querySelector('rect[data-agent-span="explore"]');
    if (!bar) throw new Error('expected explore bar');

    expect(view.getByTestId('mark').textContent).toBe('null');
    fireEvent.focus(bar);
    expect(view.getByTestId('mark').textContent).toContain('Name: Explore');
    fireEvent.blur(bar);
    expect(view.getByTestId('mark').textContent).toBe('null');
  });
});

describe('hover-dim by agent (f2-t3)', () => {
  test('with no hoveredAgentId, no bar is dimmed (baseline unchanged)', () => {
    const view = renderTrack();
    const exploreBar = view.container.querySelector('rect[data-agent-span="explore"]');
    expect(exploreBar?.getAttribute('opacity')).toBe('1');
  });

  test('hovering a lane row (mouseenter on the row div, not just the bar) dims every OTHER lane bar to HOVER_DIM_OPACITY, leaving its own bar undimmed', () => {
    const view = renderTrack();
    const rows = view.container.querySelectorAll('[data-slot="agent-track"] > div');
    const exploreRow = rows[1]; // root, explore, deep, plan
    if (!exploreRow) throw new Error('expected explore row');

    fireEvent.mouseEnter(exploreRow);

    const exploreBar = view.container.querySelector('rect[data-agent-span="explore"]');
    const planBar = view.container.querySelector('rect[data-agent-span="plan"]');
    expect(exploreBar?.getAttribute('opacity')).toBe('1');
    expect(planBar?.getAttribute('opacity')).toBe(String(HOVER_DIM_OPACITY));

    fireEvent.mouseLeave(exploreRow);
    expect(planBar?.getAttribute('opacity')).toBe('1');
  });

  test('HOVER_DIM_OPACITY overrides (not multiplies) CONFIDENCE_OPACITY on a non-matching medium-confidence bar', () => {
    const summaries = [
      makeSummary({ id: 'root', depth: 0, timing: { startedAt: metric(ROOT_ANCHOR) } }),
      makeSummary({
        id: 'shaky',
        parentId: 'root',
        depth: 1,
        relation: 'subagent',
        agentType: 'Shaky',
        timing: {
          startedAt: metric('2026-08-31T09:01:00.000Z', { confidence: 'medium' }),
          endedAt: metric('2026-08-31T09:02:00.000Z', { confidence: 'medium' }),
        },
      }),
    ];
    const root = buildAgentTree('root', summaries);
    if (!root) throw new Error('fixture root missing');
    const spans = buildAgentSpans(ROOT_ANCHOR, summaries);
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
      </TimelineProvider>,
    );
    // Baseline (no hover): medium confidence -> 0.6, matching the existing contract.
    const shakyBar = view.container.querySelector('rect[data-agent-span="shaky"]');
    expect(shakyBar?.getAttribute('opacity')).toBe('0.6');

    const rows = view.container.querySelectorAll('[data-slot="agent-track"] > div');
    const rootRow = rows[0];
    if (!rootRow) throw new Error('expected root row');
    fireEvent.mouseEnter(rootRow);

    // Hovering root now dims the non-matching, medium-confidence "shaky" bar
    // to HOVER_DIM_OPACITY -- not 0.6, and not CONFIDENCE_OPACITY * HOVER_DIM_OPACITY.
    expect(shakyBar?.getAttribute('opacity')).toBe(String(HOVER_DIM_OPACITY));
  });
});

describe('label tooltip (f2-t4)', () => {
  test('the always-visible model span is gone from the row DOM', () => {
    const view = renderTrack();
    expect(view.container.textContent).not.toContain('claude-explore');
  });

  test("the Tooltip trigger's title attribute carries the combined 'name - model' string when a model is present", () => {
    const view = renderTrack();
    const exploreRow = Array.from(
      view.container.querySelectorAll('[data-slot="agent-track"] > div'),
    ).find((row) => row.textContent?.includes('Explore'));
    if (!exploreRow) throw new Error('expected explore row');
    const titledSpan = exploreRow.querySelector('span[title]');
    expect(titledSpan?.getAttribute('title')).toBe('Explore - claude-explore');
  });

  test('a lane with no model gets just the bare name as tooltip content', () => {
    const view = renderTrack();
    const rootRow = Array.from(
      view.container.querySelectorAll('[data-slot="agent-track"] > div'),
    ).find((row) => row.textContent?.trim().startsWith('root'));
    if (!rootRow) throw new Error('expected root row');
    const titledSpan = rootRow.querySelector('span[title]');
    expect(titledSpan?.getAttribute('title')).toBe('root');
  });
});

describe('row density / dynamic height (f2-t1)', () => {
  test('at the default preset (22), rendered lane svg heights and bar heights are unchanged from pre-f2 behavior', () => {
    const view = renderTrack();
    const svg = view.container.querySelector('svg[aria-label="Explore span"]');
    expect(svg?.getAttribute('height')).toBe('22');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 480 22');
    const bar = view.container.querySelector('rect[data-agent-span="explore"]');
    expect(bar?.getAttribute('height')).toBe('12');
  });

  test('changing agentRowHeight via context changes rendered svg height and derived BAR_HEIGHT numerically', () => {
    function RowHeightSetter() {
      const { setAgentRowHeight } = useTimeline();
      return (
        <button type="button" data-testid="set-28" onClick={() => setAgentRowHeight(28)}>
          set-28
        </button>
      );
    }
    const { root, spans } = fixture();
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
        <RowHeightSetter />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByTestId('set-28'));
    const svg = view.container.querySelector('svg[aria-label="Explore span"]');
    expect(svg?.getAttribute('height')).toBe('28');
    const bar = view.container.querySelector('rect[data-agent-span="explore"]');
    // Math.max(28 - 10, 4) = 18.
    expect(bar?.getAttribute('height')).toBe('18');
  });

  test('AGENT_ROW_HEIGHT_PRESETS smallest preset (14) still floors BAR_HEIGHT at 4, not below', () => {
    function RowHeightSetter() {
      const { setAgentRowHeight } = useTimeline();
      return (
        <button
          type="button"
          data-testid="set-smallest"
          onClick={() => setAgentRowHeight(AGENT_ROW_HEIGHT_PRESETS[0] as number)}
        >
          set-smallest
        </button>
      );
    }
    const { root, spans } = fixture();
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
        <RowHeightSetter />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByTestId('set-smallest'));
    const bar = view.container.querySelector('rect[data-agent-span="explore"]');
    // Math.max(14 - 10, 4) = 4.
    expect(bar?.getAttribute('height')).toBe('4');
  });

  test('the outer scroll container caps maxHeight at Math.max(rawAvailableHeight, AGENT_TRACK_MIN_HEIGHT_PX) -- floor applies on a short viewport', () => {
    vi.stubGlobal('innerHeight', 50);
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 480,
      height: 22,
      top: 10,
      left: 0,
      right: 480,
      bottom: 32,
      x: 0,
      y: 10,
      toJSON() {
        return {};
      },
    } as DOMRect);

    const view = renderTrack();
    // raw = 50 - 10 - 24(bottom margin) = 16, well below the 88px floor.
    const scrollContainer = view.container.querySelector('[data-slot="agent-track-scroll"]');
    expect((scrollContainer as HTMLElement | null)?.style.maxHeight).toBe('88px');

    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('shared cursor wiring', () => {
  function Readout() {
    const { cursorTime } = useTimeline();
    return <div data-testid="cursor">{String(cursorTime)}</div>;
  }

  test('hovering a lane calls setCursorTime with a domain value derived from the pointer position', () => {
    const { root, spans } = fixture();
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
        <Readout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg[aria-label="root span"]');
    if (!svg) throw new Error('expected the root lane svg');
    (svg as SVGSVGElement).getBoundingClientRect = () =>
      ({
        left: 0,
        width: 480,
        top: 0,
        right: 480,
        bottom: 22,
        height: 22,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(svg, { clientX: 240 });
    expect(view.getByTestId('cursor').textContent).toBe('300000');

    fireEvent.mouseLeave(svg);
    expect(view.getByTestId('cursor').textContent).toBe('null');
  });
});

describe('click-to-select (f6)', () => {
  function SelectionProbe() {
    const { selectedEventId } = useTimeline();
    return <div data-testid="selection">{selectedEventId ?? 'null'}</div>;
  }

  test('clicking a bar sets selectedEventId to that AgentSpan.id', () => {
    const { root, spans } = fixture();
    const view = render(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
        <SelectionProbe />
      </TimelineProvider>,
    );
    expect(view.getByTestId('selection').textContent).toBe('null');
    const bar = view.container.querySelector('rect[data-agent-span="explore"]');
    if (!bar) throw new Error('expected explore bar');
    fireEvent.click(bar);
    expect(view.getByTestId('selection').textContent).toBe('explore');
  });
});

describe('click-to-popup: Quick view / Go to session (f2-t5)', () => {
  function renderInRouterWithTimeline() {
    const { root, spans } = fixture();
    return renderInRouter(
      <TimelineProvider domain={[0, 600_000]} width={480}>
        <AgentTrack root={root} spans={spans} />
      </TimelineProvider>,
    );
  }

  test('the root row (depth 0) has no Popover/PopoverTrigger affordance at all -- no button rendered for its label', async () => {
    await renderInRouterWithTimeline();
    expect(screen.queryByRole('button', { name: 'root' })).toBeNull();
  });

  test('clicking a non-root row label opens a popup with Quick view / Go to session rows', async () => {
    await renderInRouterWithTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
    expect(await screen.findByText('Quick view')).not.toBeNull();
    expect(screen.getByText('Go to session')).not.toBeNull();
  });

  test("clicking 'Quick view' opens the overlay with THAT row's own agentId, not the root's or a hardcoded one, and does not navigate", async () => {
    const { getOpenedSessionId } = await renderInRouterWithTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Deep' }));
    fireEvent.click(await screen.findByText('Quick view'));

    const overlay = await screen.findByTestId('quick-view-session-timeline');
    expect(overlay.textContent).toBe('deep');
    expect(getOpenedSessionId()).toBeNull();
  });

  test("clicking 'Go to session' navigates to /sessions/$id with THAT row's own agentId and does not open the overlay", async () => {
    const { getOpenedSessionId } = await renderInRouterWithTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    fireEvent.click(await screen.findByText('Go to session'));

    await waitFor(() => expect(getOpenedSessionId()).toBe('plan'));
    expect(screen.queryByTestId('quick-view-session-timeline')).toBeNull();
  });
});
