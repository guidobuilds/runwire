import { useTimeline } from './TimelineContext';

/**
 * Shared cursor overlay (design.md §3.1/§3.5): **one** absolutely-positioned
 * overlay `<div>` spanning the full stacked-tracks container height, not four
 * separate per-SVG lines — simpler, avoids z-index/layering issues between
 * independent `<svg>` elements, still delivers "vertical line across ALL
 * tracks" visually. Reads `cursorTime`/`xScale`/`width` from
 * `TimelineContext`; renders nothing when no track has reported a hover (or
 * pin) position.
 */

export function SharedCursor() {
  const { cursorTime, xScale, width } = useTimeline();

  if (cursorTime === null) return null;

  // Percentage of the positioned ancestor's own CSS width, not a literal
  // `${xScale(cursorTime)}px` — every track's SVG content is
  // `viewBox`+`preserveAspectRatio="none"` scaled to 100% of that ancestor's
  // real CSS width, which only equals the nominal viewBox `width` by
  // coincidence, so a percentage is what stays pixel-aligned with the tracks
  // beneath it at any container width. `SharedCursor`'s own positioned
  // ancestor is expected to be inset by the shared label-gutter width
  // (`SessionTimeline`'s `data-slot="shared-cursor-inset"` wrapper, whose
  // `left` style is set directly from `LABEL_GUTTER_PX`, f8) — its
  // content-box width must equal each track's plot `<svg>` width, not the
  // full row width (label gutter + plot), or this percentage drifts right of
  // the real hovered position.
  const leftPercent = (xScale(cursorTime) / width) * 100;

  return (
    <div
      data-slot="shared-cursor"
      className="pointer-events-none absolute inset-y-0 w-px bg-zinc-400 dark:bg-zinc-500"
      style={{ left: `${leftPercent}%` }}
    />
  );
}
