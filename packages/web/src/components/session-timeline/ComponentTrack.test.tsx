import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { ComponentEvent } from '../../lib/timeline';
import { KIND_COLOR } from '../charts/chart-theme';
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

describe('tooltip', () => {
  test('an mcp event exposes agent/operation/server-tool-detail/duration via a native SVG <title>', () => {
    const view = renderTrack([
      componentEvent({
        kind: 'mcp',
        name: 'mcp__github__search',
        detail: 'github/search',
        durationMs: 1500,
        agentId: 'session-x',
      }),
    ]);
    const title = view.container.querySelector('[data-component-id="fake#0"] title')?.textContent;
    expect(title).toContain('Agent: session-x');
    expect(title).toContain('Operation: MCP — mcp__github__search');
    expect(title).toContain('Detail: github/search');
    expect(title).toContain('Duration: 1.5s');
  });

  test('a skill event with no detail/duration omits those lines entirely (never a fake blank line)', () => {
    const view = renderTrack([componentEvent({ kind: 'skill', name: 'my-skill' })]);
    const title = view.container.querySelector('[data-component-id="fake#0"] title')?.textContent;
    expect(title).toBe('Agent: session-a\nOperation: Skill — my-skill');
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
    expect(mark?.querySelector('title')?.textContent).toContain('2 Agent events');
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
