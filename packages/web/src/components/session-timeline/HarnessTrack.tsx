import { Group } from '@visx/group';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  clusterByProximity,
  type EventCluster,
  type HarnessEvent,
  type HarnessEventKind,
} from '../../lib/timeline';
import { cn } from '../../lib/utils';
import { KIND_COLOR } from '../charts/chart-theme';
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
 * explicitly so clicking through to a single representative event is
 * discoverable, not a silent pick-one-of-many.
 */
function harnessClusterTooltip(cluster: EventCluster<HarnessEvent>): string {
  const first = cluster.members[0] ?? cluster.representative;
  const last = cluster.members[cluster.members.length - 1] ?? cluster.representative;
  return [
    `${cluster.members.length} ${ROW_LABEL[cluster.representative.kind]} events`,
    `First: ${formatElapsed(first.at)}`,
    `Last: ${formatElapsed(last.at)}`,
    'Click to inspect the first event',
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
 * path. A merged marker's `data-harness-id` is its first (earliest)
 * member's real event id (never a synthetic cluster id), so the existing
 * click-to-select path below resolves it through `EventInspector`'s
 * `findSelected` with zero new plumbing.
 *
 * Hover reports the pointer's real position to the shared cursor via
 * `useTimeline().setCursorTime`, using the same `pointerToElapsedMs`
 * real-pixel-to-domain mapping `TokenTrack`/`AgentTrack` (f4) already use —
 * one consistent hover contract across every track, not a per-mark
 * approximation.
 *
 * Layout: one `<svg>` per row (`AgentTrack`'s per-lane pattern), each with
 * its own real HTML label in the shared `LABEL_GUTTER_WIDTH` gutter — not a
 * single svg spanning all three rows with Read/Write/Exec drawn as `<text>`
 * inside the data area (the original layout), which put label text in the
 * same coordinate space as event marks and let any mark near `t=0` render
 * on top of it.
 */
export function HarnessTrack({ events }: HarnessTrackProps) {
  const { xScale, width, setCursorTime, selectEvent } = useTimeline();

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorTime(pointerToElapsedMs(event.clientX, rect, width, xScale));
  };
  const handleLeave = () => setCursorTime(null);
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
  const selectFromTarget = (target: EventTarget | null) => {
    const el = (target as SVGElement | null)?.closest?.('[data-harness-id]');
    const id = el?.getAttribute('data-harness-id');
    if (id) selectEvent(id);
  };
  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => selectFromTarget(event.target);
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectFromTarget(event.target);
  };

  const durationEvents = events.filter((event) => event.durationMs !== undefined);
  const instantEvents = events.filter((event) => event.durationMs === undefined);
  const clusters = clusterByProximity(instantEvents, xScale, CLUSTER_THRESHOLD_PX);
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
            className={cn(
              'shrink-0 text-xs text-zinc-500 dark:text-zinc-400',
              LABEL_GUTTER_WIDTH,
            )}
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
                    <rect
                      key={event.id}
                      data-harness-id={event.id}
                      data-harness-kind={event.kind}
                      data-harness-shape="bar"
                      tabIndex={0}
                      x={x1}
                      y={y}
                      width={markWidth}
                      height={MARK_HEIGHT}
                      fill={KIND_COLOR[event.kind]}
                    >
                      <title>{harnessTooltip(event)}</title>
                    </rect>
                  );
                })}
              {clusters
                .filter((cluster) => cluster.representative.kind === kind)
                .map((cluster) => {
                  if (cluster.members.length === 1) {
                    const event = cluster.representative;
                    const cx = xScale(event.at);
                    return (
                      <circle
                        key={event.id}
                        data-harness-id={event.id}
                        data-harness-kind={event.kind}
                        data-harness-shape="dot"
                        tabIndex={0}
                        cx={cx}
                        cy={cy}
                        r={DOT_RADIUS}
                        fill={KIND_COLOR[event.kind]}
                      >
                        <title>{harnessTooltip(event)}</title>
                      </circle>
                    );
                  }

                  const cx = xScale(cluster.representative.at);
                  const count = cluster.members.length;
                  return (
                    <g
                      key={cluster.representative.id}
                      data-harness-id={cluster.representative.id}
                      data-harness-kind={cluster.representative.kind}
                      data-harness-shape="cluster"
                      data-harness-cluster-count={count}
                      tabIndex={0}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={CLUSTER_RADIUS}
                        fill={KIND_COLOR[cluster.representative.kind]}
                      />
                      <text
                        x={cx + CLUSTER_RADIUS + 2}
                        y={cy + 3}
                        fontSize={7}
                        className="fill-zinc-700 font-semibold dark:fill-zinc-200"
                      >
                        {count}
                      </text>
                      <title>{harnessClusterTooltip(cluster)}</title>
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
