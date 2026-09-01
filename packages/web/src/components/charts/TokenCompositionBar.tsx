import type { Capability, HarnessId, Usage } from '../../api/types';
import { MetricCell } from '../primitives/MetricCell';
import { CONFIDENCE_OPACITY, USAGE_BG_CLASS, USAGE_COLOR, type UsageKey } from './chart-theme';

export type TokenCompositionBarProps = {
  usage: Usage;
  harness: HarnessId;
  capabilities: readonly Capability[] | undefined;
  /** Bar strip width in px (SVG viewBox units, scaled to 100% width). */
  width?: number;
  /** Bar strip height in px; the legend below renders at normal text size. */
  height?: number;
};

/** One of the five `Usage` fields that maps 1:1 onto a `--usage-*` token. */
type UsageField = 'uncachedInput' | 'cachedInput' | 'cacheWrite' | 'output' | 'reasoningOutput';

type Segment = { field: UsageField; token: UsageKey; label: string };

/**
 * Fixed segment order (matches `MetricCell`'s own `USAGE_FIELDS` iteration
 * order minus the derived, display-only `totalInput`): design.md's 5
 * `--usage-*` tokens map 1:1 onto these 5 `Usage` fields.
 */
const SEGMENTS: readonly Segment[] = [
  { field: 'uncachedInput', token: 'uncached', label: 'Uncached input' },
  { field: 'cachedInput', token: 'cached', label: 'Cached input' },
  { field: 'cacheWrite', token: 'cache-write', label: 'Cache write' },
  { field: 'output', token: 'output', label: 'Output' },
  { field: 'reasoningOutput', token: 'reasoning', label: 'Reasoning' },
];

const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 14;

/**
 * Horizontal stacked bar over a session's token `Usage`, plus a legend that
 * gives every segment (including absent ones) an exact-number-or-glyph
 * presence via `MetricCell` — the same hardened n/a-vs-em-dash contract used
 * everywhere else in the app, not a chart-local convention.
 *
 * A segment with no metric (capability-absent or field-absent — geometry
 * cannot tell, and does not need to: either way there is no value to size a
 * rectangle from) contributes no rectangle at all, never a zero-width sliver.
 * When every segment is absent, or the present values sum to zero, the bar
 * strip is replaced by an explicit "No usage recorded" note rather than a
 * degenerate all-zero-width stack (mirrors chart empty-state conventions
 * elsewhere: an empty render must say so, not look like a bug).
 */
export function TokenCompositionBar({
  usage,
  harness,
  capabilities,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: TokenCompositionBarProps) {
  const present = SEGMENTS.filter((seg) => usage[seg.field] !== undefined);
  const total = present.reduce((sum, seg) => sum + (usage[seg.field]?.value ?? 0), 0);
  const hasData = present.length > 0 && total > 0;

  let offset = 0;

  return (
    <div>
      {hasData ? (
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Token composition"
        >
          {present.map((seg) => {
            const metric = usage[seg.field];
            if (!metric) return null;
            const segWidth = (metric.value / total) * width;
            const x = offset;
            offset += segWidth;
            return (
              <rect
                key={seg.field}
                data-field={seg.field}
                x={x}
                y={0}
                width={segWidth}
                height={height}
                fill={USAGE_COLOR[seg.token]}
                fillOpacity={CONFIDENCE_OPACITY[metric.confidence]}
              >
                <title>{`${seg.label}: ${metric.value}`}</title>
              </rect>
            );
          })}
        </svg>
      ) : (
        <div
          role="status"
          className="text-xs text-zinc-500 dark:text-zinc-400"
          aria-label="No usage recorded"
        >
          No usage recorded
        </div>
      )}
      <dl className="mt-1 space-y-0.5 text-xs">
        {SEGMENTS.map((seg) => (
          <div key={seg.field} className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 rounded-sm ${USAGE_BG_CLASS[seg.token]}`}
              />
              {seg.label}
            </dt>
            <dd>
              <MetricCell
                field={seg.field}
                harness={harness}
                metric={usage[seg.field]}
                capabilities={capabilities}
                align="right"
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
