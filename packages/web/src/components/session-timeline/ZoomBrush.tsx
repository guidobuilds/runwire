import { type RefObject, useEffect, useState } from 'react';
import { type TimelineDomain, useTimeline } from './TimelineContext';
import { pointerToElapsedMs } from './useContainerWidth';

/**
 * Drag-to-zoom overlay (f9-t2): lets a user click-drag a horizontal range
 * over the tracks and, on release, narrows the shared `TimelineContext`
 * domain to that range. One instance is mounted once by `SessionTimeline`,
 * spanning all 4 tracks + the axis, the same way `SharedCursor` (f8) is one
 * shared hover overlay rather than four per-track ones.
 *
 * **Mechanism decision (a judgment call design.md explicitly left open):**
 * reuses `TimelineContext`'s existing `selectedRange`/`setSelectedRange`
 * plumbing (present since f3, real state, unused by any UI until now) rather
 * than adding a new context field or a raw callback that bypasses it —
 * `selectedRange` was reserved for exactly this. `ZoomBrush` both WRITES it
 * (`setSelectedRange(range)` on a completed drag) and OBSERVES it (an effect
 * keyed on `selectedRange`) to forward the range to its `onZoom` prop, then
 * clears it back to `null` — a one-shot signal, not durable selection state.
 * `SessionTimeline`'s domain state lives one level *outside* the
 * `TimelineProvider` it renders (so it cannot call `useTimeline()` itself);
 * `ZoomBrush` is the component already inside the provider that needs both
 * ends of this wire, so it is the natural place for the observing effect,
 * documented here rather than adding a second bridging component.
 *
 * **Hit-testing decision:** deliberately renders NO new element stacked over
 * the tracks with `pointer-events: auto` — that would sit on top of every
 * mark's own `<svg role="img">` (TokenTrack/AgentTrack/HarnessTrack/
 * ComponentTrack) and silently swallow every click before it ever reaches
 * them, breaking f6's click-to-select. Instead this component attaches
 * *native* `mousedown`/`mousemove`/`mouseup` listeners directly to
 * `containerRef` — the same `data-slot="timeline-tracks"` ancestor every
 * track's `<svg>` already lives inside (via `useContainerWidth`'s ref in
 * `SessionTimeline.tsx`) — so drag gestures are detected via normal DOM
 * event bubbling with zero new elements in the paint order. Its own rendered
 * JSX is a pure, `pointer-events-none` visual selection rectangle, styled
 * exactly like `SharedCursor`'s overlay and mounted in the same positioned
 * `data-slot="shared-cursor-inset"` ancestor. Position/width use
 * `pointerToElapsedMs`/`xScale` against `plotRef`'s real rect — the exact
 * plot-column rect `SharedCursor`'s percentage math already resolves
 * against (f8) — not `containerRef`'s rect, which also includes the shared
 * label gutter.
 *
 * A drag that ends on top of a mark also fires a native `click` immediately
 * after `mouseup` — without suppressing it, finishing a zoom-drag over a
 * mark would also fire that mark's own click-to-select, opening the wrong
 * thing. A capture-phase `click` listener on `containerRef` swallows exactly
 * one such click, only when the just-finished gesture actually crossed the
 * drag threshold.
 *
 * **Double-click reset (f9-t3, secondary affordance):** also attached as a
 * native `dblclick` listener on `containerRef` in this same effect, rather
 * than a JSX `onDoubleClick` prop on `SessionTimeline`'s own tracks div —
 * that div is a plain `<div>` with no interactive ARIA role, so Biome's
 * `noStaticElementInteractions` correctly rejects attaching a raw event-
 * handler prop to it; a native listener sidesteps that (same reasoning
 * already applies to every other listener in this file) without inventing a
 * role for an element that isn't semantically interactive.
 */

const MIN_DRAG_PX = 5; // ignores accidental micro-drags/clicks

export type ZoomBrushProps = {
  /** Ancestor of every track's `<svg>` (`SessionTimeline`'s `data-slot="timeline-tracks"` ref) — native listeners attach here so a plain click still reaches the actual clicked element untouched. */
  containerRef: RefObject<HTMLElement | null>;
  /** The plot-only rect `SharedCursor`'s positioned ancestor already uses (`data-slot="shared-cursor-inset"`) — excludes the shared label gutter, matching every track's own hover-mapping rect. */
  plotRef: RefObject<HTMLElement | null>;
  /** Called once per completed drag-selection with the narrowed `[lo, hi]` range. */
  onZoom: (range: TimelineDomain) => void;
  /** Double-click on the tracks area (f9-t3's secondary reset affordance) — restores the full-session domain. Optional so a caller with no reset control can still use drag-to-zoom alone. */
  onResetZoom?: () => void;
};

export function ZoomBrush({ containerRef, plotRef, onZoom, onResetZoom }: ZoomBrushProps) {
  const { xScale, width, selectedRange, setSelectedRange } = useTimeline();
  const [dragStartMs, setDragStartMs] = useState<number | null>(null);
  const [dragCurrentMs, setDragCurrentMs] = useState<number | null>(null);

  // Forwards a completed drag-selection (written by this component's own
  // mouseup handler below) to the domain-state owner, then clears it -- see
  // the "mechanism decision" doc comment above.
  useEffect(() => {
    if (selectedRange) {
      onZoom(selectedRange);
      setSelectedRange(null);
    }
  }, [selectedRange, onZoom, setSelectedRange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragging = false;
    let movedPastThreshold = false;
    let justDragged = false;
    let startClientX: number | null = null;
    let startMs: number | null = null;

    const elapsedAt = (clientX: number): number | null => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return pointerToElapsedMs(clientX, rect, width, xScale);
    };

    const reset = () => {
      dragging = false;
      movedPastThreshold = false;
      startClientX = null;
      startMs = null;
      setDragStartMs(null);
      setDragCurrentMs(null);
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const ms = elapsedAt(event.clientX);
      if (ms === null) return;
      // Clears any stale suppression flag from a drag that ended via
      // `mouseleave` (no real browser `click` ever follows that gesture, so
      // `handleClickCapture` never got a chance to consume it) -- otherwise
      // an unrelated later click could be silently swallowed.
      justDragged = false;
      dragging = true;
      movedPastThreshold = false;
      startClientX = event.clientX;
      startMs = ms;
      setDragStartMs(ms);
      setDragCurrentMs(ms);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragging) return;
      if (startClientX !== null && Math.abs(event.clientX - startClientX) >= MIN_DRAG_PX) {
        movedPastThreshold = true;
      }
      const ms = elapsedAt(event.clientX);
      if (ms !== null) setDragCurrentMs(ms);
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (!dragging) return;
      const endMs = elapsedAt(event.clientX);
      const finalStartMs = startMs;
      const wasRealDrag = movedPastThreshold;
      reset();
      if (!wasRealDrag || finalStartMs === null || endMs === null) return;
      justDragged = true;
      const [lo, hi] = finalStartMs <= endMs ? [finalStartMs, endMs] : [endMs, finalStartMs];
      setSelectedRange([lo, hi]);
    };

    const handleMouseLeave = (event: MouseEvent) => {
      // A drag that leaves the tracks area before release still completes
      // with the last tracked position, matching common brush-select UX
      // (e.g. d3-brush) rather than silently discarding the gesture.
      if (dragging) handleMouseUp(event);
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (!justDragged) return;
      justDragged = false;
      event.stopPropagation();
    };

    const handleDoubleClick = () => onResetZoom?.();

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('click', handleClickCapture, { capture: true });
    container.addEventListener('dblclick', handleDoubleClick);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('click', handleClickCapture, { capture: true });
      container.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [containerRef, plotRef, width, xScale, setSelectedRange, onResetZoom]);

  const isDragging = dragStartMs !== null && dragCurrentMs !== null;
  if (!isDragging) return null;

  const startPercent = (xScale(dragStartMs) / width) * 100;
  const currentPercent = (xScale(dragCurrentMs) / width) * 100;
  const leftPercent = Math.min(startPercent, currentPercent);
  const widthPercent = Math.abs(currentPercent - startPercent);

  return (
    <div
      data-slot="zoom-brush-selection"
      className="pointer-events-none absolute inset-y-0 bg-zinc-400/25 dark:bg-zinc-300/20"
      style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
    />
  );
}
