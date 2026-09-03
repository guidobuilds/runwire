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
 * Formula, computed on mount, on each `resize`, and on each `IntersectionObserver`
 * crossing (see below): `window.innerHeight - ref.current.getBoundingClientRect().top
 * - bottomMarginPx`. `ref` attaches to the *outer* bounded-scroll div itself
 * (not the lane stack or any individual lane) -- `.top` is that div's own top
 * edge in real viewport px.
 *
 * BUG FIX (post-passing manual browser QA, timeline-chart-usability
 * progress.md): the original mount+resize-only version was live-verified to
 * be functionally broken on any real, full-length `SessionDetail` page --
 * `AgentTrack`'s container sits far below several sections (header,
 * diagnostics, token breakdown, counts, agents table, trace ribbon) before
 * the Timeline section even starts, so at mount `rect.top` is always deep
 * off-screen and the mount-time formula is always deeply negative. Since nothing
 * ever recomputed after mount except a `window` `resize` (which does not fire
 * from scrolling), the container was ALWAYS floored at
 * `AGENT_TRACK_MIN_HEIGHT_PX`, in practice, on every realistic page --
 * defeating the whole feature, not just "slightly stale" as originally
 * disclosed. happy-dom unit tests never caught this because they mount
 * `AgentTrack` in isolation near the top of the test DOM, never inside a long
 * page, so `rect.top` in tests was always small/reasonable.
 *
 * Fix: an `IntersectionObserver` (guarded the same
 * `typeof X === 'undefined'` way `useContainerWidth` guards `ResizeObserver`)
 * watches the same ref'd node and re-runs `measure()` on every intersection
 * change (entering/leaving the `rootMargin`-expanded viewport), in addition
 * to mount + `resize`. This is a deliberately different tradeoff than a raw
 * `scroll` listener (design.md §2's original, explicitly rejected mechanism,
 * still rejected): `IntersectionObserver` callbacks are coalesced by the
 * browser and only fire on real threshold crossings -- a handful of times as
 * the container enters/leaves view -- not on every scroll pixel/frame, so it
 * does not reintroduce the layout-thrashing/jank risk §2 originally flagged.
 * `rootMargin: '200px 0px'` intentionally fires the recompute slightly
 * *before* the container is fully on-screen (as the user scrolls toward it),
 * so the height is already correct by the time it is actually visible rather
 * than popping in a frame late. The accepted remaining gap (unchanged from
 * §2's own disclosure): the value can still go mildly stale if the user
 * scrolls further *while already intersecting* without a new threshold
 * crossing or a resize -- this is fine, since "close enough once the chart is
 * relevant" is the actual goal, not per-pixel scroll fidelity.
 *
 * Returns `0` before the ref's first measurement, matching
 * `useContainerWidth`'s own pre-layout `0` convention. Does NOT itself apply
 * `AGENT_TRACK_MIN_HEIGHT_PX`'s floor -- that clamp is the caller's
 * (`AgentTrack`'s) responsibility, via `Math.max(rawAvailableHeight,
 * AGENT_TRACK_MIN_HEIGHT_PX)`, so this hook's raw return value stays
 * independently testable (a genuinely low/negative raw number is real
 * evidence the caller's own `Math.max` clamp is doing real work, not
 * camouflaging an already-floored value).
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
      setHeight(window.innerHeight - node.getBoundingClientRect().top - bottomMarginPx);
    };

    measure();

    window.addEventListener('resize', measure);

    // happy-dom has no `IntersectionObserver` implementation at all (same
    // gap as `ResizeObserver` in `useContainerWidth`) -- guarded the same
    // way, so the mount + resize measurement above still works everywhere,
    // and only the live re-measure-on-visibility-change behavior is skipped
    // where the API genuinely doesn't exist.
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(() => measure(), { rootMargin: '200px 0px' });
      observer.observe(node);
    }

    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [bottomMarginPx]);

  return [ref, height];
}
