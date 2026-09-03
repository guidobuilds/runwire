import { Group } from '@visx/group';
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useRef } from 'react';
import {
  clusterByProximity,
  type EventCluster,
  type HarnessEvent,
  type HarnessEventKind,
} from '../../lib/timeline';
import { cn } from '../../lib/utils';
import { HOVER_DIM_OPACITY, KIND_COLOR } from '../charts/chart-theme';
import { LABEL_GUTTER_WIDTH, useTimeline } from './TimelineContext';
import { pointerToElapsedMs } from './useContainerWidth';

/**
 * Three fixed rows (design.md §2 MVP boundary): exactly `read`/`write`/`exec`
 * — `buildHarnessEvents` (`lib/timeline.ts`) already filters every other
 * `ToolCategory` out before this component ever sees an event, so no runtime
 * filtering happens here.
 */
const ROW_ORDER: readonly HarnessEventKind[] = ['read', 'write', 'exec'];

const ROW_LABEL: Record<HarnessEventKind, string> = {
  read: 'Read',
  write: 'Write',
  exec: 'Exec',
};

const ROW_HEIGHT = 20;
const MARK_HEIGHT = ROW_HEIGHT - 6;
/** Instant-mark dot radius (f10-t1), matching ComponentTrack's `GLYPH_SIZE` shape-glyph convention so both tracks read as one visual language. */
const DOT_RADIUS = 5;
/** Slightly larger than a single dot so a merged marker reads as "more than one" even before its count badge is noticed. */
const CLUSTER_RADIUS = DOT_RADIUS + 2;
/**
 * Proximity threshold in real rendered px (f10-t2, a build-time judgment call
 * design.md left open): adjacent same-kind instant marks whose `xScale`-
 * projected positions fall within this many px of their nearest same-kind
 * neighbor merge into one cluster. Chosen slightly larger than one dot's
 * diameter (`DOT_RADIUS * 2`) so genuinely touching/overlapping dots merge,
 * without being so large that marks a user could still visually tell apart
 * get swallowed into one badge. Recomputed from the real per-render `xScale`
 * every render (see `clusterByProximity`'s own doc comment) — this constant
 * itself is a fixed px value, not domain-dependent; the "relieves itself on
 * zoom" behavior comes entirely from real marks spreading apart in pixel
 * space as `domain` narrows (f9), not from this threshold changing.
 */
const CLUSTER_THRESHOLD_PX = 10;

/**
 * `elapsed ms -> "m:ss"`. Local to this track — no shared elapsed-time
 * formatter exists yet in `lib/format.ts` (that file's `formatDuration`
 * produces a different, coarser "18 min" style for a different use case:
 * session-level totals, not a tooltip's precise start/end).
 */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Type/start-end/duration/target(name)/agent, per design.md's HarnessTrack tooltip contract. */
function harnessTooltip(event: HarnessEvent): string {
  const lines = [ROW_LABEL[event.kind], `Start: ${formatElapsed(event.at)}`];
  if (event.durationMs !== undefined) {
    lines.push(`End: ${formatElapsed(event.at + event.durationMs)}`);
    lines.push(`Duration: ${formatDurationMs(event.durationMs)}`);
  } else {
    lines.push('Duration: instant');
  }
  lines.push(`Target: ${event.name}`);
  lines.push(`Agent: ${event.agentId}`);
  if (event.error) lines.push('Error: yes');
  return lines.join('\n');
}

/**
 * Tooltip/aria contract for a merged marker (f10-t3): names the count
 * explicitly so clicking through to the full member list is discoverable,
 * not a silent pick-one-of-many.
 */
function harnessClusterTooltip(cluster: EventCluster<HarnessEvent>): string {
  const first = cluster.members[0] ?? cluster.representative;
  const last = cluster.members[cluster.members.length - 1] ?? cluster.representative;
  return [
    `${cluster.members.length} ${ROW_LABEL[cluster.representative.kind]} events`,
    `First: ${formatElapsed(first.at)}`,
    `Last: ${formatElapsed(last.at)}`,
    'Click to see all events',
  ].join('\n');
}

export type HarnessTrackProps = {
  events: readonly HarnessEvent[];
};

/**
 * Harness track (design.md §1.6/§2, f10): three rows, read/write/exec. A
 * `HarnessEvent` with no `durationMs` renders as a small dot at `at`
 * (`data-harness-shape="dot"`, f10-t1 — previously a thin tick rect); one
 * with `durationMs` renders unchanged as a rect spanning
 * `at..at+durationMs` (`data-harness-shape="bar"`). Colors are
 * `KIND_COLOR.read/write/exec` `var()` references, never a literal hex (same
 * contract `TraceRibbon.test.tsx` already pins).
 *
 * Proximity clustering (f10-t2): only instant (dot) marks cluster — a
 * duration bar's own width already conveys extent, and real dense fixtures
 * (`fixtures/claude-code/medium`: 153 Bash/exec tool calls in one session)
 * showed instant marks, not bars, fusing into solid blocks. Adjacent
 * same-kind dots within `CLUSTER_THRESHOLD_PX` merge into one marker with a
 * numeric count badge (`clusterByProximity`, `lib/timeline.ts`); a cluster of
 * exactly one member renders identically to the pre-clustering single-dot
 * path. A merged marker's `data-harness-id` is its first (earliest) member's
 * real event id (never a synthetic cluster id) and also carries
 * `data-harness-ids`, every member's id comma-joined in the same earliest-
 * first order; clicking it opens the full member list via
 * `TimelineContext.selectCluster` (bug fix, was: jump straight to the
 * representative, silently dropping the rest of what the count badge
 * counted) rather than `selectEvent`.
 *
 * Hover reports the pointer's real position to the shared cursor via
 * `useTimeline().setCursorTime`, using the same `pointerToElapsedMs`
 * real-pixel-to-domain mapping `TokenTrack`/`AgentTrack` (f4) already use —
 * one consistent hover contract across every track, not a per-mark
 * approximation.
 *
 * Mark tooltips (timeline-chart-usability design.md §3, f1-t4): no native
 * SVG `<title>` any more -- each row's own `onMouseMove` hit-tests
 * `event.target` via the same `[data-harness-id]` `closest()` lookup
 * `selectFromTarget` already uses, then populates the shared
 * `TimelineContext.hoveredMark` (rendered by the one shared `MarkTooltip`
 * overlay) with `harnessTooltip`/`harnessClusterTooltip`'s exact text. A
 * `useRef` tracks the last hit mark's id so repeated mousemove ticks over the
 * *same* mark skip the hit-test/lookup/`setHoveredMark` call entirely --
 * `setHoveredMark` always takes a fresh object literal, so calling it on
 * every tick (as `setCursorTime` still does) would break context-value
 * referential stability and force every consumer to re-render on every
 * pointer-move tick, not just on real hover transitions. Each mark also
 * carries `onFocus`/`onBlur` so keyboard users get the identical tooltip
 * content without a hit-test (the event/cluster is already known at render
 * time). Marks dim to `HOVER_DIM_OPACITY` when `hoveredAgentId` names some
 * other agent (design.md §1 Decision B) -- a cluster's own agent is its
 * representative member's `agentId` (clusters don't expose a distinct
 * per-cluster agent field, matching how `harnessClusterTooltip` already
 * reads `cluster.representative.kind`); dimming lands on the cluster's own
 * `<circle>`, never its wrapping `<g>`, so the count `<text>` stays legible.
 *
 * Layout: one `<svg>` per row (`AgentTrack`'s per-lane pattern), each with
 * its own real HTML label in the shared `LABEL_GUTTER_WIDTH` gutter — not a
 * single svg spanning all three rows with Read/Write/Exec drawn as `<text>`
 * inside the data area (the original layout), which put label text in the
 * same coordinate space as event marks and let any mark near `t=0` render
 * on top of it.
 */
export function HarnessTrack({ events }: HarnessTrackProps) {
  const {
    xScale,
    width,
    setCursorTime,
    selectEvent,
    selectCluster,
    hoveredAgentId,
    setHoveredMark,
  } = useTimeline();

  const durationEvents = events.filter((event) => event.durationMs !== undefined);
  const instantEvents = events.filter((event) => event.durationMs === undefined);
  const clusters = clusterByProximity(instantEvents, xScale, CLUSTER_THRESHOLD_PX);

  // Last hit-tested `data-harness-id` (or `null` when no mark is under the
  // pointer), tracked outside React state so `handleMove` can skip the
  // hit-test/lookup/`setHoveredMark` call entirely when it's unchanged across
  // consecutive mousemove ticks over the same mark (see the module doc
  // comment). Shared across all three rows -- one `HarnessTrack` instance,
  // one ref.
  const hoveredMarkIdRef = useRef<string | null>(null);

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorTime(pointerToElapsedMs(event.clientX, rect, width, xScale));

    const el = (event.target as SVGElement | null)?.closest?.('[data-harness-id]');
    const id = el?.getAttribute('data-harness-id') ?? null;
    if (id === hoveredMarkIdRef.current) return;
    hoveredMarkIdRef.current = id;
    if (id === null) {
      setHoveredMark(null);
      return;
    }
    if (el?.getAttribute('data-harness-ids')) {
      const cluster = clusters.find((c) => c.representative.id === id);
      if (!cluster) return;
      setHoveredMark({
        content: harnessClusterTooltip(cluster),
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }
    const found = events.find((e) => e.id === id);
    if (!found) return;
    setHoveredMark({
      content: harnessTooltip(found),
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };
  const handleLeave = () => {
    setCursorTime(null);
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  const handleMarkFocus = (harnessEvent: HarnessEvent) => (event: ReactFocusEvent<SVGElement>) => {
    hoveredMarkIdRef.current = harnessEvent.id;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredMark({
      content: harnessTooltip(harnessEvent),
      clientX: rect.left,
      clientY: rect.top,
    });
  };
  const handleClusterFocus =
    (cluster: EventCluster<HarnessEvent>) => (event: ReactFocusEvent<SVGElement>) => {
      hoveredMarkIdRef.current = cluster.representative.id;
      const rect = event.currentTarget.getBoundingClientRect();
      setHoveredMark({
        content: harnessClusterTooltip(cluster),
        clientX: rect.left,
        clientY: rect.top,
      });
    };
  const handleMarkBlur = () => {
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  // Click-to-select (f6): hit-tests via `data-harness-id` on the same
  // `<svg role="img">` element the shared hover contract already uses (see
  // `session-timeline-track-hover-contract`), rather than an onClick on the
  // bare mark itself. Marks (including a merged cluster's wrapping `<g>`)
  // carry `tabIndex={0}` so they are real keyboard focus targets; Enter/Space
  // bubbles to this same handler with `event.target` already inside the
  // mark (`useKeyWithClickEvents`). A cluster click goes through this exact
  // same path as a normal mark — no separate handler, so it cannot conflict
  // with f9's drag-vs-click suppression, which only ever suppresses the one
  // trailing native `click` after a real drag, regardless of what element
  // that click happens to land on.
  //
  // A cluster marker carries `data-harness-ids` (every member, comma-joined)
  // in addition to `data-harness-id` (the representative, still used by
  // hover/tooltip and by anything that only knows the representative's id).
  // Clicking it opens the full member list via `selectCluster` instead of
  // jumping straight to the representative -- f10-t3's original "click to
  // inspect the first event" silently dropped every other member the badge
  // counted; the list lets the user pick which one.
  const selectFromTarget = (target: EventTarget | null) => {
    const el = (target as SVGElement | null)?.closest?.('[data-harness-id]');
    if (!el) return;
    const clusterIds = el.getAttribute('data-harness-ids');
    if (clusterIds) {
      selectCluster(clusterIds.split(','));
      return;
    }
    const id = el.getAttribute('data-harness-id');
    if (id) selectEvent(id);
  };
  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => selectFromTarget(event.target);
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectFromTarget(event.target);
  };

  const cy = ROW_HEIGHT / 2;

  return (
    <div data-slot="harness-track" className="space-y-1">
      {ROW_ORDER.map((kind) => (
        // One row = one <label span> + <svg> pair (same pattern AgentTrack's
        // per-lane rows use), instead of the old single shared <svg> with
        // Read/Write/Exec drawn as <text> inside the data area at x=PAD: that
        // put label text in the same coordinate space as event marks, so any
        // mark near t=0 rendered on top of it. Splitting one row per kind
        // moves the label into the real HTML gutter column (LABEL_GUTTER_WIDTH)
        // that every track already reserves, outside the SVG entirely -- it
        // can never be drawn over by a mark again.
        <div key={kind} className="flex items-center gap-2">
          <span
            className={cn('shrink-0 text-xs text-zinc-500 dark:text-zinc-400', LABEL_GUTTER_WIDTH)}
          >
            {ROW_LABEL[kind]}
          </span>
          <svg
            role="img"
            aria-label={`${ROW_LABEL[kind]} events`}
            width="100%"
            viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
            height={ROW_HEIGHT}
            preserveAspectRatio="none"
            className="min-w-0 flex-1"
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
          >
            <Group>
              {durationEvents
                .filter((event) => event.kind === kind)
                .map((event) => {
                  const y = (ROW_HEIGHT - MARK_HEIGHT) / 2;
                  const x1 = xScale(event.at);
                  const x2 = xScale(event.at + (event.durationMs ?? 0));
                  const markWidth = Math.max(x2 - x1, 2);
                  return (
                    // This rect is a genuine keyboard-focus target (tabIndex +
                    // aria-label), not a decorative static element --
                    // `role="button"` (the only role Biome would accept here)
                    // trips `useSemanticElements` right back, wanting a
                    // literal `<button>`, which an SVG mark inside an
                    // already-open `<svg>` tree cannot be (design.md §0). The
                    // ancestor `<svg role="img">`'s own `onKeyDown`
                    // (Enter/Space -> `selectFromTarget`) already gives this
                    // mark its click keyboard equivalent per the
                    // `session-timeline-track-hover-contract` lesson;
                    // `onFocus`/`onBlur` here are additive (hover-tooltip
                    // parity only), not this mark's only interactivity.
                    // biome-ignore lint/a11y/noStaticElementInteractions: see comment above
                    <rect
                      key={event.id}
                      data-harness-id={event.id}
                      data-harness-kind={event.kind}
                      data-harness-shape="bar"
                      aria-label={harnessTooltip(event)}
                      tabIndex={0}
                      x={x1}
                      y={y}
                      width={markWidth}
                      height={MARK_HEIGHT}
                      fill={KIND_COLOR[event.kind]}
                      fillOpacity={
                        hoveredAgentId !== null && event.agentId !== hoveredAgentId
                          ? HOVER_DIM_OPACITY
                          : undefined
                      }
                      onFocus={handleMarkFocus(event)}
                      onBlur={handleMarkBlur}
                    />
                  );
                })}
              {clusters
                .filter((cluster) => cluster.representative.kind === kind)
                .map((cluster) => {
                  if (cluster.members.length === 1) {
                    const event = cluster.representative;
                    const cx = xScale(event.at);
                    return (
                      // See the duration-bar <rect> above for why this
                      // static-element-interactions ignore is correct here.
                      // biome-ignore lint/a11y/noStaticElementInteractions: see comment on the duration-bar <rect> above
                      <circle
                        key={event.id}
                        data-harness-id={event.id}
                        data-harness-kind={event.kind}
                        data-harness-shape="dot"
                        aria-label={harnessTooltip(event)}
                        tabIndex={0}
                        cx={cx}
                        cy={cy}
                        r={DOT_RADIUS}
                        fill={KIND_COLOR[event.kind]}
                        fillOpacity={
                          hoveredAgentId !== null && event.agentId !== hoveredAgentId
                            ? HOVER_DIM_OPACITY
                            : undefined
                        }
                        onFocus={handleMarkFocus(event)}
                        onBlur={handleMarkBlur}
                      />
                    );
                  }

                  const cx = xScale(cluster.representative.at);
                  const count = cluster.members.length;
                  const clusterAgentId = cluster.representative.agentId;
                  return (
                    // See the duration-bar <rect> above for why this
                    // static-element-interactions ignore is correct here.
                    // biome-ignore lint/a11y/noStaticElementInteractions: see comment on the duration-bar <rect> above
                    <g
                      key={cluster.representative.id}
                      data-harness-id={cluster.representative.id}
                      data-harness-ids={cluster.members.map((m) => m.id).join(',')}
                      data-harness-kind={cluster.representative.kind}
                      data-harness-shape="cluster"
                      data-harness-cluster-count={count}
                      aria-label={harnessClusterTooltip(cluster)}
                      tabIndex={0}
                      onFocus={handleClusterFocus(cluster)}
                      onBlur={handleMarkBlur}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={CLUSTER_RADIUS}
                        fill={KIND_COLOR[cluster.representative.kind]}
                        fillOpacity={
                          hoveredAgentId !== null && clusterAgentId !== hoveredAgentId
                            ? HOVER_DIM_OPACITY
                            : undefined
                        }
                      />
                      <text
                        x={cx + CLUSTER_RADIUS + 2}
                        y={cy + 3}
                        fontSize={7}
                        className="fill-zinc-700 font-semibold dark:fill-zinc-200"
                      >
                        {count}
                      </text>
                    </g>
                  );
                })}
            </Group>
          </svg>
        </div>
      ))}
    </div>
  );
}
