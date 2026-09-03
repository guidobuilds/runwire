import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useAvailableHeight } from './useAvailableHeight';

/**
 * happy-dom (this repo's Vitest `environment`) defaults
 * `Element.prototype.getBoundingClientRect` to a zeroed rect and
 * `window.innerHeight` to a fixed value -- every test below explicitly
 * stubs both rather than trusting the ambient default, matching
 * `useContainerWidth.test.ts`'s own "a version that merely asserted 'returns
 * a number' would still pass against an unmocked zero" rationale.
 */

function Probe({ bottomMarginPx }: { bottomMarginPx: number }) {
  const [ref, height] = useAvailableHeight<HTMLDivElement>(bottomMarginPx);
  return createElement('div', { ref, 'data-testid': 'height' }, String(height));
}

/**
 * Minimal fake matching `useContainerWidth.test.ts`'s own
 * `FakeResizeObserver` shape -- records the observed target and exposes a
 * `trigger()` the test calls directly to simulate a real intersection-
 * threshold crossing (the browser firing the callback as the container
 * scrolls into/out of view), without needing a real layout engine.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observedTargets: Element[] = [];
  disconnected = false;
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
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

  trigger(isIntersecting: boolean) {
    const entry = { isIntersecting } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

function stubRectTop(top: number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 480,
    height: 40,
    top,
    left: 0,
    right: 480,
    bottom: top + 40,
    x: 0,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect);
}

describe('useAvailableHeight', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeIntersectionObserver.instances = [];
  });

  test('computes window.innerHeight - rect.top - bottomMarginPx on mount', () => {
    stubRectTop(100);
    vi.stubGlobal('innerHeight', 800);

    const view = render(createElement(Probe, { bottomMarginPx: 24 }));

    expect(view.getByTestId('height').textContent).toBe(String(800 - 100 - 24));
  });

  test("returns the raw computed value even when it is below AGENT_TRACK_MIN_HEIGHT_PX-equivalent inputs -- the floor is AgentTrack.tsx's own Math.max clamp, not something this hook applies itself", () => {
    // 100 - 80 - 24 = -4: well below AGENT_TRACK_MIN_HEIGHT_PX (88), and
    // genuinely negative -- a hook that silently floored internally would
    // hide this and make AgentTrack's own Math.max(raw, MIN) clamp
    // untestable as doing real work.
    stubRectTop(80);
    vi.stubGlobal('innerHeight', 100);

    const view = render(createElement(Probe, { bottomMarginPx: 24 }));

    expect(view.getByTestId('height').textContent).toBe('-4');
  });

  test('a mocked getBoundingClientRect().top / window.innerHeight change plus a fired "resize" event triggers a recompute', () => {
    stubRectTop(100);
    vi.stubGlobal('innerHeight', 800);

    const view = render(createElement(Probe, { bottomMarginPx: 24 }));
    expect(view.getByTestId('height').textContent).toBe(String(800 - 100 - 24));

    stubRectTop(50);
    vi.stubGlobal('innerHeight', 900);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(view.getByTestId('height').textContent).toBe(String(900 - 50 - 24));
  });

  test('does not recompute on an unrelated event (no listener fires without a real "resize")', () => {
    stubRectTop(100);
    vi.stubGlobal('innerHeight', 800);

    const view = render(createElement(Probe, { bottomMarginPx: 24 }));
    const before = view.getByTestId('height').textContent;

    stubRectTop(0);
    vi.stubGlobal('innerHeight', 2000);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(view.getByTestId('height').textContent).toBe(before);
  });

  test('never adds a "scroll" event listener (design.md §2: mount + resize only, deliberately not scroll)', () => {
    stubRectTop(100);
    vi.stubGlobal('innerHeight', 800);
    const addSpy = vi.spyOn(window, 'addEventListener');

    render(createElement(Probe, { bottomMarginPx: 24 }));

    expect(addSpy.mock.calls.some(([type]) => type === 'scroll')).toBe(false);
    expect(addSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);
  });

  test('removes the resize listener on unmount', () => {
    stubRectTop(100);
    vi.stubGlobal('innerHeight', 800);
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const view = render(createElement(Probe, { bottomMarginPx: 24 }));
    view.unmount();

    expect(removeSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);
  });

  /**
   * Regression class for the real bug found via live-browser QA (not a unit
   * test) on a real `SessionDetail` page: the container's `rect.top` at
   * *mount* is always deep off-screen on any realistically long page (well
   * below `AGENT_TRACK_MIN_HEIGHT_PX`-equivalent inputs), and neither mount
   * nor `resize` alone ever recomputes as the user scrolls the container
   * into view -- so the caller's `Math.max(raw, AGENT_TRACK_MIN_HEIGHT_PX)`
   * clamp was ALWAYS hitting the floor in practice, not just "occasionally
   * stale". These tests mount the hook with the container positioned far
   * below the viewport (simulating a long real page, not an isolated-render
   * test DOM), then simulate the container coming into view via the
   * `IntersectionObserver` mechanism, and assert the computed height
   * actually updates away from the deeply-negative mount-time value to a
   * correct, positive one -- the missing test class that let the original
   * bug ship undetected.
   */
  describe('re-measures when the container scrolls into view (IntersectionObserver)', () => {
    test('creates an IntersectionObserver observing the ref-attached node', () => {
      stubRectTop(4576);
      vi.stubGlobal('innerHeight', 810);
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      const node = view.getByTestId('height');

      expect(FakeIntersectionObserver.instances).toHaveLength(1);
      expect(FakeIntersectionObserver.instances[0]?.observedTargets).toEqual([node]);
    });

    test('a long-page container (deeply off-screen at mount, floored in practice by the caller) recomputes to a real, larger value once it intersects the viewport', () => {
      // Mirrors the live-reproduced numbers from real-browser QA: a
      // container far down a long page (`rect.top` ~4576px) against a
      // window.innerHeight of 810px -- deeply negative, which the caller's
      // own Math.max(raw, 88) clamp would floor at mount.
      stubRectTop(4576);
      vi.stubGlobal('innerHeight', 810);
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      expect(view.getByTestId('height').textContent).toBe(String(810 - 4576 - 24));

      // The user has now scrolled the container into view -- its top edge
      // is a real, small viewport offset, and the browser fires the
      // IntersectionObserver callback reporting it now intersects.
      stubRectTop(60);
      const observer = FakeIntersectionObserver.instances[0] as FakeIntersectionObserver;
      act(() => {
        observer.trigger(true);
      });

      const updated = Number(view.getByTestId('height').textContent);
      expect(updated).toBe(810 - 60 - 24);
      expect(updated).toBeGreaterThan(88); // above AGENT_TRACK_MIN_HEIGHT_PX -- not stuck at the floor
    });

    test('disconnects the IntersectionObserver on unmount', () => {
      stubRectTop(4576);
      vi.stubGlobal('innerHeight', 810);
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      const observer = FakeIntersectionObserver.instances[0];
      expect(observer?.disconnected).toBe(false);

      view.unmount();

      expect(observer?.disconnected).toBe(true);
    });

    test('gracefully skips live intersection tracking (no throw) when IntersectionObserver does not exist, matching ResizeObserver-guard convention', () => {
      stubRectTop(4576);
      vi.stubGlobal('innerHeight', 810);
      // Deliberately NOT stubbing IntersectionObserver -- happy-dom has none
      // by default, exercising the `typeof IntersectionObserver ===
      // 'undefined'` guard path.
      expect(() => render(createElement(Probe, { bottomMarginPx: 24 }))).not.toThrow();
    });
  });
});
