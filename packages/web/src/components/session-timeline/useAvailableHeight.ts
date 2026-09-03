import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * Viewport-based available-height ref hook (timeline-chart-usability
 * design.md §2, f2-t1) -- `AgentTrack`'s bounded-scroll container's default-
 * fit mechanism. Sibling to `useContainerWidth.ts` and follows its exact
 * pattern (ref-returning hook, `useEffect`-based measurement on mount, a live
 * browser-native listener, a `typeof`-guard so this repo's Vitest
 * environment, happy-dom, degrades gracefully rather than requiring every
 * consuming test to stub a global it doesn't otherwise care about).
 *
 * Formula, computed on mount, on each `resize`, and on each (rAF-throttled)
 * `scroll`: `window.innerHeight - ref.current.getBoundingClientRect().top -
 * bottomMarginPx`. `ref` attaches to the *outer* bounded-scroll div itself
 * (not the lane stack or any individual lane) -- `.top` is that div's own top
 * edge in real viewport px.
 *
 * HISTORY (three rounds of live-browser bug reports against this one hook --
 * read this before touching the mechanism again):
 *
 * 1. Mount+resize-only (original design.md §2 decision). Live-verified
 *    broken on any real, full-length `SessionDetail` page: `AgentTrack`'s
 *    container sits far below several sections before Timeline even starts,
 *    so at mount `rect.top` is always deep off-screen and the formula is
 *    always deeply negative. Nothing but `window` `resize` ever recomputed
 *    (scrolling does not fire `resize`), so the container was ALWAYS floored
 *    at `AGENT_TRACK_MIN_HEIGHT_PX` on every realistic page.
 * 2. `IntersectionObserver`-only fix (f2-t7). Recomputed on visibility-
 *    threshold crossings (`rootMargin: '200px 0px'`) in addition to
 *    mount+resize. This was CONFIRMED INSUFFICIENT by a direct user report
 *    (two screenshots, not just a theoretical gap): scrolling up and down the
 *    page produced an inconsistent computed height -- sometimes correct,
 *    sometimes stuck at the ~88px floor -- depending on exactly how/when the
 *    user scrolled, and it never self-corrected on further scrolling once
 *    already visible. Root cause: `IntersectionObserver` callbacks only fire
 *    on ratio-threshold crossings (roughly, transitioning between "not
 *    intersecting" and "intersecting"). Once the container is fully inside
 *    the (rootMargin-expanded) viewport, its ratio sits at ~1.0 and stays
 *    there even as the user keeps scrolling and `rect.top` keeps changing --
 *    no further callback fires, so whatever `top` happened to be at the one
 *    crossing moment is permanently baked in as the max-height (correct or
 *    not) until the next `resize` or a full unmount/remount. That is exactly
 *    the user's symptom: the result depended on incidental scroll timing at
 *    the moment of that single crossing, not on the container's actual
 *    current position.
 * 3. rAF-throttled `scroll` listener (this fix, f2-t9). A passive, capturing
 *    `window` `scroll` listener that does no work itself -- it only checks
 *    whether a `requestAnimationFrame` callback is already pending and, if
 *    not, schedules exactly one. The actual `getBoundingClientRect()` +
 *    `setState` work happens inside that single per-frame callback. This
 *    coalesces a potentially-hundreds-per-second stream of scroll events down
 *    to at most one recompute per animation frame (~60/s ceiling, matching
 *    the browser's own paint cadence) -- a well-established, perf-safe
 *    pattern, categorically different from an unthrottled "recompute on every
 *    scroll tick" listener (design.md §2's original, still-correctly-
 *    rejected concern). Unlike `IntersectionObserver`, this recomputes
 *    continuously for as long as the user keeps scrolling, regardless of
 *    whether the container has already crossed into view, so it has no
 *    "goes stale once already visible" gap. `capture: true` is set because
 *    `scroll` does not bubble -- a capturing listener on `window` still
 *    observes scroll events dispatched at any scrollable descendant on their
 *    way down to the target, which document/body-level page-scroll and any
 *    nested scroll container both satisfy.
 *
 *    The `IntersectionObserver` from round 2 is REMOVED, not kept alongside
 *    this. Every case it covered (the container crossing into view) is a
 *    strict subset of "the user is scrolling", which the rAF-throttled
 *    `scroll` listener now handles continuously and correctly -- keeping both
 *    would mean two independent recompute paths for the same underlying
 *    "did the container's position change" question, for no remaining
 *    correctness benefit, at the cost of the dual-mechanism complexity that
 *    made round 2's own gap harder to spot. (`resize` is kept because it is
 *    NOT a subset of scrolling -- the container's `top` can change from a
 *    window resize with zero scroll position change.)
 * 4. Clamp `rect.top` at a minimum of `0` before subtracting it (this fix,
 *    f2-t10). BUG (found by the user via screenshot, root-caused
 *    independently by the orchestrator during its own live-browser
 *    verification of round 3's fix): the formula `window.innerHeight -
 *    rect.top - bottomMarginPx` is only sane while `rect.top >= 0` (the
 *    container's own top edge is at or below the viewport's top edge). Once
 *    the user scrolls far enough that the container's top edge moves ABOVE
 *    the viewport, `rect.top` goes negative -- and subtracting an
 *    increasingly negative number is equivalent to ADDING an increasingly
 *    large positive number to the computed height, with no upper bound.
 *    Confirmed live: `rect.top` observed going from `273` down through
 *    `-207` over 8 scroll steps, with the (buggy) computed height growing
 *    from `513` to `993` -- unbounded growth, not a floor/minimum problem.
 *    The orchestrator's own verification script had used this exact same
 *    unclamped formula to compute its "expected" value, so it incorrectly
 *    validated the growth as correct instead of catching it. FIX: clamp the
 *    `top` value used in the subtraction to `Math.max(rect.top, 0)`, so once
 *    the container has scrolled up past the viewport's own top edge, the
 *    computed height caps out at `window.innerHeight - bottomMarginPx` and
 *    does NOT keep growing as the user scrolls further. This is independent
 *    of, and composes with, `AGENT_TRACK_MIN_HEIGHT_PX`'s floor below -- one
 *    is a minimum, the other is now a maximum, and both must hold
 *    simultaneously.
 *
 * Returns `0` before the ref's first measurement, matching
 * `useContainerWidth`'s own pre-layout `0` convention. Does NOT itself apply
 * `AGENT_TRACK_MIN_HEIGHT_PX`'s floor -- that clamp is the caller's
 * (`AgentTrack`'s) responsibility, via `Math.max(rawAvailableHeight,
 * AGENT_TRACK_MIN_HEIGHT_PX)`, so this hook's raw return value stays
 * independently testable (a genuinely low/negative raw number is real
 * evidence the caller's own `Math.max` clamp is doing real work, not
 * camouflaging an already-floored value). This hook DOES apply the `top >= 0`
 * ceiling clamp itself (round 4 above) -- unlike the floor, the ceiling is
 * this hook's own formula-correctness concern, not a caller-configurable
 * policy value.
 */
export function useAvailableHeight<T extends HTMLElement>(
  bottomMarginPx: number,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // happy-dom (this repo's Vitest environment) does have a `window` global
    // and `window.innerHeight`/`addEventListener`, so this guard is mostly
    // future-proofing against a non-browser/SSR-style environment that lacks
    // `window` entirely -- mirroring `useContainerWidth`'s own defensive
    // `typeof ResizeObserver === 'undefined'` guard shape rather than
    // assuming every consumer of this hook runs in a full browser-like DOM.
    if (typeof window === 'undefined') return;

    const measure = () => {
      // Clamp `top` at 0 (see HISTORY §4 below) so that once the container
      // has scrolled up past the viewport's own top edge, the computed
      // height caps out at `window.innerHeight - bottomMarginPx` instead of
      // growing further as `top` keeps going more negative.
      const clampedTop = Math.max(node.getBoundingClientRect().top, 0);
      setHeight(window.innerHeight - clampedTop - bottomMarginPx);
    };

    measure();

    window.addEventListener('resize', measure);

    // rAF-throttled scroll recompute (see HISTORY §3 above): the `scroll`
    // listener itself is O(1) and does no measurement -- it only schedules a
    // single `requestAnimationFrame` callback, skipping the schedule
    // entirely if one is already pending for this frame. This guarantees at
    // most one `getBoundingClientRect()`/`setState` pair per animation
    // frame, no matter how many scroll events fire in between.
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, { capture: true });
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [bottomMarginPx]);

  return [ref, height];
}
