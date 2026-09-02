import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { type TimelineDomain, TimelineProvider } from './TimelineContext';
import { ZoomBrush } from './ZoomBrush';

afterEach(() => cleanup());

/**
 * `domain=[0,1000]`, `width=500` -- `xScale` maps 1:1000 -> 1:500 (a factor
 * of 2). `plotRect`'s `{left:0, width:500}` matches the nominal `width`
 * exactly, so `pointerToElapsedMs` reduces to `elapsedMs = clientX * 2` --
 * every expected value below is hand-computed from that, not copied from the
 * implementation.
 */
const DOMAIN: TimelineDomain = [0, 1000];
const WIDTH = 500;

function stubRect(el: Element, rect: { left: number; width: number }) {
  (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({
      left: rect.left,
      width: rect.width,
      top: 0,
      right: rect.left + rect.width,
      bottom: 0,
      height: 0,
      x: rect.left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function Harness({
  onZoom,
  onMarkClick,
  onResetZoom,
}: {
  onZoom: (range: TimelineDomain) => void;
  onMarkClick?: () => void;
  onResetZoom?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  return (
    <TimelineProvider domain={DOMAIN} width={WIDTH}>
      <div data-testid="container" ref={containerRef}>
        <button type="button" data-testid="mark" onClick={onMarkClick}>
          mark
        </button>
        <div data-testid="plot" ref={plotRef} style={{ position: 'relative' }}>
          <ZoomBrush
            containerRef={containerRef}
            plotRef={plotRef}
            onZoom={onZoom}
            onResetZoom={onResetZoom}
          />
        </div>
      </div>
    </TimelineProvider>
  );
}

function setup(onMarkClick?: () => void, onResetZoom?: () => void) {
  const onZoom = vi.fn<(range: TimelineDomain) => void>();
  const view = render(
    <Harness onZoom={onZoom} onMarkClick={onMarkClick} onResetZoom={onResetZoom} />,
  );
  const container = view.getByTestId('container');
  const plot = view.getByTestId('plot');
  stubRect(plot, { left: 0, width: WIDTH });
  return { view, onZoom, container, plot };
}

describe('idle state', () => {
  test('renders no selection overlay while no drag is in progress', () => {
    const { view } = setup();
    expect(view.container.querySelector('[data-slot="zoom-brush-selection"]')).toBeNull();
  });
});

describe('drag-to-zoom', () => {
  test('a drag past the threshold calls onZoom once with the correct elapsed-ms range, ascending', () => {
    const { onZoom, container } = setup();
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseMove(container, { clientX: 300 });
    fireEvent.mouseUp(container, { clientX: 300 });
    // clientX 100 -> 200ms, clientX 300 -> 600ms.
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenCalledWith([200, 600]);
  });

  test('a reversed drag (end before start on screen) still narrows to an ascending [lo, hi] range', () => {
    const { onZoom, container } = setup();
    fireEvent.mouseDown(container, { clientX: 300, button: 0 });
    fireEvent.mouseMove(container, { clientX: 100 });
    fireEvent.mouseUp(container, { clientX: 100 });
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenCalledWith([200, 600]);
  });

  test('a drag below the minimum pixel threshold does not call onZoom (ignored as an accidental micro-drag/click)', () => {
    const { onZoom, container } = setup();
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseMove(container, { clientX: 102 });
    fireEvent.mouseUp(container, { clientX: 102 });
    expect(onZoom).not.toHaveBeenCalled();
  });

  test('a non-primary mouse button (e.g. right-click) never starts a drag', () => {
    const { onZoom, container } = setup();
    fireEvent.mouseDown(container, { clientX: 100, button: 2 });
    fireEvent.mouseMove(container, { clientX: 300 });
    fireEvent.mouseUp(container, { clientX: 300 });
    expect(onZoom).not.toHaveBeenCalled();
  });

  test('mouseleave while dragging completes the gesture the same as mouseup', () => {
    const { onZoom, container } = setup();
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseMove(container, { clientX: 300 });
    fireEvent.mouseLeave(container, { clientX: 300 });
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenCalledWith([200, 600]);
  });

  test('renders a translucent selection rect positioned/sized as a percentage of the plot width while dragging', () => {
    const { container, view } = setup();
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseMove(container, { clientX: 300 });
    const overlay = view.container.querySelector(
      '[data-slot="zoom-brush-selection"]',
    ) as HTMLElement;
    expect(overlay).not.toBeNull();
    // xScale(200)=100, xScale(600)=300 -> percentages 100/500*100=20%, 300/500*100=60%.
    expect(overlay.style.left).toBe('20%');
    expect(overlay.style.width).toBe('40%');
    expect(overlay.className).toContain('pointer-events-none');
  });

  test('the selection overlay clears once the drag completes', () => {
    const { container, view } = setup();
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseMove(container, { clientX: 300 });
    fireEvent.mouseUp(container, { clientX: 300 });
    expect(view.container.querySelector('[data-slot="zoom-brush-selection"]')).toBeNull();
  });
});

describe('double-click reset (f9-t3 secondary affordance)', () => {
  test('a double-click on the container calls onResetZoom', () => {
    const onResetZoom = vi.fn();
    const { container } = setup(undefined, onResetZoom);
    fireEvent.doubleClick(container);
    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });

  test('does nothing (no throw) when onResetZoom is omitted', () => {
    const { container } = setup();
    expect(() => fireEvent.doubleClick(container)).not.toThrow();
  });
});

describe('click passthrough (does not break f6 click-to-select)', () => {
  test('a plain click with no preceding drag still reaches the underlying element normally', () => {
    const onMarkClick = vi.fn();
    const { container, view } = setup(onMarkClick);
    const mark = view.getByTestId('mark');
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseUp(container, { clientX: 100 });
    fireEvent.click(mark);
    expect(onMarkClick).toHaveBeenCalledTimes(1);
  });

  test('a completed drag suppresses the click that naturally follows it on the element under the pointer at release', () => {
    const onMarkClick = vi.fn();
    const { onZoom, container, view } = setup(onMarkClick);
    const mark = view.getByTestId('mark');
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseMove(container, { clientX: 300 });
    fireEvent.mouseUp(container, { clientX: 300 });
    // The browser fires a native `click` on whatever element is under the
    // pointer at mouseup -- simulated here directly on `mark`.
    fireEvent.click(mark);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onMarkClick).not.toHaveBeenCalled();
  });

  test('a later, unrelated click is not suppressed after a drag that ended via mouseleave (no click ever consumed the suppression flag)', () => {
    const onMarkClick = vi.fn();
    const { container, view } = setup(onMarkClick);
    const mark = view.getByTestId('mark');
    fireEvent.mouseDown(container, { clientX: 100, button: 0 });
    fireEvent.mouseMove(container, { clientX: 300 });
    fireEvent.mouseLeave(container, { clientX: 300 });
    // A brand new, unrelated plain click some time later must not be
    // silently swallowed by a stale suppression flag.
    fireEvent.mouseDown(container, { clientX: 50, button: 0 });
    fireEvent.mouseUp(container, { clientX: 50 });
    fireEvent.click(mark);
    expect(onMarkClick).toHaveBeenCalledTimes(1);
  });
});
