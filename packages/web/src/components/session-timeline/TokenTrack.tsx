import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useRef } from 'react';
import { formatTokens } from '../../lib/format';
import type { TokenPoint } from '../../lib/timeline';
import { HOVER_DIM_OPACITY, KIND_COLOR } from '../charts/chart-theme';
import { LABEL_GUTTER_WIDTH, useTimeline } from './TimelineContext';
import { pointerToElapsedMs } from './useContainerWidth';

/**
 * Token track (design.md §3.1/f4-t1): a merged, cumulative token-usage area +
 * line over `buildTokenSeries`' output, one circle marker per `TokenPoint`,
 * colored via `KIND_COLOR.model` (the same token `TraceRibbon`'s own
 * cumulative line already uses for model-call marks). Reads `xScale`/`width`
 * from the shared `TimelineContext` (design.md §3.2) rather than owning its
 * own x-domain, so it stays pixel-aligned with the other three tracks.
 */

const HEIGHT = 64;
const PAD_TOP = 6;
const PAD_BOTTOM = 4;

export type TokenTrackProps = {
  points: readonly TokenPoint[];
};

/** "mm:ss" from an elapsed-ms value. Local helper — no mm:ss formatter exists yet in `lib/format.ts` (that lands with `TimelineAxis`, a later task). */
function formatElapsed(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${sign}${min}:${String(sec).padStart(2, '0')}`;
}

/** Tooltip contract per design.md §f4 archiveWhen: timestamp/cumulative/delta/input/output/agent/model. */
function tooltipText(point: TokenPoint): string {
  return [
    `Timestamp: ${formatElapsed(point.at)}`,
    `Cumulative: ${formatTokens(point.cumulative)}`,
    `Delta: ${formatTokens(point.delta)}`,
    `Input: ${formatTokens(point.input)}`,
    `Output: ${formatTokens(point.output)}`,
    `Agent: ${point.agentId}`,
    `Model: ${point.model}`,
  ].join('\n');
}

export function TokenTrack({ points }: TokenTrackProps) {
  const { xScale, width, setCursorTime, selectEvent, hoveredAgentId, setHoveredMark } =
    useTimeline();
  // Last hit-tested `data-token-point` id (or `null` when no mark is under
  // the pointer), tracked outside React state so `handleMove` can skip the
  // hit-test/`setHoveredMark` call entirely when it's unchanged across
  // consecutive mousemove ticks over the same mark -- `setHoveredMark` always
  // takes a fresh `HoveredMark` object literal, so calling it unconditionally
  // would change context-value identity (and re-render every consumer,
  // including `MarkTooltip`) on every single pointer-move tick, not just on
  // real hover transitions (timeline-chart-usability design.md §3 perf note).
  const hoveredMarkIdRef = useRef<string | null>(null);

  if (points.length === 0) {
    return (
      <div role="img" aria-label="No token usage data">
        <span className="text-xs italic text-zinc-500 dark:text-zinc-400">No token usage data</span>
      </div>
    );
  }

  const maxCumulative = Math.max(...points.map((p) => p.cumulative));
  const yScale = scaleLinear<number>({
    domain: [0, maxCumulative > 0 ? maxCumulative : 1],
    range: [HEIGHT - PAD_BOTTOM, PAD_TOP],
  });

  // @visx/shape's `data` prop wants a mutable array; `points` is `readonly`
  // per this component's own contract (never mutated here).
  const seriesData = [...points];

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorTime(pointerToElapsedMs(event.clientX, rect, width, xScale));

    const el = (event.target as SVGElement | null)?.closest?.('[data-token-point]');
    const id = el?.getAttribute('data-token-point') ?? null;
    if (id === hoveredMarkIdRef.current) return;
    hoveredMarkIdRef.current = id;
    if (id === null) {
      setHoveredMark(null);
      return;
    }
    const point = points.find((p) => p.id === id);
    if (!point) return;
    setHoveredMark({ content: tooltipText(point), clientX: event.clientX, clientY: event.clientY });
  };
  const handleLeave = () => {
    setCursorTime(null);
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  const handleMarkFocus = (point: TokenPoint) => (event: ReactFocusEvent<SVGCircleElement>) => {
    hoveredMarkIdRef.current = point.id;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredMark({ content: tooltipText(point), clientX: rect.left, clientY: rect.top });
  };
  const handleMarkBlur = () => {
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  // Click-to-select (f6): a per-track handler on the same `<svg role="img">`
  // element the shared hover contract already uses, hit-testing via the
  // mark's own `data-token-point` attribute rather than an onClick on the
  // bare `<circle>` itself — matches the `session-timeline-track-hover-
  // contract` lesson (a handler on a non-interactive SVG primitive with no
  // role fails Biome's `noStaticElementInteractions`). Marks carry
  // `tabIndex={0}` so they are real keyboard focus targets; Enter/Space on a
  // focused mark bubbles to this same handler with `event.target` already
  // equal to that mark, so `closest()` matches it directly — a genuine
  // keyboard equivalent (Biome's `useKeyWithClickEvents`), not a decorative
  // handler that never fires.
  const selectFromTarget = (target: EventTarget | null) => {
    const el = (target as SVGElement | null)?.closest?.('[data-token-point]');
    const id = el?.getAttribute('data-token-point');
    if (id) selectEvent(id);
  };
  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => selectFromTarget(event.target);
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectFromTarget(event.target);
  };

  return (
    <div data-slot="token-track" className="flex items-center gap-2">
      {/* Empty label-gutter placeholder cell (f8): same fixed width every
          other track/axis row reserves, so this track's <svg> starts at the
          identical real-pixel x-origin as AgentTrack's (visible) label
          column. */}
      <span aria-hidden="true" className={`${LABEL_GUTTER_WIDTH} shrink-0`} />
      <svg
        role="img"
        aria-label={`Token usage, ${points.length} calls`}
        width="100%"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        height={HEIGHT}
        preserveAspectRatio="none"
        className="min-w-0 flex-1"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <Group>
          <AreaClosed
            data={seriesData}
            x={(p) => xScale(p.at)}
            y={(p) => yScale(p.cumulative)}
            yScale={yScale}
            fill={KIND_COLOR.model}
            fillOpacity={0.15}
            stroke="none"
          />
          <LinePath
            data={seriesData}
            x={(p) => xScale(p.at)}
            y={(p) => yScale(p.cumulative)}
            stroke={KIND_COLOR.model}
            strokeWidth={1.25}
            fill="none"
          />
          {points.map((point) => (
            // This circle is a genuine keyboard-focus target (tabIndex +
            // aria-label), not a decorative static element -- `role="button"`
            // (the only role Biome would accept here) trips
            // `useSemanticElements` right back, wanting a literal `<button>`,
            // which an SVG mark inside an already-open `<svg>` tree cannot be
            // (design.md §0). The ancestor `<svg role="img">`'s own
            // `onKeyDown` (Enter/Space -> `selectFromTarget`) already gives
            // this mark its click keyboard equivalent per the
            // `session-timeline-track-hover-contract` lesson; `onFocus`/
            // `onBlur` here are additive (hover-tooltip parity only), not
            // this mark's only interactivity.
            // biome-ignore lint/a11y/noStaticElementInteractions: see comment above
            <circle
              key={point.id}
              data-token-point={point.id}
              aria-label={tooltipText(point)}
              tabIndex={0}
              cx={xScale(point.at)}
              cy={yScale(point.cumulative)}
              r={1.75}
              fill={KIND_COLOR.model}
              fillOpacity={
                hoveredAgentId !== null && point.agentId !== hoveredAgentId
                  ? HOVER_DIM_OPACITY
                  : undefined
              }
              onFocus={handleMarkFocus(point)}
              onBlur={handleMarkBlur}
            />
          ))}
        </Group>
      </svg>
    </div>
  );
}
