import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_WIDTH,
  LABEL_GUTTER_PX,
  LABEL_GUTTER_WIDTH,
  TimelineProvider,
  useTimeline,
} from './TimelineContext';

afterEach(() => cleanup());

function Probe() {
  const timeline = useTimeline();
  return (
    <div>
      <div data-testid="cursor-time">{String(timeline.cursorTime)}</div>
      <div data-testid="cursor-pinned">{String(timeline.cursorPinned)}</div>
      <div data-testid="selected-event">{String(timeline.selectedEventId)}</div>
      <div data-testid="selected-cluster">
        {timeline.selectedClusterIds ? timeline.selectedClusterIds.join(',') : 'null'}
      </div>
      <div data-testid="selected-range">
        {timeline.selectedRange ? timeline.selectedRange.join(',') : 'null'}
      </div>
      <div data-testid="domain">{timeline.domain.join(',')}</div>
      <div data-testid="width">{timeline.width}</div>
      <div data-testid="xscale-at-500">{timeline.xScale(500)}</div>
      <button type="button" onClick={() => timeline.setCursorTime(250)}>
        hover-250
      </button>
      <button type="button" onClick={() => timeline.setCursorTime(999)}>
        hover-999
      </button>
      <button type="button" onClick={() => timeline.setCursorTime(null)}>
        hover-clear
      </button>
      <button type="button" onClick={() => timeline.pinCursor(400)}>
        pin-400
      </button>
      <button type="button" onClick={() => timeline.clearCursor()}>
        clear
      </button>
      <button type="button" onClick={() => timeline.selectEvent('evt-1')}>
        select-evt-1
      </button>
      <button type="button" onClick={() => timeline.selectEvent(null)}>
        deselect
      </button>
      <button type="button" onClick={() => timeline.selectCluster(['a', 'b', 'c'])}>
        select-cluster
      </button>
      <button type="button" onClick={() => timeline.closeInspector()}>
        close-inspector
      </button>
      <button type="button" onClick={() => timeline.setSelectedRange([100, 200])}>
        set-range
      </button>
    </div>
  );
}

describe('useTimeline', () => {
  test('throws when used outside a TimelineProvider', () => {
    // React logs the thrown-during-render error to console.error; suppress
    // just for this assertion so the test's own output stays clean.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useTimeline must be used within a TimelineProvider.');
    spy.mockRestore();
  });
});

describe('TimelineProvider', () => {
  test('exposes the design.md §3.2 shape with correct initial values', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    expect(view.getByTestId('cursor-time').textContent).toBe('null');
    expect(view.getByTestId('cursor-pinned').textContent).toBe('false');
    expect(view.getByTestId('selected-event').textContent).toBe('null');
    expect(view.getByTestId('selected-cluster').textContent).toBe('null');
    expect(view.getByTestId('selected-range').textContent).toBe('null');
    expect(view.getByTestId('domain').textContent).toBe('0,1000');
    expect(view.getByTestId('width').textContent).toBe('480');
  });

  test('xScale maps domain -> [0, width] linearly (default width 480)', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    // 500 of [0,1000] is the domain midpoint -> midpoint of [0,480] = 240.
    expect(view.getByTestId('xscale-at-500').textContent).toBe('240');
  });

  test('a custom width changes the nominal SVG width and the xScale range', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]} width={240}>
        <Probe />
      </TimelineProvider>,
    );
    expect(view.getByTestId('width').textContent).toBe('240');
    expect(view.getByTestId('xscale-at-500').textContent).toBe('120');
  });

  test('setCursorTime updates cursorTime while unpinned', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('hover-250'));
    expect(view.getByTestId('cursor-time').textContent).toBe('250');
    expect(view.getByTestId('cursor-pinned').textContent).toBe('false');
  });

  test('a click (pinCursor) pins the cursor', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('pin-400'));
    expect(view.getByTestId('cursor-time').textContent).toBe('400');
    expect(view.getByTestId('cursor-pinned').textContent).toBe('true');
  });

  test('a hover while pinned does NOT overwrite cursorTime', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('pin-400'));
    expect(view.getByTestId('cursor-time').textContent).toBe('400');

    fireEvent.click(view.getByText('hover-999'));
    expect(view.getByTestId('cursor-time').textContent).toBe('400');
    expect(view.getByTestId('cursor-pinned').textContent).toBe('true');

    // A `null` hover (mouseleave) must not clear a pinned cursor either.
    fireEvent.click(view.getByText('hover-clear'));
    expect(view.getByTestId('cursor-time').textContent).toBe('400');
    expect(view.getByTestId('cursor-pinned').textContent).toBe('true');
  });

  test('clearCursor unpins and resets cursorTime to null', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('pin-400'));
    fireEvent.click(view.getByText('clear'));
    expect(view.getByTestId('cursor-time').textContent).toBe('null');
    expect(view.getByTestId('cursor-pinned').textContent).toBe('false');
  });

  test('after clearCursor, hover moves the cursor again', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('pin-400'));
    fireEvent.click(view.getByText('clear'));
    fireEvent.click(view.getByText('hover-250'));
    expect(view.getByTestId('cursor-time').textContent).toBe('250');
  });

  test('selectEvent sets and clears selectedEventId', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('select-evt-1'));
    expect(view.getByTestId('selected-event').textContent).toBe('evt-1');
    fireEvent.click(view.getByText('deselect'));
    expect(view.getByTestId('selected-event').textContent).toBe('null');
  });

  test('selectCluster sets selectedClusterIds and clears any selectedEventId, independently of selectEvent', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('select-evt-1'));
    expect(view.getByTestId('selected-event').textContent).toBe('evt-1');

    fireEvent.click(view.getByText('select-cluster'));
    expect(view.getByTestId('selected-cluster').textContent).toBe('a,b,c');
    expect(view.getByTestId('selected-event').textContent).toBe('null');

    // Picking a member out of the open cluster (selectEvent) must not lose
    // the cluster's own membership -- EventInspector's "Back to list" relies
    // on selectedClusterIds surviving this.
    fireEvent.click(view.getByText('select-evt-1'));
    expect(view.getByTestId('selected-event').textContent).toBe('evt-1');
    expect(view.getByTestId('selected-cluster').textContent).toBe('a,b,c');
  });

  test('closeInspector clears both selectedEventId and selectedClusterIds', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    fireEvent.click(view.getByText('select-cluster'));
    fireEvent.click(view.getByText('select-evt-1'));
    expect(view.getByTestId('selected-cluster').textContent).toBe('a,b,c');

    fireEvent.click(view.getByText('close-inspector'));
    expect(view.getByTestId('selected-event').textContent).toBe('null');
    expect(view.getByTestId('selected-cluster').textContent).toBe('null');
  });

  test('setSelectedRange is a real setter backed by real state', () => {
    const view = render(
      <TimelineProvider domain={[0, 1000]}>
        <Probe />
      </TimelineProvider>,
    );
    expect(view.getByTestId('selected-range').textContent).toBe('null');
    fireEvent.click(view.getByText('set-range'));
    expect(view.getByTestId('selected-range').textContent).toBe('100,200');
  });
});

describe('shared label-gutter constants (f8)', () => {
  test('DEFAULT_WIDTH, LABEL_GUTTER_WIDTH and LABEL_GUTTER_PX are exported and pinned', () => {
    // DEFAULT_WIDTH must equal TimelineProvider's own default (already
    // covered above, "exposes ... width 480") -- pinned here too so the
    // exported constant itself can't silently drift from that default.
    expect(DEFAULT_WIDTH).toBe(480);
    // LABEL_GUTTER_WIDTH is the Tailwind class every track/axis row's label
    // cell uses (AgentTrack's own `w-40`); LABEL_GUTTER_PX is that same
    // width (10rem = 160px) plus the `gap-2` (8px) every row places between
    // its label cell and its plot <svg> -- the exact pixel inset
    // SessionTimeline applies to SharedCursor's positioned ancestor.
    expect(LABEL_GUTTER_WIDTH).toBe('w-40');
    expect(LABEL_GUTTER_PX).toBe(168);
  });
});
