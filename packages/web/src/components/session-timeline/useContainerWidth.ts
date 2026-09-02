import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * `ResizeObserver`-based ref hook measuring the real rendered CSS pixel width
 * of a container (design.md §3.5) — the shared cursor / hover-to-domain
 * mapping's one genuinely new interaction primitive; no precedent for it
 * exists anywhere else in `packages/web/src` (`TraceRibbon` never tracked
 * pointer position or a live container width). Returns a ref to attach to
 * the measured element and the element's current CSS pixel width (`0` before
 * the first layout/observation).
 */
export function useContainerWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    setWidth(node.getBoundingClientRect().width);

    // happy-dom (this repo's Vitest environment) has no `ResizeObserver`
    // implementation at all, and this hook is now wired into `SessionTimeline`
    // (f8) — mounted by tests that never stub `ResizeObserver` themselves
    // (only `useContainerWidth.test.ts` does, deliberately, to exercise the
    // resize-tracking behavior). Guarding here, rather than requiring every
    // such test file to stub a global it doesn't otherwise care about, keeps
    // the initial-measurement value (from `getBoundingClientRect` above)
    // working everywhere and only skips live resize tracking where the API
    // genuinely doesn't exist — a real defensive check, not a workaround for
    // this one gap (some older/embedded runtimes also lack `ResizeObserver`).
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** Minimal shape `pointerToElapsedMs` needs from a `getBoundingClientRect()` result. */
export type ContainerRectLike = { left: number; width: number };

/** Minimal shape `pointerToElapsedMs` needs from `TimelineContextValue.xScale`. */
export type InvertibleScale = { invert: (value: number) => number };

/**
 * Converts a pointer event's `clientX` (real screen/viewport px) into an
 * elapsed-ms domain value, per design.md §3.5's three-step conversion:
 * 1. `clientX - containerRect.left` -> the pointer's offset in real CSS px
 *    from the container's left edge.
 * 2. `(pxOffset / containerRect.width) * nominalWidth` -> the same offset
 *    rescaled into the SVG's nominal `viewBox` units (`TimelineContextValue
 *    .width`), since the container's live CSS width and the chart's nominal
 *    viewBox width are independent (`preserveAspectRatio="none"` scaling,
 *    same convention as `TraceRibbon`/`Sparkline`).
 * 3. `xScale.invert(...)` -> the viewBox-units x-position back to its
 *    elapsed-ms domain value.
 *
 * Returns `0` (rather than `NaN`/`Infinity`) when `containerRect.width` is
 * `0` — the container hasn't been laid out/measured yet — since callers
 * (hover handlers) run continuously and a transient odd value would flash
 * the shared cursor to a nonsensical position.
 */
export function pointerToElapsedMs(
  clientX: number,
  containerRect: ContainerRectLike,
  nominalWidth: number,
  xScale: InvertibleScale,
): number {
  if (containerRect.width === 0) return xScale.invert(0);
  const pxOffset = clientX - containerRect.left;
  const viewBoxOffset = (pxOffset / containerRect.width) * nominalWidth;
  return xScale.invert(viewBoxOffset);
}
