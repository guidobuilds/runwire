import { AxisBottom } from '@visx/axis';
import { LABEL_GUTTER_WIDTH, useTimeline } from './TimelineContext';

/**
 * Timeline axis (design.md §3.1: "mm:ss ticks, bottom, @visx/axis"). Purely a
 * function of `TimelineContextValue` — no external data prop — so it stays
 * pixel-aligned with the four tracks stacked above/below it via the same
 * `xScale`/`width` viewBox convention every track already uses.
 */

const DEFAULT_HEIGHT = 24;
const NUM_TICKS = 5;

/** "mm:ss" from an elapsed-ms value. Local helper, matching every track's own copy (no shared mm:ss formatter exists yet in `lib/format.ts` — deliberately deferred to here per design.md/progress.md, but this component still keeps its own local copy rather than being the one to add it, to match the exact-file-list convention every other track already follows). */
function formatElapsed(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${sign}${min}:${String(sec).padStart(2, '0')}`;
}

export type TimelineAxisProps = {
  height?: number;
};

export function TimelineAxis({ height = DEFAULT_HEIGHT }: TimelineAxisProps) {
  const { xScale, width } = useTimeline();

  return (
    <div data-slot="timeline-axis" className="flex items-center gap-2">
      {/* Empty label-gutter placeholder cell (f8): same fixed width every
          track row reserves, so the axis's own <svg> starts at the identical
          real-pixel x-origin as every track's plot area. */}
      <span aria-hidden="true" className={`${LABEL_GUTTER_WIDTH} shrink-0`} />
      <svg
        role="img"
        aria-label="Timeline axis"
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        height={height}
        preserveAspectRatio="none"
        className="min-w-0 flex-1"
      >
        <AxisBottom
          top={0}
          scale={xScale}
          numTicks={NUM_TICKS}
          tickFormat={(value) => formatElapsed(Number(value))}
          stroke="var(--border)"
          tickStroke="var(--border)"
          tickLabelProps={(_value, index, values) => ({
            fill: 'var(--muted-foreground)',
            fontSize: 10,
            // Centering every label ('middle') puts half the leftmost tick's
            // text at x<0 and half the rightmost tick's text at x>width --
            // both clipped by the svg's own bounds (SVG's default overflow is
            // hidden), which reads as the axis time being "cut off" against
            // the track box's edge. The first/last tick instead anchor
            // inward (start/end) so their text never extends past [0, width];
            // interior ticks keep centering since they have room on both
            // sides.
            // No `dy` override: `@visx/text` (which `AxisBottom` uses
            // internally for each label) applies `dy` by nesting the text in
            // its own `<svg y={dy}>`, which STACKS on top of the `y`
            // AxisBottom already computed for the label (itself already
            // placed below the tick line) rather than replacing it. With
            // `dy: '0.75em'` here, that pushed the label's real vertical
            // position past this axis's own 24px-tall viewBox, so browsers
            // (whose default SVG overflow is hidden) clipped it against this
            // svg's bottom edge — read as the time being "cut off" against
            // the track box's border. AxisBottom's own default `y` already
            // places the label sensibly below the tick line with no extra
            // offset needed.
            textAnchor: index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle',
          })}
        />
      </svg>
    </div>
  );
}
