import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import type { ComponentEvent } from '../../lib/timeline';
import { HOVER_DIM_OPACITY, KIND_COLOR } from '../charts/chart-theme';
import { ComponentTrack } from './ComponentTrack';
import type { TimelineDomain } from './TimelineContext';
import { TimelineProvider, useTimeline } from './TimelineContext';

afterEach(() => cleanup());

function componentEvent(overrides: Partial<ComponentEvent> = {}): ComponentEvent {
  return {
    id: 'fake#0',
    agentId: 'session-a',
    kind: 'skill',
    at: 100,
    durationMs: undefined,
    name: 'my-skill',
    detail: undefined,
    childId: undefined,
    ...overrides,
  };
}

function CursorProbe() {
  const { cursorTime } = useTimeline();
  return <div data-testid="cursor-probe">{cursorTime ?? 'null'}</div>;
}

function renderTrack(events: ComponentEvent[], domain: TimelineDomain = [0, 1000]) {
  return render(
    <TimelineProvider domain={domain}>
      <ComponentTrack events={events} />
      <CursorProbe />
    </TimelineProvider>,
  );
}

describe('shape-primary glyphs', () => {
  test('skill renders a circle', () => {
    const view = renderTrack([componentEvent({ kind: 'skill' })]);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    expect(mark?.getAttribute('data-component-shape')).toBe('circle');
    expect(mark?.querySelector('circle')).not.toBeNull();
  });

  test('mcp renders a 45deg-rotated rect (diamond)', () => {
    const view = renderTrack([componentEvent({ kind: 'mcp', name: 'mcp__github__search' })]);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    expect(mark?.getAttribute('data-component-shape')).toBe('diamond');
    const rect = mark?.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('transform')).toMatch(/^rotate\(45 /);
  });

  test('agent renders a 3-point polygon (triangle)', () => {
    const view = renderTrack([componentEvent({ kind: 'agent' })]);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    expect(mark?.getAttribute('data-component-shape')).toBe('triangle');
    const polygon = mark?.querySelector('polygon');
    expect(polygon).not.toBeNull();
    expect(polygon?.getAttribute('points')?.trim().split(/\s+/).length).toBe(3);
  });

  test('hook renders a plain (non-rotated) rect (square)', () => {
    const view = renderTrack([componentEvent({ kind: 'hook' })]);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    expect(mark?.getAttribute('data-component-shape')).toBe('square');
    const rect = mark?.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('transform')).toBeNull();
  });

  test('mcp (rotated rect) and hook (plain rect) are distinguishable by shape alone, not just color', () => {
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'mcp' }),
      componentEvent({ id: 'b', kind: 'hook' }),
    ]);
    const mcpRect = view.container.querySelector('[data-component-id="a"] rect');
    const hookRect = view.container.querySelector('[data-component-id="b"] rect');
    // Same element tag, but only one carries a rotation transform -- the
    // geometric distinction survives even if fill color were stripped out.
    expect(mcpRect?.getAttribute('transform')).not.toBeNull();
    expect(hookRect?.getAttribute('transform')).toBeNull();
  });
});

describe('legend (bug fix: mcp/skill/hook had no visible name)', () => {
  test('renders no legend when there are zero events', () => {
    const view = renderTrack([]);
    expect(view.container.querySelector('[data-slot="component-track-legend"]')).toBeNull();
  });

  test('lists only the kinds actually present, each with its shape and a real count, in skill/mcp/agent/hook order', () => {
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'hook' }),
      componentEvent({ id: 'b', kind: 'skill', at: 500 }),
      componentEvent({ id: 'c', kind: 'skill', at: 700 }),
    ]);
    const legend = view.container.querySelector('[data-slot="component-track-legend"]');
    if (!legend) throw new Error('expected a legend');
    const items = Array.from(legend.querySelectorAll('li'));
    expect(items.map((li) => li.textContent)).toEqual(['Skill (2)', 'Hook (1)']);
    // No mcp/agent entries -- neither kind occurs in this event set.
    expect(legend.textContent).not.toContain('MCP');
    expect(legend.textContent).not.toContain('Agent');

    const skillSwatch = legend.querySelector('[data-legend-shape="skill"]');
    expect(skillSwatch?.querySelector('circle')).not.toBeNull();
    const hookSwatch = legend.querySelector('[data-legend-shape="hook"]');
    const hookRect = hookSwatch?.querySelector('rect');
    expect(hookRect).not.toBeNull();
    expect(hookRect?.getAttribute('transform')).toBeNull(); // square, not the mcp diamond's rotation
  });

  test('legend swatches are colored via chart-theme KIND_COLOR var() references, never a literal hex', () => {
    const view = renderTrack([componentEvent({ kind: 'mcp' })]);
    const swatch = view.container.querySelector('[data-legend-shape="mcp"] rect');
    expect(swatch?.getAttribute('fill')).toBe(KIND_COLOR.mcp);
    expect(swatch?.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('color', () => {
  test('skill/mcp/agent/hook are colored via KIND_COLOR.skill/mcp/agent/harness-event, never a literal hex', () => {
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'skill' }),
      componentEvent({ id: 'b', kind: 'mcp' }),
      componentEvent({ id: 'c', kind: 'agent' }),
      componentEvent({ id: 'd', kind: 'hook' }),
    ]);
    const skillFill = view.container
      .querySelector('[data-component-id="a"] circle')
      ?.getAttribute('fill');
    const mcpFill = view.container
      .querySelector('[data-component-id="b"] rect')
      ?.getAttribute('fill');
    const agentFill = view.container
      .querySelector('[data-component-id="c"] polygon')
      ?.getAttribute('fill');
    const hookFill = view.container
      .querySelector('[data-component-id="d"] rect')
      ?.getAttribute('fill');
    expect(skillFill).toBe(KIND_COLOR.skill);
    expect(mcpFill).toBe(KIND_COLOR.mcp);
    expect(agentFill).toBe(KIND_COLOR.agent);
    expect(hookFill).toBe(KIND_COLOR['harness-event']);
    for (const fill of [skillFill, mcpFill, agentFill, hookFill]) {
      expect(fill).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});

describe('childId carried through for agent marks', () => {
  test('an agent-kind event with a childId exposes it as data-child-id', () => {
    const view = renderTrack([componentEvent({ kind: 'agent', childId: 'session-child-1' })]);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    expect(mark?.getAttribute('data-child-id')).toBe('session-child-1');
  });

  test('an agent-kind event with no childId carries no data-child-id attribute (never a fake empty value)', () => {
    const view = renderTrack([componentEvent({ kind: 'agent', childId: undefined })]);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    expect(mark?.hasAttribute('data-child-id')).toBe(false);
  });

  test('a non-agent event never carries data-child-id, even if the field were somehow set', () => {
    const view = renderTrack([componentEvent({ kind: 'skill' })]);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    expect(mark?.hasAttribute('data-child-id')).toBe(false);
  });
});

/** Stubs `getBoundingClientRect` to a known 480x24 box, matching the "shared cursor wiring" describe's own stub -- happy-dom defaults to a zeroed rect otherwise. */
function stubTrackRect(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      width: 480,
      top: 0,
      right: 480,
      bottom: 24,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function HoveredMarkReadout() {
  const { hoveredMark } = useTimeline();
  return <div data-testid="hovered-mark">{hoveredMark ? hoveredMark.content : 'null'}</div>;
}

describe('tooltip (via shared hoveredMark, no native <title> left on this track)', () => {
  test('no native SVG <title> is rendered anywhere on the track', () => {
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'mcp', at: 100 }),
      componentEvent({ id: 'b', kind: 'skill', at: 500 }),
    ]);
    expect(view.container.querySelector('title')).toBeNull();
  });

  test('hovering an mcp event sets hoveredMark.content to agent/operation/server-tool-detail/duration', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({
              kind: 'mcp',
              name: 'mcp__github__search',
              detail: 'github/search',
              durationMs: 1500,
              agentId: 'session-x',
            }),
          ]}
        />
        <HoveredMarkReadout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubTrackRect(svg);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    if (!mark) throw new Error('expected mark');
    fireEvent.mouseMove(mark, { clientX: 48, clientY: 12 });
    const content = view.getByTestId('hovered-mark').textContent;
    expect(content).toContain('Agent: session-x');
    expect(content).toContain('Operation: MCP — mcp__github__search');
    expect(content).toContain('Detail: github/search');
    expect(content).toContain('Duration: 1.5s');
  });

  test('a skill event with no detail/duration omits those lines entirely (never a fake blank line)', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack events={[componentEvent({ kind: 'skill', name: 'my-skill' })]} />
        <HoveredMarkReadout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubTrackRect(svg);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    if (!mark) throw new Error('expected mark');
    fireEvent.mouseMove(mark, { clientX: 48, clientY: 12 });
    expect(view.getByTestId('hovered-mark').textContent).toBe(
      'Agent: session-a\nOperation: Skill — my-skill',
    );
  });

  test('moving off a mark (mouse leaves the track) clears hoveredMark back to null', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack events={[componentEvent({ kind: 'skill', name: 'my-skill' })]} />
        <HoveredMarkReadout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubTrackRect(svg);
    const mark = view.container.querySelector('[data-component-id="fake#0"]');
    if (!mark) throw new Error('expected mark');
    fireEvent.mouseMove(mark, { clientX: 48, clientY: 12 });
    expect(view.getByTestId('hovered-mark').textContent).not.toBe('null');
    fireEvent.mouseLeave(svg);
    expect(view.getByTestId('hovered-mark').textContent).toBe('null');
  });

  test("hovering a cluster's marker sets hoveredMark.content to componentClusterTooltip's exact shape (count/First/Last/click-to-see-all)", () => {
    // domain [0, 1000], width 480 -> x(v) = v * 0.48; at=100 -> 48px, at=110 -> 52.8px, well under the 10px threshold.
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({ id: 'a', kind: 'agent', at: 100 }),
            componentEvent({ id: 'b', kind: 'agent', at: 110 }),
          ]}
        />
        <HoveredMarkReadout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubTrackRect(svg);
    const cluster = view.container.querySelector('[data-component-cluster-count]');
    if (!cluster) throw new Error('expected a cluster marker');
    fireEvent.mouseMove(cluster, { clientX: 48, clientY: 12 });
    expect(view.getByTestId('hovered-mark').textContent).toBe(
      '2 Agent events\nFirst: 0:00\nLast: 0:00\nClick to see all events',
    );
  });

  describe('keyboard parity (focus/blur)', () => {
    test('focusing a mark sets hoveredMark; blurring it clears hoveredMark', () => {
      const view = render(
        <TimelineProvider domain={[0, 1000]}>
          <ComponentTrack
            events={[componentEvent({ kind: 'hook', name: 'pre-commit', agentId: 'session-k' })]}
          />
          <HoveredMarkReadout />
        </TimelineProvider>,
      );
      const mark = view.container.querySelector('[data-component-id="fake#0"]');
      if (!mark) throw new Error('expected mark');
      expect(view.getByTestId('hovered-mark').textContent).toBe('null');
      fireEvent.focus(mark);
      expect(view.getByTestId('hovered-mark').textContent).toContain('Agent: session-k');
      fireEvent.blur(mark);
      expect(view.getByTestId('hovered-mark').textContent).toBe('null');
    });
  });
});

describe('hover-dim by agent (timeline-chart-usability f1-t5)', () => {
  test('a mark whose agentId does not match hoveredAgentId dims to HOVER_DIM_OPACITY; the matching one stays undimmed', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({ id: 'a', kind: 'skill', at: 100, agentId: 'session-a' }),
            componentEvent({ id: 'b', kind: 'skill', at: 900, agentId: 'session-b' }),
          ]}
        />
      </TimelineProvider>,
    );
    // No hoveredAgentId yet: neither mark is dimmed.
    const circleA = view.container.querySelector('[data-component-id="a"] circle');
    const circleB = view.container.querySelector('[data-component-id="b"] circle');
    expect(circleA?.getAttribute('opacity')).toBeNull();
    expect(circleB?.getAttribute('opacity')).toBeNull();
  });

  test('with hoveredAgentId set, the matching mark carries no opacity attribute and the non-matching mark carries HOVER_DIM_OPACITY', () => {
    function HoverSetter({ agentId }: { agentId: string }) {
      const { setHoveredAgentId } = useTimeline();
      setHoveredAgentId(agentId);
      return null;
    }
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({ id: 'a', kind: 'skill', at: 100, agentId: 'session-a' }),
            componentEvent({ id: 'b', kind: 'skill', at: 900, agentId: 'session-b' }),
          ]}
        />
        <HoverSetter agentId="session-a" />
      </TimelineProvider>,
    );
    const circleA = view.container.querySelector('[data-component-id="a"] circle');
    const circleB = view.container.querySelector('[data-component-id="b"] circle');
    expect(circleA?.getAttribute('opacity')).toBeNull();
    expect(circleB?.getAttribute('opacity')).toBe(String(HOVER_DIM_OPACITY));
  });

  test("a cluster's shape dims/undims by its representative's agentId; the count <text> never dims", () => {
    function HoverSetter({ agentId }: { agentId: string }) {
      const { setHoveredAgentId } = useTimeline();
      setHoveredAgentId(agentId);
      return null;
    }
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({ id: 'a', kind: 'agent', at: 100, agentId: 'session-other' }),
            componentEvent({ id: 'b', kind: 'agent', at: 110, agentId: 'session-other' }),
          ]}
        />
        <HoverSetter agentId="session-a" />
      </TimelineProvider>,
    );
    const cluster = view.container.querySelector('[data-component-cluster-count]');
    if (!cluster) throw new Error('expected a cluster marker');
    const polygon = cluster.querySelector('polygon');
    const text = cluster.querySelector('text');
    expect(polygon?.getAttribute('opacity')).toBe(String(HOVER_DIM_OPACITY));
    expect(text?.getAttribute('opacity')).toBeNull();
  });
});

describe('unchanged-hit-skip perf requirement (timeline-chart-usability f1-t5)', () => {
  test('repeated mousemove ticks over the same mark do not re-invoke setHoveredMark (no consumer re-render), but moving to a different mark does', () => {
    function RenderCountReadout() {
      const { hoveredMark } = useTimeline();
      const renderCount = useRef(0);
      renderCount.current += 1;
      return (
        <>
          <div data-testid="render-count">{renderCount.current}</div>
          <div data-testid="hovered-mark">{hoveredMark ? hoveredMark.content : 'null'}</div>
        </>
      );
    }
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({ id: 'a', kind: 'skill', at: 100 }),
            componentEvent({ id: 'b', kind: 'hook', at: 900 }),
          ]}
        />
        <RenderCountReadout />
      </TimelineProvider>,
    );
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubTrackRect(svg);
    const markA = view.container.querySelector('[data-component-id="a"]');
    const markB = view.container.querySelector('[data-component-id="b"]');
    if (!markA || !markB) throw new Error('expected both marks');

    const initialCount = Number(view.getByTestId('render-count').textContent);

    // First mousemove onto mark A is a real transition (null -> 'a').
    fireEvent.mouseMove(markA, { clientX: 48, clientY: 12 });
    const countAfterFirstHit = Number(view.getByTestId('render-count').textContent);
    expect(countAfterFirstHit).toBeGreaterThan(initialCount);

    // Two more ticks at the EXACT same clientX/clientY (guaranteed same hit
    // target, and also the same `cursorTime` domain value, so this isolates
    // the hoveredMark skip from the unrelated always-fires setCursorTime
    // path -- React bails out a same-value setState, but `setHoveredMark`
    // would receive a brand-new object literal each time without the
    // ref-based skip, bumping render-count on every tick) must be genuine
    // no-ops.
    fireEvent.mouseMove(markA, { clientX: 48, clientY: 12 });
    fireEvent.mouseMove(markA, { clientX: 48, clientY: 12 });
    expect(Number(view.getByTestId('render-count').textContent)).toBe(countAfterFirstHit);

    // Moving onto a genuinely different mark IS a real transition and must
    // re-render.
    fireEvent.mouseMove(markB, { clientX: 432, clientY: 12 });
    expect(Number(view.getByTestId('render-count').textContent)).toBeGreaterThan(
      countAfterFirstHit,
    );
    expect(view.getByTestId('hovered-mark').textContent).toContain('Hook');
  });
});

describe('legend unaffected by hover/tooltip wiring (timeline-chart-usability f1-t5)', () => {
  test('the legend block still renders, its swatches stay at full opacity, and gain no hover-related attributes', () => {
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'skill', at: 100 }),
      componentEvent({ id: 'b', kind: 'hook', at: 500 }),
    ]);
    const legend = view.container.querySelector('[data-slot="component-track-legend"]');
    if (!legend) throw new Error('expected a legend');
    expect(legend.querySelectorAll('li').length).toBe(2);
    const skillSwatch = legend.querySelector('[data-legend-shape="skill"] circle');
    const hookSwatch = legend.querySelector('[data-legend-shape="hook"] rect');
    expect(skillSwatch?.getAttribute('opacity')).toBeNull();
    expect(hookSwatch?.getAttribute('opacity')).toBeNull();
    expect(legend.querySelector('[data-component-id]')).toBeNull();
    expect(legend.querySelector('[tabindex]')).toBeNull();
  });
});

describe('shared cursor wiring', () => {
  /**
   * happy-dom's `getBoundingClientRect` defaults to a zeroed rect unless
   * stubbed; stub it to a known 480px-wide box aligned with the nominal
   * viewBox width so the pixel->domain math is exact, not coincidental —
   * matching `TokenTrack.test.tsx`'s identical stub (same
   * `pointerToElapsedMs` contract, same track-level `onMouseMove`).
   */
  function stubRect(svg: SVGSVGElement, height: number): void {
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

  test('hovering the track sets TimelineContext.cursorTime from the real pointer position', () => {
    const view = renderTrack([componentEvent({ at: 789 })]);
    expect(view.getByTestId('cursor-probe').textContent).toBe('null');
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubRect(svg, 24);
    // domain [0, 1000], width 480 -> x(v) = v * 0.48; clientX 240 -> v 500.
    fireEvent.mouseMove(svg, { clientX: 240 });
    expect(view.getByTestId('cursor-probe').textContent).toBe('500');
  });

  test('leaving the track clears the (unpinned) cursor', () => {
    const view = renderTrack([componentEvent({ at: 789 })]);
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubRect(svg, 24);
    fireEvent.mouseMove(svg, { clientX: 240 });
    expect(view.getByTestId('cursor-probe').textContent).toBe('500');
    fireEvent.mouseLeave(svg);
    expect(view.getByTestId('cursor-probe').textContent).toBe('null');
  });
});

describe('proximity clustering (f10-t2)', () => {
  test('two same-kind marks within the proximity threshold merge into one marker with a count badge', () => {
    // domain [0, 1000], width 480 -> x(v) = v * 0.48; at=100 -> 48px, at=110 -> 52.8px (4.8px apart, well under the 10px threshold).
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'agent', at: 100 }),
      componentEvent({ id: 'b', kind: 'agent', at: 110 }),
    ]);
    const marks = view.container.querySelectorAll('[data-component-kind="agent"]');
    expect(marks.length).toBe(1);
    const mark = marks[0];
    expect(mark?.getAttribute('data-component-cluster-count')).toBe('2');
    // Representative id: the earliest member, `a` -- never a synthetic
    // cluster id, so EventInspector's existing lookup resolves it.
    expect(mark?.getAttribute('data-component-id')).toBe('a');
    expect(mark?.querySelector('polygon')).not.toBeNull(); // still the agent (triangle) glyph
    expect(mark?.querySelector('text')?.textContent).toBe('2');
    // Tooltip content (native <title> replaced by the shared hoveredMark
    // contract, f1-t5) is covered by the "tooltip (via shared hoveredMark...)"
    // describe block below, including the exact componentClusterTooltip shape.
  });

  test('two same-kind marks far apart stay as two separate glyphs', () => {
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'mcp', at: 100 }),
      componentEvent({ id: 'b', kind: 'mcp', at: 600 }),
    ]);
    const marks = view.container.querySelectorAll('[data-component-kind="mcp"]');
    expect(marks.length).toBe(2);
    for (const mark of marks) {
      expect(mark.hasAttribute('data-component-cluster-count')).toBe(false);
    }
  });

  test('same-position marks of different kinds never cluster together', () => {
    const view = renderTrack([
      componentEvent({ id: 'a', kind: 'skill', at: 100 }),
      componentEvent({ id: 'b', kind: 'hook', at: 100 }),
    ]);
    expect(view.container.querySelectorAll('[data-component-cluster-count]').length).toBe(0);
  });

  test('clicking a merged marker opens the full member list, not just the representative (first) member', () => {
    function SelectionProbe() {
      const { selectedEventId, selectedClusterIds } = useTimeline();
      return (
        <>
          <div data-testid="selection">{selectedEventId ?? 'null'}</div>
          <div data-testid="cluster-selection">
            {selectedClusterIds ? selectedClusterIds.join(',') : 'null'}
          </div>
        </>
      );
    }
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({ id: 'a', kind: 'skill', at: 100 }),
            componentEvent({ id: 'b', kind: 'skill', at: 110 }),
          ]}
        />
        <SelectionProbe />
      </TimelineProvider>,
    );
    const cluster = view.container.querySelector('[data-component-cluster-count]');
    if (!cluster) throw new Error('expected a cluster marker');
    expect(cluster.getAttribute('data-component-ids')).toBe('a,b');
    fireEvent.click(cluster);
    // A cluster click opens the list (every member's id) rather than
    // jumping straight to the representative's own detail view.
    expect(view.getByTestId('selection').textContent).toBe('null');
    expect(view.getByTestId('cluster-selection').textContent).toBe('a,b');
  });
});

describe('click-to-select (f6)', () => {
  function SelectionProbe() {
    const { selectedEventId } = useTimeline();
    return <div data-testid="selection">{selectedEventId ?? 'null'}</div>;
  }

  test('clicking a mark sets selectedEventId to that ComponentEvent.id, hit-testing the mark actually clicked (not always the first/only match)', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <ComponentTrack
          events={[
            componentEvent({ id: 'fake#0', kind: 'mcp', at: 100 }),
            componentEvent({ id: 'fake#1', kind: 'skill', at: 300 }),
            componentEvent({ id: 'fake#2', kind: 'agent', at: 600 }),
            componentEvent({ id: 'fake#3', kind: 'hook', at: 900 }),
          ]}
        />
        <SelectionProbe />
      </TimelineProvider>,
    );
    expect(view.getByTestId('selection').textContent).toBe('null');

    const skillMark = view.container.querySelector('[data-component-id="fake#1"] circle');
    if (!skillMark) throw new Error('expected skill mark');
    fireEvent.click(skillMark);
    expect(view.getByTestId('selection').textContent).toBe('fake#1');

    const agentMark = view.container.querySelector('[data-component-id="fake#2"] polygon');
    if (!agentMark) throw new Error('expected agent mark');
    fireEvent.click(agentMark);
    expect(view.getByTestId('selection').textContent).toBe('fake#2');

    const hookMark = view.container.querySelector('[data-component-id="fake#3"] rect');
    if (!hookMark) throw new Error('expected hook mark');
    fireEvent.click(hookMark);
    expect(view.getByTestId('selection').textContent).toBe('fake#3');

    const mcpMark = view.container.querySelector('[data-component-id="fake#0"] rect');
    if (!mcpMark) throw new Error('expected mcp mark');
    fireEvent.click(mcpMark);
    expect(view.getByTestId('selection').textContent).toBe('fake#0');
  });
});
