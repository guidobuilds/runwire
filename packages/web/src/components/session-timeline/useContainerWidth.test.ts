import { act, cleanup, render } from '@testing-library/react';
import { scaleLinear } from '@visx/scale';
import { createElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { pointerToElapsedMs, useContainerWidth } from './useContainerWidth';

/**
 * happy-dom (this repo's Vitest `environment`, `packages/web/vite.config.ts`)
 * has no real layout engine: `Element.prototype.getBoundingClientRect`
 * defaults to a zeroed rect (`width: 0`), and there is no `ResizeObserver`
 * implementation at all, and no `setupFiles` polyfill for either. Every test
 * below that exercises `useContainerWidth` explicitly stubs both — a version
 * that merely asserted "returns a number"/"handler fired" would still pass
 * against an unmocked zeroed rect (producing `0`, or `NaN`/`Infinity` through
 * a division), which is exactly the false-green this suite is written to
 * rule out.
 */

type TriggerableResizeObserver = ResizeObserver & { trigger: (width: number) => void };

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observedTargets: Element[] = [];
  disconnected = false;
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observedTargets.push(target);
  }

  unobserve(target: Element) {
    this.observedTargets = this.observedTargets.filter((t) => t !== target);
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger(width: number) {
    const entry = { contentRect: { width } } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function Probe() {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  return createElement('div', { ref, 'data-testid': 'width' }, String(width));
}

function stubRect(width: number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 40,
    top: 0,
    left: 0,
    right: width,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  } as DOMRect);
}

describe('useContainerWidth', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeResizeObserver.instances = [];
  });

  test('returns the measured element CSS pixel width from getBoundingClientRect on mount', () => {
    stubRect(300);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const view = render(createElement(Probe));

    expect(view.getByTestId('width').textContent).toBe('300');
  });

  test('observes exactly the ref-attached element via the (stubbed) ResizeObserver', () => {
    stubRect(300);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const view = render(createElement(Probe));
    const node = view.getByTestId('width');

    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]?.observedTargets).toEqual([node]);
  });

  test('updates the returned width when the ResizeObserver reports a new contentRect', () => {
    stubRect(300);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const view = render(createElement(Probe));
    expect(view.getByTestId('width').textContent).toBe('300');

    const observer = FakeResizeObserver.instances[0] as TriggerableResizeObserver;
    act(() => {
      observer.trigger(450);
    });

    expect(view.getByTestId('width').textContent).toBe('450');
  });

  test('disconnects the observer on unmount', () => {
    stubRect(300);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const view = render(createElement(Probe));
    const observer = FakeResizeObserver.instances[0];
    expect(observer?.disconnected).toBe(false);

    view.unmount();

    expect(observer?.disconnected).toBe(true);
  });
});

describe('pointerToElapsedMs', () => {
  test('converts a real pointer clientX into an elapsed-ms domain value via xScale.invert, hand-computed', () => {
    const xScale = scaleLinear<number>({ domain: [0, 1000], range: [0, 480] });
    const containerRect = { left: 50, width: 240 }; // CSS width (240) half the nominal viewBox width (480)
    // pxOffset = 170 - 50 = 120
    // viewBoxOffset = (120 / 240) * 480 = 240
    // xScale.invert(240) = 240/480 * 1000 = 500
    expect(pointerToElapsedMs(170, containerRect, 480, xScale)).toBe(500);
  });

  test('a second hand-computed fixture (different domain, offset and rect) confirms the mapping is not coincidental', () => {
    const xScale = scaleLinear<number>({ domain: [0, 2000], range: [0, 480] });
    const containerRect = { left: 20, width: 480 }; // CSS width equal to the nominal viewBox width here
    // pxOffset = 260 - 20 = 240
    // viewBoxOffset = (240 / 480) * 480 = 240
    // xScale.invert(240) = 240/480 * 2000 = 1000
    expect(pointerToElapsedMs(260, containerRect, 480, xScale)).toBe(1000);
  });

  test('returns xScale.invert(0) rather than NaN/Infinity when containerRect.width is 0 (not yet measured)', () => {
    const xScale = scaleLinear<number>({ domain: [0, 1000], range: [0, 480] });
    expect(pointerToElapsedMs(999, { left: 0, width: 0 }, 480, xScale)).toBe(0);
  });
});
