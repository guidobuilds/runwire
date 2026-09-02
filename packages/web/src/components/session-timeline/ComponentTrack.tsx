import { Group } from '@visx/group';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import {
  type ComponentEvent,
  type ComponentEventKind,
  clusterByProximity,
  type EventCluster,
} from '../../lib/timeline';
import { KIND_COLOR, type KindKey } from '../charts/chart-theme';
import { LABEL_GUTTER_WIDTH, useTimeline } from './TimelineContext';
import { pointerToElapsedMs } from './useContainerWidth';

const GLYPH_SIZE = 5;
const TRACK_HEIGHT = 24;
/**
 * Proximity threshold in real rendered px (f10-t2). Confirmed against a real
 * dense fixture (`fixtures/claude-code/medium`) before deciding to apply
 * clustering here too: that session has 43 `agent`-category tool calls (the
 * triangle glyph) sharing this track's single row, well within the range
 * that visually fuses at full-session zoom — the same density problem
 * `HarnessTrack` has, not a hypothetical one. Same value as `HarnessTrack`'s
 * `CLUSTER_THRESHOLD_PX` (not extracted to a shared constant — the two
 * tracks' glyph sizes/row heights differ enough that keeping the threshold
 * local to each track, tuned for its own geometry, is clearer than a shared
 * "one true value" that happens to coincide today).
 */
const CLUSTER_THRESHOLD_PX = 10;

/**
 * design.md §1.6: `read`/`write`/`exec`/`agent`/`mcp` already have real
 * `--kind-*` tokens; `hook` deliberately reuses the existing
 * `--kind-harness-event` token (already used by `TraceRibbon` for
 * `TraceStepHarness` steps) rather than a new one.
 */
const COMPONENT_COLOR_KEY: Record<ComponentEventKind, KindKey> = {
  skill: 'skill',
  mcp: 'mcp',
  agent: 'agent',
  hook: 'harness-event',
};

const COMPONENT_LABEL: Record<ComponentEventKind, string> = {
  skill: 'Skill',
  mcp: 'MCP',
  agent: 'Agent',
  hook: 'Hook',
};

/** Exposed as `data-component-shape` so a test (or a future legend) can name the geometry without re-deriving it from the kind. */
const SHAPE_NAME: Record<ComponentEventKind, string> = {
  skill: 'circle',
  mcp: 'diamond',
  agent: 'triangle',
  hook: 'square',
};

type ShapeProps = { cx: number; cy: number; color: string };

/**
 * design.md §1.6: shape is the PRIMARY differentiator, color secondary —
 * each of the 4 kinds renders as a genuinely distinct SVG primitive geometry
 * (circle; a 45°-rotated `<rect>` for the diamond; a 3-point `<polygon>` for
 * the triangle; a plain `<rect>` for the square), so the track stays
 * visually distinguishable even with color removed entirely. Hand-rolled,
 * following `TraceRibbon`'s existing preference for hand-rolled SVG shapes
 * over pulling in a new visx sub-package (design.md §1.6/§1.7) — there is no
 * existing shape-glyph precedent anywhere in this repo (grepped, zero hits);
 * this map is built fresh, not adapted from something else.
 */
const COMPONENT_SHAPE: Record<ComponentEventKind, (props: ShapeProps) => ReactNode> = {
  skill: ({ cx, cy, color }) => <circle cx={cx} cy={cy} r={GLYPH_SIZE} fill={color} />,
  mcp: ({ cx, cy, color }) => (
    <rect
      x={cx - GLYPH_SIZE}
      y={cy - GLYPH_SIZE}
      width={GLYPH_SIZE * 2}
      height={GLYPH_SIZE * 2}
      fill={color}
      transform={`rotate(45 ${cx} ${cy})`}
    />
  ),
  agent: ({ cx, cy, color }) => (
    <polygon
      points={`${cx},${cy - GLYPH_SIZE} ${cx + GLYPH_SIZE},${cy + GLYPH_SIZE} ${cx - GLYPH_SIZE},${cy + GLYPH_SIZE}`}
      fill={color}
    />
  ),
  hook: ({ cx, cy, color }) => (
    <rect
      x={cx - GLYPH_SIZE}
      y={cy - GLYPH_SIZE}
      width={GLYPH_SIZE * 2}
      height={GLYPH_SIZE * 2}
      fill={color}
    />
  ),
};

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `elapsed ms -> "m:ss"`. Local copy matching `HarnessTrack.tsx`'s own duplicate (no shared elapsed-time formatter exists yet — see that file's doc comment). Only needed here for the cluster tooltip's First/Last range (f10-t2); the single-mark tooltip never needed a start time. */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * `ComponentEvent` (`lib/timeline.ts`) carries no token-usage field — only
 * `call`-kind trace steps carry `usage`, never the `tool`/`harness` steps
 * this track's whole input is drawn from. "tokens where available"
 * (design.md's tooltip contract) is therefore always "not available" at
 * this event shape: the tooltip omits a tokens line entirely rather than
 * rendering a fake zero. This is a documented layer boundary, not a dropped
 * field — a future pass that wants real per-component token attribution
 * would need to change `buildComponentEvents`, not this component.
 */
function componentTooltip(event: ComponentEvent): string {
  const lines = [
    `Agent: ${event.agentId}`,
    `Operation: ${COMPONENT_LABEL[event.kind]} — ${event.name}`,
  ];
  if (event.detail) lines.push(`Detail: ${event.detail}`);
  if (event.durationMs !== undefined) lines.push(`Duration: ${formatDurationMs(event.durationMs)}`);
  return lines.join('\n');
}

/** Tooltip/aria contract for a merged marker (f10-t3): names the count so the representative-event click behavior is discoverable, not a silent pick-one-of-many. */
function componentClusterTooltip(cluster: EventCluster<ComponentEvent>): string {
  const first = cluster.members[0] ?? cluster.representative;
  const last = cluster.members[cluster.members.length - 1] ?? cluster.representative;
  return [
    `${cluster.members.length} ${COMPONENT_LABEL[cluster.representative.kind]} events`,
    `First: ${formatElapsed(first.at)}`,
    `Last: ${formatElapsed(last.at)}`,
    'Click to inspect the first event',
  ].join('\n');
}

export type ComponentTrackProps = {
  events: readonly ComponentEvent[];
};

/**
 * Component track (design.md §1.6/§2, f10): `skill`/`mcp`/`agent`/`hook` as
 * shape-primary, color-secondary glyphs on a single row against the shared
 * elapsed-time domain. Agent-kind marks carry `childId` through as a
 * `data-child-id` attribute (present only when the underlying event actually
 * has one) for later click-through — not built in this task, per the D35
 * pattern this repo already uses elsewhere; the field is never silently
 * dropped even though nothing consumes it yet.
 *
 * Proximity clustering (f10-t2): confirmed against a real dense fixture
 * (`fixtures/claude-code/medium`: 43 `agent`-category tool calls sharing
 * this track's single row) that the same density problem `HarnessTrack` has
 * applies here too — every event on this track is already a point glyph
 * (unlike `HarnessTrack`, this track never renders a duration bar, so ALL
 * events are cluster-eligible, not just an instant subset). Adjacent
 * same-kind glyphs within `CLUSTER_THRESHOLD_PX` merge into one marker
 * (the same kind-specific shape, slightly enlarged) plus a numeric count
 * badge (`clusterByProximity`, `lib/timeline.ts`); a cluster of exactly one
 * member renders identically to the pre-clustering single-mark path. A
 * merged marker's `data-component-id` is its first (earliest) member's real
 * event id (never a synthetic cluster id), so the existing click-to-select
 * path below resolves it through `EventInspector`'s `findSelected` with
 * zero new plumbing.
 *
 * Hover reports the pointer's real position to the shared cursor via
 * `useTimeline().setCursorTime`, using the same `pointerToElapsedMs`
 * real-pixel-to-domain mapping `TokenTrack`/`AgentTrack` (f4) already use —
 * one consistent hover contract across every track, not a per-mark
 * approximation.
 */
export function ComponentTrack({ events }: ComponentTrackProps) {
  const { xScale, width, setCursorTime, selectEvent } = useTimeline();
  const cy = TRACK_HEIGHT / 2;

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorTime(pointerToElapsedMs(event.clientX, rect, width, xScale));
  };
  const handleLeave = () => setCursorTime(null);
  // Click-to-select (f6): hit-tests via `data-component-id` on the same
  // `<svg role="img">` element the shared hover contract already uses (see
  // `session-timeline-track-hover-contract`), rather than an onClick on the
  // bare glyph itself. Marks (including a merged cluster's wrapping `<g>`)
  // carry `tabIndex={0}` so they are real keyboard focus targets; Enter/Space
  // bubbles to this same handler with `event.target` already inside the
  // mark (`useKeyWithClickEvents`). A cluster click goes through this exact
  // same path as a normal mark, so it cannot conflict with f9's
  // drag-vs-click suppression.
  const selectFromTarget = (target: EventTarget | null) => {
    const el = (target as SVGElement | null)?.closest?.('[data-component-id]');
    const id = el?.getAttribute('data-component-id');
    if (id) selectEvent(id);
  };
  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => selectFromTarget(event.target);
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectFromTarget(event.target);
  };

  const clusters = clusterByProximity(events, xScale, CLUSTER_THRESHOLD_PX);

  return (
    <div data-slot="component-track" className="flex items-center gap-2">
      {/* Empty label-gutter placeholder cell (f8): same fixed width every
          other track/axis row reserves, so this track's <svg> starts at the
          identical real-pixel x-origin as AgentTrack's (visible) label
          column. */}
      <span aria-hidden="true" className={`${LABEL_GUTTER_WIDTH} shrink-0`} />
      <svg
        role="img"
        aria-label="Component events"
        width="100%"
        viewBox={`0 0 ${width} ${TRACK_HEIGHT}`}
        height={TRACK_HEIGHT}
        preserveAspectRatio="none"
        className="min-w-0 flex-1"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <Group>
          {clusters.map((cluster) => {
            if (cluster.members.length === 1) {
              const event = cluster.representative;
              const cx = xScale(event.at);
              const shape = COMPONENT_SHAPE[event.kind];
              const color = KIND_COLOR[COMPONENT_COLOR_KEY[event.kind]];
              const childId = event.kind === 'agent' && event.childId ? event.childId : undefined;
              return (
                <g
                  key={event.id}
                  data-component-id={event.id}
                  data-component-kind={event.kind}
                  data-component-shape={SHAPE_NAME[event.kind]}
                  data-child-id={childId}
                  tabIndex={0}
                >
                  {shape({ cx, cy, color })}
                  <title>{componentTooltip(event)}</title>
                </g>
              );
            }

            const event = cluster.representative;
            const cx = xScale(event.at);
            const shape = COMPONENT_SHAPE[event.kind];
            const color = KIND_COLOR[COMPONENT_COLOR_KEY[event.kind]];
            const childId = event.kind === 'agent' && event.childId ? event.childId : undefined;
            const count = cluster.members.length;
            return (
              <g
                key={event.id}
                data-component-id={event.id}
                data-component-kind={event.kind}
                data-component-shape={SHAPE_NAME[event.kind]}
                data-component-cluster-count={count}
                data-child-id={childId}
                tabIndex={0}
              >
                {shape({ cx, cy: cy - 1, color })}
                <text
                  x={cx + GLYPH_SIZE + 3}
                  y={cy + 3}
                  fontSize={7}
                  className="fill-zinc-700 font-semibold dark:fill-zinc-200"
                >
                  {count}
                </text>
                <title>{componentClusterTooltip(cluster)}</title>
              </g>
            );
          })}
        </Group>
      </svg>
    </div>
  );
}
