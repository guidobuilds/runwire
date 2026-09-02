import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import { afterEach, describe, expect, test } from 'vitest';
import { buildAgentSpans } from '../../lib/timeline';
import { buildAgentTree } from '../../lib/tree';
import { KIND_COLOR } from '../charts/chart-theme';
import { makeSummary, metric } from '../session-detail/fixtures';
import { AgentTrack } from './AgentTrack';
import { TimelineProvider, useTimeline } from './TimelineContext';

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

describe('tooltip contract (name/start-end/duration/tokens/model/parent)', () => {
  test('every bar exposes its exact detail via a native SVG <title>, no hover needed to query it', () => {
    const view = renderTrack();
    const title = view.container.querySelector(
      'rect[data-agent-span="explore"] title',
    )?.textContent;
    expect(title).toContain('Name: Explore');
    expect(title).toContain('Start: 1:00');
    expect(title).toContain('End: 2:00');
    expect(title).toContain('Duration: 1:00');
    expect(title).toContain('Model: claude-explore');
    expect(title).toContain('Parent: root');
  });

  test('a root span with no parent reports "none"', () => {
    const view = renderTrack();
    const title = view.container.querySelector('rect[data-agent-span="root"] title')?.textContent;
    expect(title).toContain('Parent: none');
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
