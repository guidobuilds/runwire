import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { HarnessEvent } from '../../lib/timeline';
import { KIND_COLOR } from '../charts/chart-theme';
import { HarnessTrack } from './HarnessTrack';
import type { TimelineDomain } from './TimelineContext';
import { TimelineProvider, useTimeline } from './TimelineContext';

afterEach(() => cleanup());

function harnessEvent(overrides: Partial<HarnessEvent> = {}): HarnessEvent {
  return {
    id: 'fake#0',
    agentId: 'session-a',
    kind: 'read',
    at: 100,
    durationMs: undefined,
    name: 'Read',
    error: undefined,
    ...overrides,
  };
}

/** Surfaces `TimelineContext`'s live `cursorTime` in the DOM so a hover test can assert the shared-cursor wiring without mocking the context. */
function CursorProbe() {
  const { cursorTime } = useTimeline();
  return <div data-testid="cursor-probe">{cursorTime ?? 'null'}</div>;
}

function renderTrack(events: HarnessEvent[], domain: TimelineDomain = [0, 1000]) {
  return render(
    <TimelineProvider domain={domain}>
      <HarnessTrack events={events} />
      <CursorProbe />
    </TimelineProvider>,
  );
}

describe('rows', () => {
  test('always renders exactly three rows, labeled Read/Write/Exec, even with zero events', () => {
    const view = renderTrack([]);
    // Labels live as real HTML text in each row's label gutter (f8/AgentTrack
    // pattern), not as SVG <text> inside the data area -- see HarnessTrack's
    // own doc comment for why that used to overlap with marks near t=0.
    const rows = view.container.querySelectorAll('[data-slot="harness-track"] > div');
    expect(rows.length).toBe(3);
    expect(Array.from(rows).map((r) => r.querySelector('span')?.textContent)).toEqual([
      'Read',
      'Write',
      'Exec',
    ]);
    expect(view.container.querySelectorAll('svg').length).toBe(3);
  });
});

describe('instant vs duration marks', () => {
  test('an event with no durationMs renders as a small dot (f10-t1)', () => {
    const view = renderTrack([harnessEvent({ kind: 'write', at: 200, durationMs: undefined })]);
    const mark = view.container.querySelector('[data-harness-id="fake#0"]');
    expect(mark?.tagName).toBe('circle');
    expect(mark?.getAttribute('data-harness-shape')).toBe('dot');
    // domain [0, 1000], default width 480 -> x(v) = v * 0.48 -> cx(200) = 96.
    expect(Number(mark?.getAttribute('cx'))).toBeCloseTo(96, 5);
    expect(Number(mark?.getAttribute('r'))).toBeGreaterThan(0);
  });

  test('an event with durationMs renders as a rect spanning at..at+durationMs, via the shared xScale', () => {
    // domain [0, 1000], default width 480 -> x(v) = v * 0.48.
    const view = renderTrack([harnessEvent({ kind: 'exec', at: 100, durationMs: 200 })]);
    const mark = view.container.querySelector('rect[data-harness-id="fake#0"]');
    expect(mark?.getAttribute('data-harness-shape')).toBe('bar');
    expect(Number(mark?.getAttribute('x'))).toBeCloseTo(48, 5);
    expect(Number(mark?.getAttribute('width'))).toBeCloseTo(96, 5); // x(300) - x(100) = 144 - 48
  });

  test('each row places its own events in its own row (distinct svg, labeled to match)', () => {
    const view = renderTrack([
      harnessEvent({ id: 'r', kind: 'read', at: 0 }),
      harnessEvent({ id: 'w', kind: 'write', at: 0 }),
      harnessEvent({ id: 'e', kind: 'exec', at: 0 }),
    ]);
    const rowOf = (id: string) =>
      view.container.querySelector(`[data-harness-id="${id}"]`)?.closest('svg')?.getAttribute('aria-label');
    expect(rowOf('r')).toBe('Read events');
    expect(rowOf('w')).toBe('Write events');
    expect(rowOf('e')).toBe('Exec events');
  });
});

describe('proximity clustering (f10-t2)', () => {
  test('two same-kind instant marks within the proximity threshold merge into one marker with a count badge', () => {
    // domain [0, 1000], width 480 -> x(v) = v * 0.48; at=100 -> 48px, at=110 -> 52.8px (4.8px apart, well under the 10px threshold).
    const view = renderTrack([
      harnessEvent({ id: 'a', kind: 'read', at: 100 }),
      harnessEvent({ id: 'b', kind: 'read', at: 110 }),
    ]);
    const marks = view.container.querySelectorAll('[data-harness-kind="read"]');
    expect(marks.length).toBe(1);
    const mark = marks[0];
    expect(mark?.tagName).toBe('g');
    expect(mark?.getAttribute('data-harness-shape')).toBe('cluster');
    expect(mark?.getAttribute('data-harness-cluster-count')).toBe('2');
    // Representative id: the earliest member, `a` (at=100 < at=110) -- never
    // a synthetic cluster id, so EventInspector's existing lookup resolves it.
    expect(mark?.getAttribute('data-harness-id')).toBe('a');
    expect(mark?.querySelector('text')?.textContent).toBe('2');
    expect(mark?.querySelector('title')?.textContent).toContain('2 Read events');
  });

  test('two same-kind instant marks far apart (beyond the threshold) stay as two separate dots', () => {
    // at=100 -> 48px, at=600 -> 288px, 240px apart -- far beyond the 10px threshold.
    const view = renderTrack([
      harnessEvent({ id: 'a', kind: 'read', at: 100 }),
      harnessEvent({ id: 'b', kind: 'read', at: 600 }),
    ]);
    const marks = view.container.querySelectorAll('[data-harness-kind="read"]');
    expect(marks.length).toBe(2);
    for (const mark of marks) {
      expect(mark.getAttribute('data-harness-shape')).toBe('dot');
    }
  });

  test('same-position marks of different kinds never cluster together (kind is part of the bucket key)', () => {
    const view = renderTrack([
      harnessEvent({ id: 'a', kind: 'read', at: 100 }),
      harnessEvent({ id: 'b', kind: 'write', at: 100 }),
    ]);
    expect(view.container.querySelectorAll('[data-harness-shape="cluster"]').length).toBe(0);
    expect(view.container.querySelectorAll('[data-harness-shape="dot"]').length).toBe(2);
  });

  test('a duration bar never clusters with an adjacent instant mark of the same kind', () => {
    const view = renderTrack([
      harnessEvent({ id: 'a', kind: 'exec', at: 100, durationMs: 50 }),
      harnessEvent({ id: 'b', kind: 'exec', at: 105, durationMs: undefined }),
    ]);
    expect(
      view.container.querySelector('[data-harness-id="a"]')?.getAttribute('data-harness-shape'),
    ).toBe('bar');
    expect(
      view.container.querySelector('[data-harness-id="b"]')?.getAttribute('data-harness-shape'),
    ).toBe('dot');
  });

  test('zooming in (a narrower domain) spreads previously-clustered marks back apart into separate dots', () => {
    // Same two marks as the first test above (100/110, clustered under [0,1000]/480px),
    // rendered instead against a narrow post-zoom-style domain: [0, 200]/480px ->
    // x(v) = v * 2.4 -> at=100 -> 240px, at=110 -> 264px, 24px apart -- now beyond the 10px threshold.
    const view = renderTrack(
      [
        harnessEvent({ id: 'a', kind: 'read', at: 100 }),
        harnessEvent({ id: 'b', kind: 'read', at: 110 }),
      ],
      [0, 200],
    );
    const marks = view.container.querySelectorAll('[data-harness-kind="read"]');
    expect(marks.length).toBe(2);
    for (const mark of marks) {
      expect(mark.getAttribute('data-harness-shape')).toBe('dot');
    }
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
        <HarnessTrack
          events={[
            harnessEvent({ id: 'a', kind: 'read', at: 100 }),
            harnessEvent({ id: 'b', kind: 'read', at: 110 }),
          ]}
        />
        <SelectionProbe />
      </TimelineProvider>,
    );
    const cluster = view.container.querySelector('[data-harness-shape="cluster"]');
    if (!cluster) throw new Error('expected a cluster marker');
    expect(cluster.getAttribute('data-harness-ids')).toBe('a,b');
    fireEvent.click(cluster);
    // A cluster click opens the list (every member's id) rather than
    // jumping straight to the representative's own detail view.
    expect(view.getByTestId('selection').textContent).toBe('null');
    expect(view.getByTestId('cluster-selection').textContent).toBe('a,b');
  });
});

describe('color', () => {
  test('each row is colored via chart-theme KIND_COLOR var() references, never a literal hex', () => {
    const view = renderTrack([
      harnessEvent({ id: 'r', kind: 'read' }),
      harnessEvent({ id: 'w', kind: 'write' }),
      harnessEvent({ id: 'e', kind: 'exec' }),
    ]);
    expect(view.container.querySelector('[data-harness-id="r"]')?.getAttribute('fill')).toBe(
      KIND_COLOR.read,
    );
    expect(view.container.querySelector('[data-harness-id="w"]')?.getAttribute('fill')).toBe(
      KIND_COLOR.write,
    );
    expect(view.container.querySelector('[data-harness-id="e"]')?.getAttribute('fill')).toBe(
      KIND_COLOR.exec,
    );
    for (const mark of view.container.querySelectorAll('[data-harness-id]')) {
      expect(mark.getAttribute('fill')).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});

describe('tooltip', () => {
  test('an instant read exposes type/start/duration/target/agent via a native SVG <title>', () => {
    const view = renderTrack([
      harnessEvent({ kind: 'read', at: 61_000, name: 'src/index.ts', agentId: 'session-x' }),
    ]);
    const title = view.container.querySelector('[data-harness-id="fake#0"] title')?.textContent;
    expect(title).toContain('Read');
    expect(title).toContain('Start: 1:01');
    expect(title).toContain('Duration: instant');
    expect(title).toContain('Target: src/index.ts');
    expect(title).toContain('Agent: session-x');
  });

  test('a duration exec exposes start, end and a formatted duration', () => {
    const view = renderTrack([
      harnessEvent({ kind: 'exec', at: 1000, durationMs: 2500, name: 'npm test' }),
    ]);
    const title = view.container.querySelector('rect[data-harness-id="fake#0"] title')?.textContent;
    expect(title).toContain('Start: 0:01');
    expect(title).toContain('End: 0:03');
    expect(title).toContain('Duration: 2.5s');
    expect(title).toContain('Target: npm test');
  });

  test('an error event notes the failure in its tooltip', () => {
    const view = renderTrack([harnessEvent({ kind: 'write', error: true })]);
    const title = view.container.querySelector('[data-harness-id="fake#0"] title')?.textContent;
    expect(title).toContain('Error: yes');
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
    const view = renderTrack([harnessEvent({ at: 456 })]);
    expect(view.getByTestId('cursor-probe').textContent).toBe('null');
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubRect(svg, 72);
    // domain [0, 1000], width 480 -> x(v) = v * 0.48; clientX 240 -> v 500.
    fireEvent.mouseMove(svg, { clientX: 240 });
    expect(view.getByTestId('cursor-probe').textContent).toBe('500');
  });

  test('leaving the track clears the (unpinned) cursor', () => {
    const view = renderTrack([harnessEvent({ at: 456 })]);
    const svg = view.container.querySelector('svg');
    if (!svg) throw new Error('svg not found');
    stubRect(svg, 72);
    fireEvent.mouseMove(svg, { clientX: 240 });
    expect(view.getByTestId('cursor-probe').textContent).toBe('500');
    fireEvent.mouseLeave(svg);
    expect(view.getByTestId('cursor-probe').textContent).toBe('null');
  });
});

describe('click-to-select (f6)', () => {
  function SelectionProbe() {
    const { selectedEventId } = useTimeline();
    return <div data-testid="selection">{selectedEventId ?? 'null'}</div>;
  }

  test('clicking a mark sets selectedEventId to that HarnessEvent.id, hit-testing the mark actually clicked (not always the first/only match)', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <HarnessTrack
          events={[
            harnessEvent({ id: 'fake#0', kind: 'exec', at: 100 }),
            harnessEvent({ id: 'fake#1', kind: 'read', at: 300 }),
            harnessEvent({ id: 'fake#2', kind: 'write', at: 600 }),
          ]}
        />
        <SelectionProbe />
      </TimelineProvider>,
    );
    expect(view.getByTestId('selection').textContent).toBe('null');

    const second = view.container.querySelector('[data-harness-id="fake#1"]');
    if (!second) throw new Error('expected second mark');
    fireEvent.click(second);
    expect(view.getByTestId('selection').textContent).toBe('fake#1');

    const third = view.container.querySelector('[data-harness-id="fake#2"]');
    if (!third) throw new Error('expected third mark');
    fireEvent.click(third);
    expect(view.getByTestId('selection').textContent).toBe('fake#2');

    const first = view.container.querySelector('[data-harness-id="fake#0"]');
    if (!first) throw new Error('expected first mark');
    fireEvent.click(first);
    expect(view.getByTestId('selection').textContent).toBe('fake#0');
  });
});
