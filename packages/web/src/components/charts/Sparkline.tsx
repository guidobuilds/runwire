import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { Tooltip } from '../primitives/Tooltip';
import { KIND_COLOR } from './chart-theme';

export type SparklineProps = {
  data: readonly number[];
  width?: number;
  height?: number;
  /** var(--token) color string, e.g. from chart-theme's KIND_COLOR/USAGE_COLOR. */
  color?: string;
  /** Accessible label for the chart as a whole. */
  label?: string;
};

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 28;
const DEFAULT_COLOR = KIND_COLOR.model;
const DEFAULT_LABEL = 'Activity';

/** Small inset so the first/last point and the line's caps aren't clipped by the viewBox edge. */
const INSET = 2;
const POINT_RADIUS = 1.5;

/**
 * Reuses `MetricCell`'s `ABSENCE_TONE` convention (zinc-500/zinc-400, WCAG-AA
 * on both light and dark) rather than inventing a second muted color for
 * "nothing to show" -- italic (not color) is what tells this apart from a
 * normal label.
 */
const EMPTY_TONE = 'italic text-xs text-zinc-500 dark:text-zinc-400';

/**
 * A tiny polyline chart over an ordered numeric series (design.md §4 L3 chart
 * layer). Built on `@visx/shape`'s `LinePath` + `@visx/scale`'s `scaleLinear`
 * + `@visx/group`'s `Group`, scaled purely via SVG `viewBox` +
 * `preserveAspectRatio="none"` rather than `@visx/responsive`'s `ParentSize`
 * (unneeded here, and this repo has an open v4-API-migration caution around
 * it) -- the caller can size the chart with ordinary CSS/flex/grid and the
 * `<svg>` scales to fit.
 *
 * `data.length < 2` (empty or a single point) renders an explicit "No
 * activity" state instead of a blank/degenerate line: one point has no slope
 * to draw, and a hidden/blank chart with no data-mark equivalent would be
 * silently misleading (design.md §4 -- a chart is never the only place a
 * number appears, and here there is no number to show at all).
 *
 * Every exact value is independently queryable/reachable without hovering:
 * the whole series is on the wrapping `Tooltip`'s native `title`, and each
 * point additionally carries its own value as an SVG `<title>` on its
 * `<circle>`.
 */
export function Sparkline({
  data,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  color = DEFAULT_COLOR,
  label = DEFAULT_LABEL,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <span role="img" aria-label="No activity" className="inline-flex items-center">
        <span className={EMPTY_TONE}>No activity</span>
      </span>
    );
  }

  const xScale = scaleLinear({
    domain: [0, data.length - 1],
    range: [INSET, width - INSET],
  });

  const min = Math.min(...data);
  const max = Math.max(...data);
  // Degenerate case: every value in the series is equal, so a [min, max]
  // domain has zero span and d3's linear scale would divide by zero, turning
  // every y into NaN. Widen the domain by +/-1 around the shared value
  // instead -- the line still draws, flat, at mid-height.
  const yDomain: [number, number] = min === max ? [min - 1, min + 1] : [min, max];
  const yScale = scaleLinear({
    // SVG y grows downward, so the range is inverted: the max data value
    // maps to the smaller y (higher on screen).
    domain: yDomain,
    range: [height - INSET, INSET],
  });

  const seriesText = data.join(', ');

  return (
    <Tooltip content={seriesText} className="inline-block">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
      >
        <Group>
          <LinePath
            data={data as number[]}
            x={(_d, i) => xScale(i)}
            y={(d) => yScale(d)}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
          />
          {data.map((value, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: the series index IS the x-position, not a swappable identity
              key={i}
              cx={xScale(i)}
              cy={yScale(value)}
              r={POINT_RADIUS}
              fill={color}
            >
              <title>{value}</title>
            </circle>
          ))}
        </Group>
      </svg>
    </Tooltip>
  );
}
