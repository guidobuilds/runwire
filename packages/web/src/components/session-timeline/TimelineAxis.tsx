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
          tickLabelProps={() => ({
            fill: 'var(--muted-foreground)',
            fontSize: 10,
            textAnchor: 'middle',
            dy: '0.75em',
          })}
        />
      </svg>
    </div>
  );
}
