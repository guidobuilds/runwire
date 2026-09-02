import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdapterCapabilities, useAdapterDisplayName } from '../../api/queries';
import { buildAgentTree } from '../../lib/tree';
import { AgentTrack } from './AgentTrack';
import { ComponentTrack } from './ComponentTrack';
import { EventInspector } from './EventInspector';
import { HarnessTrack } from './HarnessTrack';
import { SharedCursor } from './SharedCursor';
import { TimelineAxis } from './TimelineAxis';
import {
  DEFAULT_WIDTH,
  LABEL_GUTTER_PX,
  type TimelineDomain,
  TimelineProvider,
} from './TimelineContext';
import { TimelineSummaryBar } from './TimelineSummaryBar';
import { TokenTrack } from './TokenTrack';
import { useContainerWidth } from './useContainerWidth';
import { type SessionTimelineData, useSessionTimelineData } from './useSessionTimelineData';
import { ZoomBrush } from './ZoomBrush';

/**
 * `SessionTimeline` (design.md §3.1, f7-t2): the top-level composition —
 * `TimelineSummaryBar` + `TimelineProvider` + the 4 tracks + `TimelineAxis` +
 * `SharedCursor` + `EventInspector` — wired through `useSessionTimelineData`.
 * Placement/signature per design.md §1.1/f7-t3: mounted as `<SessionTimeline
 * id={id} />` immediately after `SessionDetail`'s existing Trace section, so
 * it resolves its own capabilities/displayName (2 extra `['status']`
 * observers for the whole subtree, not per-cell — negligible next to the
 * `MetricCell`-prop-hoisting concern that rule exists for) rather than
 * requiring `SessionDetail` to thread them through a wider prop surface.
 */

export type SessionTimelineProps = {
  id: string;
};

/**
 * `[0, maxElapsedMs]` — the shared domain every track/axis/cursor reads from.
 * Spans a span/point covers, never a single hardcoded fallback: `Math.max`
 * over every present elapsed value across all four derived arrays (an event
 * with a duration counts its end, `at + durationMs`, not just its start).
 * `1` (never `0`) when nothing has an elapsed value, so `scaleLinear` never
 * gets a degenerate `[0, 0]` domain.
 */
function computeMaxElapsed(data: SessionTimelineData): number {
  let max = 0;
  for (const span of data.agentSpans) {
    if (span.start !== undefined) max = Math.max(max, span.start);
    if (span.end !== undefined) max = Math.max(max, span.end);
  }
  for (const point of data.tokenSeries) max = Math.max(max, point.at);
  for (const event of data.harnessEvents) {
    max = Math.max(max, event.at + (event.durationMs ?? 0));
  }
  for (const event of data.componentEvents) {
    max = Math.max(max, event.at + (event.durationMs ?? 0));
  }
  return max > 0 ? max : 1;
}

export function SessionTimeline({ id }: SessionTimelineProps) {
  const data = useSessionTimelineData(id);
  const harness = data.summary?.summary.harness ?? '';
  const capabilities = useAdapterCapabilities(harness);
  const displayName = useAdapterDisplayName(harness);

  // Base session data not resolved yet (rare in practice: `SessionDetail`
  // already awaited its own `useSession(id)` before mounting this component,
  // and this hook's own call shares that same query-cache entry) — render
  // nothing rather than a flash of the "no timing data" empty state.
  if (!data.summary) return null;

  return (
    <section className="space-y-2" data-slot="session-timeline">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Timeline</h2>
      {data.isPending ? (
        <span className="text-xs italic text-zinc-500 dark:text-zinc-400">Loading timeline…</span>
      ) : !data.rootAnchor ? (
        <div role="img" aria-label="No timing data available">
          <span className="text-xs italic text-zinc-500 dark:text-zinc-400">
            No timing data available
          </span>
        </div>
      ) : (
        <TimelineBody id={id} data={data} capabilities={capabilities} displayName={displayName} />
      )}
    </section>
  );
}

function TimelineBody({
  id,
  data,
  capabilities,
  displayName,
}: {
  id: string;
  data: SessionTimelineData;
  capabilities: ReturnType<typeof useAdapterCapabilities>;
  displayName: string;
}) {
  // Real measured CSS pixel width of the tracks container (f8), replacing
  // the old hardcoded `DEFAULT_WIDTH` fallback so `xScale`'s range and every
  // track's viewBox/tick-density genuinely reflect the rendered size, not a
  // constant. `measuredWidth` is `0` before the first
  // `getBoundingClientRect`/`ResizeObserver` callback fires (or in any
  // environment without `ResizeObserver` at all — see `useContainerWidth.ts`)
  // — `DEFAULT_WIDTH` is only ever a pre-measurement placeholder, never a
  // silent substitute for a real value that failed to load. The measured
  // width includes the shared label-gutter column reserved by every track
  // row (`LABEL_GUTTER_PX`); subtracting it here is what makes
  // `TimelineContext.width` equal each track's own plot `<svg>`'s real CSS
  // width, not the whole row's width.
  //
  // Called unconditionally, before the guarded early return below (React's
  // rules of hooks) — `TimelineBody` only ever mounts once its caller has
  // already confirmed `data.summary`/`data.rootAnchor` are present, so this
  // never actually runs against absent data, but the hook call itself cannot
  // be conditional on that fact.
  const [containerRef, measuredWidth] = useContainerWidth<HTMLDivElement>();
  const plotWidth =
    measuredWidth > 0 ? Math.max(measuredWidth - LABEL_GUTTER_PX, 1) : DEFAULT_WIDTH;

  // `SharedCursor`'s positioned ancestor also doubles as `ZoomBrush`'s
  // reference rect (f9) -- the exact plot-column rect every track's own
  // hover mapping already resolves against, so drag-selection coordinates
  // stay pixel-consistent with hover/click coordinates at any zoom level.
  const plotRef = useRef<HTMLDivElement>(null);

  // `domain` (f9): real React state, not a derived `[0, maxElapsed]`
  // constant, so `ZoomBrush` can narrow it on a completed drag-select and a
  // reset control can restore it. Seeded from the full-session range and
  // re-seeded (resetting any zoom) whenever the underlying session id or the
  // computed full-session extent changes -- e.g. switching to a different
  // session, or the merged trace data resolving to a wider/narrower extent
  // than the value `domain` was originally seeded from.
  const maxElapsed = computeMaxElapsed(data);
  const [domain, setDomain] = useState<TimelineDomain>(() => [0, maxElapsed]);
  const seedRef = useRef({ id, maxElapsed });
  useEffect(() => {
    if (seedRef.current.id !== id || seedRef.current.maxElapsed !== maxElapsed) {
      seedRef.current = { id, maxElapsed };
      setDomain([0, maxElapsed]);
    }
  }, [id, maxElapsed]);

  const resetDomain = useCallback(() => setDomain([0, maxElapsed]), [maxElapsed]);
  const handleZoom = useCallback((range: TimelineDomain) => setDomain(range), []);
  const isZoomed = domain[0] !== 0 || domain[1] !== maxElapsed;

  // Guarded by the caller: `data.summary`/`data.rootAnchor` are both present
  // whenever this renders.
  const summary = data.summary;
  if (!summary || !data.rootAnchor) return null;

  const tree = buildAgentTree(summary.summary.id, summary.subtree.summaries);
  const mcpCallCount = data.componentEvents.filter((event) => event.kind === 'mcp').length;

  return (
    <div className="space-y-2">
      <TimelineSummaryBar
        summary={summary.summary}
        rollup={summary.rollup}
        agentCount={summary.subtree.summaries.length}
        mcpCallCount={mcpCallCount}
        capabilities={capabilities}
        displayName={displayName}
        isZoomed={isZoomed}
        onResetZoom={resetDomain}
      />
      <TimelineProvider domain={domain} width={plotWidth}>
        {/*
         * The `p-3 rounded-lg border ...` styling lives on this OUTER
         * wrapper (f8), not on the `relative` "timeline-tracks" div below,
         * so `SharedCursor`'s percentage-of-container-width math (and the
         * plot-width measurement above) resolves against a zero-padding
         * content box — a padded ancestor would otherwise add a systematic
         * padding-box offset between the cursor overlay and the real tracks
         * beneath it.
         */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div data-slot="timeline-tracks" className="relative" ref={containerRef}>
            <div className="space-y-2">
              <TokenTrack points={data.tokenSeries} />
              {tree ? <AgentTrack root={tree} spans={data.agentSpans} /> : null}
              <HarnessTrack events={data.harnessEvents} />
              <ComponentTrack events={data.componentEvents} />
              <TimelineAxis />
            </div>
            {/*
             * `SharedCursor`'s positioned ancestor: inset from the left by
             * the exact same `LABEL_GUTTER_PX` every track row reserves for
             * its label cell (`w-40` + `gap-2`), so this wrapper's own
             * content-box width equals every track's plot `<svg>`'s real CSS
             * width -- the same coordinate space `SharedCursor`'s
             * `left: ${percent}%` is computed against. Without this inset,
             * the cursor line would be positioned as a percentage of the
             * FULL row width (label gutter + plot), which is wider than any
             * track's actual plot area, systematically shifting the overlay
             * right of the real hovered position. `ZoomBrush` (f9) shares
             * this exact same ancestor for the same reason -- its drag
             * selection rectangle must live in the identical coordinate
             * space as the cursor line and every track's own marks.
             * `ZoomBrush` also attaches its double-click-to-reset listener
             * (f9-t3's secondary affordance) natively to `containerRef`
             * rather than via a JSX `onDoubleClick` prop on the plain,
             * non-interactive `timeline-tracks` div above -- see
             * `ZoomBrush.tsx`'s own doc comment.
             *
             * The offset is an inline `style={{ left: LABEL_GUTTER_PX }}`
             * (px), not a hand-typed Tailwind arbitrary-value class (f8) --
             * genuinely derived from the same `TimelineContext.LABEL_GUTTER_PX`
             * single source of truth every track/axis row already imports,
             * so a future change to that constant cannot silently desync
             * this wrapper from the rest of the layout.
             */}
            <div
              data-slot="shared-cursor-inset"
              className="pointer-events-none absolute inset-y-0 right-0"
              style={{ left: LABEL_GUTTER_PX }}
              ref={plotRef}
            >
              <SharedCursor />
              <ZoomBrush
                containerRef={containerRef}
                plotRef={plotRef}
                onZoom={handleZoom}
                onResetZoom={resetDomain}
              />
            </div>
          </div>
        </div>
        <EventInspector
          spans={data.agentSpans}
          tokenPoints={data.tokenSeries}
          harnessEvents={data.harnessEvents}
          componentEvents={data.componentEvents}
        />
      </TimelineProvider>
    </div>
  );
}
