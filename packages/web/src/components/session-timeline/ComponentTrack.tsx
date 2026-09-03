import { Group } from '@visx/group';
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { useRef } from 'react';
import {
  type ComponentEvent,
  type ComponentEventKind,
  clusterByProximity,
  type EventCluster,
} from '../../lib/timeline';
import { HOVER_DIM_OPACITY, KIND_COLOR, type KindKey } from '../charts/chart-theme';
import { LABEL_GUTTER_PX, LABEL_GUTTER_WIDTH, useTimeline } from './TimelineContext';
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

/**
 * Legend reading order (bug fix): this track packs all 4 kinds onto one
 * shared row, unlike `HarnessTrack`'s one-row-per-kind layout, so there is
 * no natural per-row label to put in the gutter -- the track used to render
 * that gutter empty and rely on shape/color/tooltip alone, leaving mcp/
 * skill/hook (and agent) with no visible name anywhere. Same order as
 * `COMPONENT_LABEL`'s own key order.
 */
const LEGEND_ORDER: readonly ComponentEventKind[] = ['skill', 'mcp', 'agent', 'hook'];

/**
 * `opacity` (timeline-chart-usability f1-t5): optional so the legend's own
 * swatch call sites (`{ cx, cy, color }`, no opacity arg) keep rendering at
 * full opacity unconditionally — only the track's own data marks ever pass
 * an explicit value, computed from `TimelineContext.hoveredAgentId`
 * (`HOVER_DIM_OPACITY` when a different agent's row is hovered, `undefined`
 * otherwise, same "omit the attribute rather than force opacity 1" contract
 * `TokenTrack`'s parallel marks already use).
 */
type ShapeProps = { cx: number; cy: number; color: string; opacity?: number };

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
  skill: ({ cx, cy, color, opacity }) => (
    <circle cx={cx} cy={cy} r={GLYPH_SIZE} fill={color} opacity={opacity} />
  ),
  mcp: ({ cx, cy, color, opacity }) => (
    <rect
      x={cx - GLYPH_SIZE}
      y={cy - GLYPH_SIZE}
      width={GLYPH_SIZE * 2}
      height={GLYPH_SIZE * 2}
      fill={color}
      opacity={opacity}
      transform={`rotate(45 ${cx} ${cy})`}
    />
  ),
  agent: ({ cx, cy, color, opacity }) => (
    <polygon
      points={`${cx},${cy - GLYPH_SIZE} ${cx + GLYPH_SIZE},${cy + GLYPH_SIZE} ${cx - GLYPH_SIZE},${cy + GLYPH_SIZE}`}
      fill={color}
      opacity={opacity}
    />
  ),
  hook: ({ cx, cy, color, opacity }) => (
    <rect
      x={cx - GLYPH_SIZE}
      y={cy - GLYPH_SIZE}
      width={GLYPH_SIZE * 2}
      height={GLYPH_SIZE * 2}
      fill={color}
      opacity={opacity}
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

/** Tooltip/aria contract for a merged marker (f10-t3): names the count so the full-list click behavior is discoverable, not a silent pick-one-of-many. */
function componentClusterTooltip(cluster: EventCluster<ComponentEvent>): string {
  const first = cluster.members[0] ?? cluster.representative;
  const last = cluster.members[cluster.members.length - 1] ?? cluster.representative;
  return [
    `${cluster.members.length} ${COMPONENT_LABEL[cluster.representative.kind]} events`,
    `First: ${formatElapsed(first.at)}`,
    `Last: ${formatElapsed(last.at)}`,
    'Click to see all events',
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
 * event id (never a synthetic cluster id) and also carries
 * `data-component-ids`, every member's id comma-joined in the same
 * earliest-first order; clicking it opens the full member list via
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
 * Hover-dim + tooltip wiring (timeline-chart-usability design.md §1/§3,
 * f1-t5): every mark (single-member or a merged cluster) renders at
 * `HOVER_DIM_OPACITY` when `hoveredAgentId` names a different agent than the
 * mark's own (`cluster.representative.agentId` for a cluster) -- the count
 * badge `<text>` never dims, staying legible. `hoveredMark` (the shared
 * `MarkTooltip` overlay's content) is populated by hit-testing `event.target`
 * on every `onMouseMove` tick, reusing the same `data-component-id`/
 * `data-component-ids` hit-test `selectFromTarget` already does, and cleared
 * on `onMouseLeave`; each mark also carries `onFocus`/`onBlur` for keyboard
 * parity. There is no longer a native SVG `<title>` anywhere on this track --
 * `componentTooltip`/`componentClusterTooltip` back `hoveredMark.content`
 * instead.
 */
export function ComponentTrack({ events }: ComponentTrackProps) {
  const {
    xScale,
    width,
    setCursorTime,
    selectEvent,
    selectCluster,
    hoveredAgentId,
    setHoveredMark,
  } = useTimeline();
  const cy = TRACK_HEIGHT / 2;

  const clusters = clusterByProximity(events, xScale, CLUSTER_THRESHOLD_PX);

  // Last hit-tested `data-component-id` (or `null` when no mark is under the
  // pointer), tracked outside React state so `handleMove` can skip the
  // hit-test/`setHoveredMark` call entirely when it's unchanged across
  // consecutive mousemove ticks over the same mark -- `setHoveredMark` always
  // takes a fresh `HoveredMark` object literal, so calling it unconditionally
  // would change context-value identity (and re-render every consumer,
  // including `MarkTooltip`) on every single pointer-move tick, not just on
  // real hover transitions (timeline-chart-usability design.md §3 perf note;
  // same technique as `TokenTrack`'s own `hoveredMarkIdRef`).
  const hoveredMarkIdRef = useRef<string | null>(null);

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorTime(pointerToElapsedMs(event.clientX, rect, width, xScale));

    const el = (event.target as SVGElement | null)?.closest?.('[data-component-id]');
    const id = el?.getAttribute('data-component-id') ?? null;
    if (id === hoveredMarkIdRef.current) return;
    hoveredMarkIdRef.current = id;
    if (id === null) {
      setHoveredMark(null);
      return;
    }
    const clusterIds = el?.getAttribute('data-component-ids');
    if (clusterIds) {
      const cluster = clusters.find((c) => c.representative.id === id);
      if (!cluster) return;
      setHoveredMark({
        content: componentClusterTooltip(cluster),
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }
    const hoveredEvent = events.find((e) => e.id === id);
    if (!hoveredEvent) return;
    setHoveredMark({
      content: componentTooltip(hoveredEvent),
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };
  const handleLeave = () => {
    setCursorTime(null);
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  const handleMarkFocus =
    (id: string, content: string) => (event: ReactFocusEvent<SVGGElement>) => {
      hoveredMarkIdRef.current = id;
      const rect = event.currentTarget.getBoundingClientRect();
      setHoveredMark({ content, clientX: rect.left, clientY: rect.top });
    };
  const handleMarkBlur = () => {
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  // Click-to-select (f6): hit-tests via `data-component-id` on the same
  // `<svg role="img">` element the shared hover contract already uses (see
  // `session-timeline-track-hover-contract`), rather than an onClick on the
  // bare glyph itself. Marks (including a merged cluster's wrapping `<g>`)
  // carry `tabIndex={0}` so they are real keyboard focus targets; Enter/Space
  // bubbles to this same handler with `event.target` already inside the
  // mark (`useKeyWithClickEvents`). A cluster click goes through this exact
  // same path as a normal mark, so it cannot conflict with f9's
  // drag-vs-click suppression.
  //
  // A cluster marker carries `data-component-ids` (every member,
  // comma-joined) alongside `data-component-id` (the representative);
  // clicking it opens the full member list via `selectCluster` instead of
  // jumping straight to the representative and silently dropping the rest of
  // what the count badge counted -- same bug fix as `HarnessTrack`.
  const selectFromTarget = (target: EventTarget | null) => {
    const el = (target as SVGElement | null)?.closest?.('[data-component-id]');
    if (!el) return;
    const clusterIds = el.getAttribute('data-component-ids');
    if (clusterIds) {
      selectCluster(clusterIds.split(','));
      return;
    }
    const id = el.getAttribute('data-component-id');
    if (id) selectEvent(id);
  };
  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => selectFromTarget(event.target);
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectFromTarget(event.target);
  };

  // Legend counts (bug fix): only kinds actually present in this session get
  // a legend entry, matching TraceRibbon's own kind-legend convention (an
  // unused kind never appears).
  const counts = new Map<ComponentEventKind, number>();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  const legendEntries = LEGEND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind) ?? 0,
  }));

  return (
    <div data-slot="component-track" className="space-y-1">
      <div className="flex items-center gap-2">
        {/* Empty label-gutter placeholder cell (f8): same fixed width every
            other track/axis row reserves, so this track's <svg> starts at the
            identical real-pixel x-origin as AgentTrack's (visible) label
            column. There is no single per-row label to put here (unlike
            HarnessTrack) -- all 4 kinds share this one row; see the legend
            below instead. */}
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
                const opacity =
                  hoveredAgentId !== null && event.agentId !== hoveredAgentId
                    ? HOVER_DIM_OPACITY
                    : undefined;
                return (
                  // This <g> is a genuine keyboard-focus target (tabIndex),
                  // not a decorative static element -- `role="button"` (the
                  // only role Biome would accept here) trips
                  // `useSemanticElements` right back, wanting a literal
                  // `<button>`, which an SVG mark inside an already-open
                  // `<svg>` tree cannot be (design.md §0, same reasoning
                  // `HarnessTrack`'s parallel marks use). The ancestor
                  // `<svg role="img">`'s own `onKeyDown` (Enter/Space ->
                  // `selectFromTarget`) already gives this mark its click
                  // keyboard equivalent per the
                  // `session-timeline-track-hover-contract` lesson;
                  // `onFocus`/`onBlur` here are additive (hover-tooltip
                  // parity only), not this mark's only interactivity.
                  // biome-ignore lint/a11y/noStaticElementInteractions: see comment above
                  <g
                    key={event.id}
                    data-component-id={event.id}
                    data-component-kind={event.kind}
                    data-component-shape={SHAPE_NAME[event.kind]}
                    data-child-id={childId}
                    tabIndex={0}
                    onFocus={handleMarkFocus(event.id, componentTooltip(event))}
                    onBlur={handleMarkBlur}
                  >
                    {shape({ cx, cy, color, opacity })}
                  </g>
                );
              }

              const event = cluster.representative;
              const cx = xScale(event.at);
              const shape = COMPONENT_SHAPE[event.kind];
              const color = KIND_COLOR[COMPONENT_COLOR_KEY[event.kind]];
              const childId = event.kind === 'agent' && event.childId ? event.childId : undefined;
              const count = cluster.members.length;
              const opacity =
                hoveredAgentId !== null && event.agentId !== hoveredAgentId
                  ? HOVER_DIM_OPACITY
                  : undefined;
              return (
                // See the single-mark <g> above for why this
                // static-element-interactions ignore is correct here.
                // biome-ignore lint/a11y/noStaticElementInteractions: see comment on the single-mark <g> above
                <g
                  key={event.id}
                  data-component-id={event.id}
                  data-component-ids={cluster.members.map((m) => m.id).join(',')}
                  data-component-kind={event.kind}
                  data-component-shape={SHAPE_NAME[event.kind]}
                  data-component-cluster-count={count}
                  data-child-id={childId}
                  tabIndex={0}
                  onFocus={handleMarkFocus(event.id, componentClusterTooltip(cluster))}
                  onBlur={handleMarkBlur}
                >
                  {shape({ cx, cy: cy - 1, color, opacity })}
                  <text
                    x={cx + GLYPH_SIZE + 3}
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
      {legendEntries.length > 0 && (
        <ul
          data-slot="component-track-legend"
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400"
          style={{ paddingLeft: LABEL_GUTTER_PX }}
        >
          {legendEntries.map(({ kind, count }) => (
            <li key={kind} className="inline-flex items-center gap-1">
              <svg
                width={12}
                height={12}
                viewBox="0 0 12 12"
                aria-hidden="true"
                data-legend-shape={kind}
              >
                {COMPONENT_SHAPE[kind]({
                  cx: 6,
                  cy: 6,
                  color: KIND_COLOR[COMPONENT_COLOR_KEY[kind]],
                })}
              </svg>
              <span>
                {COMPONENT_LABEL[kind]} ({count})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
