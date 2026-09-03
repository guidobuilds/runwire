import { useTimeline } from './TimelineContext';

/**
 * Shared hover-tooltip overlay (timeline-chart-usability design.md §3,
 * f1-t2). Follows the exact precedent `SharedCursor.tsx`/`ZoomBrush.tsx`
 * already set for "interaction the off-the-shelf primitive can't express":
 * `components/primitives/Tooltip.tsx`'s trigger is a real HTML `<span>`,
 * which is not valid as a direct child of an already-open `<svg>` tree (see
 * design.md §0) -- so every mark's hover tooltip is instead rendered by this
 * ONE overlay `<div>`, mounted once in `SessionTimeline.tsx` (a sibling of
 * `SharedCursor`/`ZoomBrush`), never per-track/per-mark.
 *
 * Reads `hoveredMark` from `useTimeline()` and renders nothing when it's
 * `null`. Positioned via raw `event.clientX`/`clientY` (`position: fixed`,
 * offset so the box never sits exactly under the pointer) rather than an
 * anchored trigger element -- no container-relative math, no DOM anchor.
 * Styled to visually match `ui/tooltip.tsx`'s `TooltipContent` (its static
 * `rounded-md bg-foreground px-3 py-1.5 text-xs text-background` classes),
 * dropping the floating-ui-specific positioner/animation classes since this
 * component positions manually, not via Base UI's popper. `whitespace-pre-
 * line` because every track's tooltip-text-building function
 * (`tooltipText`/`harnessTooltip`/`componentTooltip`) joins its lines with
 * `\n`.
 */

const POINTER_OFFSET_PX = 12;

export function MarkTooltip() {
  const { hoveredMark } = useTimeline();

  if (!hoveredMark) return null;

  return (
    <div
      data-slot="mark-tooltip"
      className="pointer-events-none fixed z-50 max-w-xs whitespace-pre-line rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
      style={{
        left: hoveredMark.clientX + POINTER_OFFSET_PX,
        top: hoveredMark.clientY + POINTER_OFFSET_PX,
      }}
    >
      {hoveredMark.content}
    </div>
  );
}
