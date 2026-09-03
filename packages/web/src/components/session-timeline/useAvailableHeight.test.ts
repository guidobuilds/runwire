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

/**
 * A deterministic, single-slot fake `requestAnimationFrame` -- real browsers
 * batch all `rAF` callbacks scheduled within the same tick into a single
 * upcoming frame, but real frame timing is not something a Vitest/happy-dom
 * test can (or should) wait on. This fake models exactly the one property
 * the hook's throttling depends on: only ONE callback can be pending at a
 * time (a second `requestAnimationFrame` call before `flush()` overwrites
 * the pending slot rather than queuing a second one), and `flush()` runs it
 * synchronously so assertions don't need real timers.
 */
function stubRaf() {
  let pending: FrameRequestCallback | null = null;
  let nextId = 1;
  const raf = vi.fn((cb: FrameRequestCallback) => {
    pending = cb;
    return nextId++;
  });
  const caf = vi.fn(() => {
    pending = null;
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  return {
    raf,
    caf,
    hasPending: () => pending !== null,
    flush() {
      const cb = pending;
      pending = null;
      if (cb) act(() => cb(0));
    },
  };
}

describe('useAvailableHeight', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  test('does not recompute on an unrelated event (no listener fires for an arbitrary, unhandled event type)', () => {
    stubRectTop(100);
    vi.stubGlobal('innerHeight', 800);

    const view = render(createElement(Probe, { bottomMarginPx: 24 }));
    const before = view.getByTestId('height').textContent;

    stubRectTop(0);
    vi.stubGlobal('innerHeight', 2000);
    act(() => {
      window.dispatchEvent(new Event('some-unrelated-event'));
    });

    expect(view.getByTestId('height').textContent).toBe(before);
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
   * Round 3 fix (f2-t9): the mount+resize+IntersectionObserver mechanism
   * from f2-t7 was proven insufficient by a direct user report -- scrolling
   * with the container already fully visible never recomputes, since
   * IntersectionObserver only fires on visibility-threshold crossings, not
   * on every position change. This describe block covers the replacement
   * mechanism: a passive, capturing `scroll` listener that schedules at most
   * one `requestAnimationFrame`-deferred recompute at a time.
   */
  describe('rAF-throttled scroll recompute (replaces the f2-t7 IntersectionObserver mechanism)', () => {
    test('adds a passive, capturing "scroll" listener on mount', () => {
      stubRectTop(100);
      vi.stubGlobal('innerHeight', 800);
      const addSpy = vi.spyOn(window, 'addEventListener');

      render(createElement(Probe, { bottomMarginPx: 24 }));

      const scrollCall = addSpy.mock.calls.find(([type]) => type === 'scroll');
      expect(scrollCall).toBeDefined();
      expect(scrollCall?.[2]).toMatchObject({ passive: true, capture: true });
    });

    test('many rapid scroll events within one animation frame trigger the expensive recompute at most once, not once per event', () => {
      stubRectTop(100);
      vi.stubGlobal('innerHeight', 800);
      const rafStub = stubRaf();

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      expect(view.getByTestId('height').textContent).toBe(String(800 - 100 - 24));

      // The value changes mid-scroll-burst, but since none of these events
      // have been flushed through a frame yet, only the FIRST scroll event's
      // rAF should end up governing the eventual recompute -- proving the
      // listener itself does no `getBoundingClientRect()`/`setState` work.
      stubRectTop(10);
      act(() => {
        for (let i = 0; i < 50; i++) {
          window.dispatchEvent(new Event('scroll'));
        }
      });

      // Unthrottled, 50 scroll events would mean 50 getBoundingClientRect +
      // setState calls; here, the DOM has not been touched yet at all --
      // the work is still pending inside the single scheduled frame.
      expect(view.getByTestId('height').textContent).toBe(String(800 - 100 - 24));
      expect(rafStub.raf).toHaveBeenCalledTimes(1);

      rafStub.flush();

      expect(view.getByTestId('height').textContent).toBe(String(800 - 10 - 24));

      // A fresh scroll burst after the frame flushed schedules exactly one
      // new frame, confirming the throttle re-arms rather than staying
      // permanently latched after its first use.
      stubRectTop(5);
      act(() => {
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('scroll'));
      });
      expect(rafStub.raf).toHaveBeenCalledTimes(2);
      rafStub.flush();
      expect(view.getByTestId('height').textContent).toBe(String(800 - 5 - 24));
    });

    /**
     * Regression test for the exact user-reported bug shape (two
     * screenshots, live report -- not just a theoretical IntersectionObserver
     * gap): the container starts fully visible/"intersecting" (no new
     * visibility crossing ever happens across this whole scenario), the user
     * keeps scrolling, and `getBoundingClientRect().top` keeps changing to
     * imply progressively more available space. The old IntersectionObserver-
     * only mechanism could never recompute here (ratio stays ~1.0 throughout,
     * no threshold crossing) -- this is the scenario it structurally could
     * not handle and no prior unit test covered.
     */
    test('continues to recompute as the user keeps scrolling with the container already fully visible (no visibility crossing occurs)', () => {
      // Container already on-screen at a position that happens to compute a
      // small (but not floored) available height -- e.g. right after the
      // page finished an initial layout, mid-scroll.
      stubRectTop(700);
      vi.stubGlobal('innerHeight', 800);
      const rafStub = stubRaf();

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      const initial = Number(view.getByTestId('height').textContent);
      expect(initial).toBe(800 - 700 - 24); // 76: small, near/at the caller's floor

      // The user keeps scrolling the page further -- the container's own
      // top edge moves up the viewport (a normal consequence of continued
      // scrolling), implying much more real available space below it. The
      // container was already fully "intersecting" before this and remains
      // so throughout -- no IntersectionObserver-style crossing occurs.
      stubRectTop(120);
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      rafStub.flush();

      const updated = Number(view.getByTestId('height').textContent);
      expect(updated).toBe(800 - 120 - 24); // 656: much larger, correctly reflecting the new position
      expect(updated).toBeGreaterThan(initial);

      // And it keeps tracking further continued scrolling too, not just a
      // single one-shot correction.
      stubRectTop(40);
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      rafStub.flush();
      expect(view.getByTestId('height').textContent).toBe(String(800 - 40 - 24));
    });

    test('cancels a pending animation frame on unmount', () => {
      stubRectTop(100);
      vi.stubGlobal('innerHeight', 800);
      const rafStub = stubRaf();

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      expect(rafStub.hasPending()).toBe(true);

      view.unmount();

      expect(rafStub.caf).toHaveBeenCalled();
    });

    test('removes the scroll listener on unmount', () => {
      stubRectTop(100);
      vi.stubGlobal('innerHeight', 800);
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      view.unmount();

      expect(removeSpy.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
    });
  });

  /**
   * Round 4 fix (f2-t10): a real, screenshotted user bug found AFTER round
   * 3's fix was independently verified passing. Once the container's own
   * `rect.top` goes negative (the user has scrolled far enough that the
   * container's top edge moved ABOVE the viewport's top edge), the unclamped
   * formula `innerHeight - top - bottomMarginPx` grows WITHOUT BOUND as the
   * user keeps scrolling further -- subtracting an increasingly negative
   * `top` is equivalent to adding an increasingly large positive number. The
   * fix clamps `top` at a minimum of `0` before the subtraction, so the
   * computed height caps out at exactly `innerHeight - bottomMarginPx` and
   * does not grow further purely because `top` went more negative.
   */
  describe('ceiling clamp when the container has scrolled past the viewport top (f2-t10)', () => {
    test('a negative top caps the height at exactly innerHeight - bottomMarginPx, not a larger unbounded value', () => {
      stubRectTop(-500);
      vi.stubGlobal('innerHeight', 800);

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));

      // Unclamped, the old formula would compute 800 - (-500) - 24 = 1276 --
      // far larger than the viewport itself. The fix must cap at 800 - 24.
      expect(view.getByTestId('height').textContent).toBe(String(800 - 24));
    });

    test('an even more negative top (simulating scrolling much further past) produces an IDENTICAL height, proving it is truly capped, not just reduced-but-still-growing', () => {
      stubRectTop(-5000);
      vi.stubGlobal('innerHeight', 800);

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));

      expect(view.getByTestId('height').textContent).toBe(String(800 - 24));
    });

    test('the cap is reachable via continued scrolling too, not just at mount: top going from positive to deeply negative across scroll events settles at the same capped value', () => {
      stubRectTop(273);
      vi.stubGlobal('innerHeight', 810);
      const rafStub = stubRaf();

      const view = render(createElement(Probe, { bottomMarginPx: 24 }));
      expect(view.getByTestId('height').textContent).toBe(String(810 - 273 - 24));

      // Reproduces the orchestrator's own 8-step live repro: top crosses
      // from positive to negative over continued scrolling.
      stubRectTop(-207);
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      rafStub.flush();
      expect(view.getByTestId('height').textContent).toBe(String(810 - 24));

      // Scrolling even further past must not grow the height any further.
      stubRectTop(-2000);
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      rafStub.flush();
      expect(view.getByTestId('height').textContent).toBe(String(810 - 24));
    });
  });
});
