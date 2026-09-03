import { useNavigate } from '@tanstack/react-router';
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useRef, useState } from 'react';
import { formatTokens } from '../../lib/format';
import type { AgentSpan } from '../../lib/timeline';
import { flattenTree, type TreeNode } from '../../lib/tree';
import { cn } from '../../lib/utils';
import { CONFIDENCE_OPACITY, HOVER_DIM_OPACITY, KIND_COLOR } from '../charts/chart-theme';
import { ConfidenceDot } from '../primitives/ConfidenceDot';
import { Tooltip } from '../primitives/Tooltip';
import { depthPaddingClass } from '../session-detail/AgentTree';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { AgentTimelineOverlay } from './AgentTimelineOverlay';
import {
  AGENT_TRACK_BOTTOM_MARGIN_PX,
  AGENT_TRACK_MIN_HEIGHT_PX,
  LABEL_GUTTER_WIDTH,
  useTimeline,
} from './TimelineContext';
import { useAvailableHeight } from './useAvailableHeight';
import { pointerToElapsedMs } from './useContainerWidth';

/**
 * Agent Gantt track (design.md §3.1/§3.4/f4-t2): one lane per subtree member,
 * in `flattenTree`'s DFS order — the same order/sort convention `AgentTree`
 * (the table) already applies — bars spanning `AgentSpan.start -> .end`
 * (open-ended, clipped to the domain edge, when a bound is unknown), reduced
 * opacity for medium/low `confidenceLevel` (design.md §1.4, the per-span
 * extension of `TraceRibbon`'s D36 rule). Lane indentation reuses
 * `AgentTree.tsx`'s own `depthPaddingClass` rather than inventing a second
 * padding-class table.
 *
 * timeline-chart-usability design.md §2/§3/§4/§5 (f2, this track's own
 * usability pass, depends on f1's `hoveredAgentId`/`hoveredMark`/
 * `MarkTooltip`/`HOVER_DIM_OPACITY`):
 * - Row density + dynamic viewport height (§2, f2-t1): `agentRowHeight`
 *   (context, default 22, stepped by `TimelineSummaryBar`) replaces the old
 *   local `ROW_HEIGHT` constant; `BAR_HEIGHT` is now derived
 *   (`Math.max(agentRowHeight - 10, 4)`). The lane stack is wrapped in an
 *   outer bounded-scroll div (`useAvailableHeight`'s ref) whose `maxHeight`
 *   is `Math.max(rawAvailableHeight, AGENT_TRACK_MIN_HEIGHT_PX)`.
 * - Row-level hover-dim trigger (§1/f2-t3): each lane's outer row `<div>`
 *   (not just its bar) sets/clears `hoveredAgentId` on mouse enter/leave, in
 *   addition to the existing per-svg `onMouseMove`/`onMouseLeave` that drives
 *   the shared cursor. Each bar's own opacity dims to `HOVER_DIM_OPACITY`
 *   (overriding, not multiplying, `CONFIDENCE_OPACITY`) when a DIFFERENT
 *   agent is hovered.
 * - Mark tooltip (§3/f2-t3): the native `<title>` is gone — the same
 *   `MarkTooltip`/hit-test/unchanged-hit-skip mechanism f1 established for
 *   the other three tracks, reusing this file's own `tooltipText` verbatim.
 * - Label tooltip (§4/f2-t4): the always-visible model `<span>` is gone; the
 *   name element is wrapped in `components/primitives/Tooltip` with content
 *   `"${label} - ${span.model}"` (or just `label`).
 * - Click-to-popup (§5/f2-t5): for any non-root row, the (already
 *   Tooltip-wrapped) name element becomes a `PopoverTrigger` inside a
 *   controlled `Popover` offering "Quick view" (opens `AgentTimelineOverlay`)
 *   and "Go to session" (`navigate` to `/sessions/$id`). The root row
 *   (`depth === 0`) gets no popup at all.
 */

/** `AgentActionsPopover`'s two actionable rows share this base styling — local, not exported, matching its own local-only scope. */
const ROW_ACTION_CLASS =
  'w-full rounded-md px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800';

export type AgentTrackProps = {
  root: TreeNode;
  spans: readonly AgentSpan[];
};

/** "mm:ss" from an elapsed-ms value. Local helper, matching `TokenTrack.tsx`'s copy (no shared mm:ss formatter exists yet — that lands with `TimelineAxis`, a later task). */
function formatElapsed(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${sign}${min}:${String(sec).padStart(2, '0')}`;
}

/** `AgentSpan.name`'s own derivation (`agentType ?? relation ?? 'root'`), for a lane whose span is missing. */
function laneName(node: TreeNode, span: AgentSpan | undefined): string {
  return span?.name ?? node.summary.agentType ?? node.summary.relation ?? 'root';
}

/** Tooltip contract per design.md §f4 archiveWhen: name/start-end/duration/tokens/model/parent. */
function tooltipText(span: AgentSpan, spansById: ReadonlyMap<string, AgentSpan>): string {
  const startText = span.start !== undefined ? formatElapsed(span.start) : 'unknown';
  const endText = span.end !== undefined ? formatElapsed(span.end) : 'unknown';
  const durationText =
    span.start !== undefined && span.end !== undefined
      ? formatElapsed(span.end - span.start)
      : 'unknown';
  const tokensText =
    span.inputTokens !== undefined || span.outputTokens !== undefined
      ? `${formatTokens(span.inputTokens ?? 0)} in / ${formatTokens(span.outputTokens ?? 0)} out`
      : 'unknown';
  const parentName = span.parentAgentId
    ? (spansById.get(span.parentAgentId)?.name ?? span.parentAgentId)
    : 'none';
  return [
    `Name: ${span.name}`,
    `Start: ${startText}`,
    `End: ${endText}`,
    `Duration: ${durationText}`,
    `Tokens: ${tokensText}`,
    `Model: ${span.model ?? 'unknown'}`,
    `Parent: ${parentName}`,
  ].join('\n');
}

/**
 * Row-actions popover content (design.md §5, f2-t5): "Quick view" / "Go to
 * session". Local, non-exported — same precedent `SessionHeader.tsx`'s
 * `ModelChangesPopover` already set for a small popover-only helper that
 * doesn't warrant its own file.
 */
function AgentRowActions({
  onQuickView,
  onGoToSession,
}: {
  onQuickView: () => void;
  onGoToSession: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <button type="button" onClick={onQuickView} className={ROW_ACTION_CLASS}>
        Quick view
      </button>
      <button type="button" onClick={onGoToSession} className={ROW_ACTION_CLASS}>
        Go to session
      </button>
    </div>
  );
}

export function AgentTrack({ root, spans }: AgentTrackProps) {
  const {
    xScale,
    width,
    domain,
    agentRowHeight,
    setCursorTime,
    selectEvent,
    hoveredAgentId,
    setHoveredAgentId,
    setHoveredMark,
  } = useTimeline();
  const [domainMin, domainMax] = domain;
  const navigate = useNavigate();

  const [availableHeightRef, rawAvailableHeight] = useAvailableHeight<HTMLDivElement>(
    AGENT_TRACK_BOTTOM_MARGIN_PX,
  );
  const [openActionsForAgentId, setOpenActionsForAgentId] = useState<string | null>(null);
  const [quickViewAgentId, setQuickViewAgentId] = useState<string | null>(null);

  // Last hit-tested `data-agent-span` id (or `null`), tracked outside React
  // state so `handleMove` can skip the hit-test/`setHoveredMark` call
  // entirely when it's unchanged across consecutive mousemove ticks over the
  // same bar -- mirrors TokenTrack/HarnessTrack/ComponentTrack's identical
  // ref-based skip (timeline-chart-usability design.md §3 perf note).
  const hoveredMarkIdRef = useRef<string | null>(null);

  const lanes = flattenTree(root);
  const spansById = new Map(spans.map((s) => [s.agentId, s]));

  if (lanes.length === 0) {
    return (
      <div role="img" aria-label="No agent span data">
        <span className="text-xs italic text-zinc-500 dark:text-zinc-400">No agent span data</span>
      </div>
    );
  }

  const barHeight = Math.max(agentRowHeight - 10, 4);

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorTime(pointerToElapsedMs(event.clientX, rect, width, xScale));

    const el = (event.target as SVGElement | null)?.closest?.('[data-agent-span]');
    const id = el?.getAttribute('data-agent-span') ?? null;
    if (id === hoveredMarkIdRef.current) return;
    hoveredMarkIdRef.current = id;
    if (id === null) {
      setHoveredMark(null);
      return;
    }
    const span = spansById.get(id);
    if (!span) return;
    setHoveredMark({
      content: tooltipText(span, spansById),
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };
  const handleLeave = () => {
    setCursorTime(null);
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  const handleMarkFocus = (span: AgentSpan) => (event: ReactFocusEvent<SVGRectElement>) => {
    hoveredMarkIdRef.current = span.agentId;
    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredMark({
      content: tooltipText(span, spansById),
      clientX: rect.left,
      clientY: rect.top,
    });
  };
  const handleMarkBlur = () => {
    hoveredMarkIdRef.current = null;
    setHoveredMark(null);
  };
  // Click-to-select (f6): hit-tests via `data-agent-span` on the same
  // `<svg role="img">` lane element the shared hover contract already uses,
  // rather than an onClick on the bare `<rect>` bar itself. The bar carries
  // `tabIndex={0}` so it is a real keyboard focus target; Enter/Space bubbles
  // to this same handler with `event.target` already equal to the bar
  // (`useKeyWithClickEvents`).
  const selectFromTarget = (target: EventTarget | null) => {
    const el = (target as SVGElement | null)?.closest?.('[data-agent-span]');
    const id = el?.getAttribute('data-agent-span');
    if (id) selectEvent(id);
  };
  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => selectFromTarget(event.target);
  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectFromTarget(event.target);
  };

  const containerMaxHeight = Math.max(rawAvailableHeight, AGENT_TRACK_MIN_HEIGHT_PX);

  return (
    <>
      <div
        data-slot="agent-track-scroll"
        ref={availableHeightRef}
        style={{ maxHeight: containerMaxHeight, overflowY: 'auto' }}
      >
        <div data-slot="agent-track" className="space-y-px">
          {lanes.map((node) => {
            const span = spansById.get(node.id);
            const label = laneName(node, span);
            // A span missing `start` or `end` entirely (not just low confidence,
            // actually absent) must never render as silently zero-width — it
            // renders as an open bar clipped to the domain edge, plus a
            // ConfidenceDot in the row label, independent of `confidenceLevel`
            // (design.md §1.4: those two signals are not the same thing —
            // `confidenceLevel` can still read `high` when only one of two
            // timing metrics is present).
            const missingBound = span ? span.start === undefined || span.end === undefined : false;
            const isRoot = node.summary.depth === 0;
            const tooltipContent = span?.model ? `${label} - ${span.model}` : label;
            const nameElement = (
              <span className="truncate text-xs text-zinc-900 dark:text-zinc-50">{label}</span>
            );

            return (
              // This row's onMouseEnter/onMouseLeave are a pure hover-dim
              // visual affordance (timeline-chart-usability design.md §1) --
              // they gate no functionality and have no keyboard equivalent
              // by design (dimming every OTHER row while one is hovered is a
              // supplementary scan aid, not required to use this row: its own
              // bar and label stay independently keyboard-focusable via their
              // own tabIndex/role regardless of hoveredAgentId). No ARIA role
              // fits a row that already contains a real interactive label
              // and an `<svg role="img">` plot area, so `noStaticElement
              // Interactions` is ignored here rather than reached for a role
              // that would misdescribe the row -- same shape as the
              // `timeline-chart-usability-svg-mark-focus-blur-lint-ignore`
              // lesson's mark-level ignore, applied at the row level instead.
              // biome-ignore lint/a11y/noStaticElementInteractions: see comment above
              <div
                key={node.id}
                className="flex items-center gap-2"
                onMouseEnter={() => setHoveredAgentId(node.summary.id)}
                onMouseLeave={() => setHoveredAgentId(null)}
              >
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 overflow-hidden',
                    LABEL_GUTTER_WIDTH,
                    depthPaddingClass(node.summary.depth),
                  )}
                >
                  {missingBound && <ConfidenceDot level="low" />}
                  {isRoot ? (
                    <Tooltip content={tooltipContent}>{nameElement}</Tooltip>
                  ) : (
                    <Popover
                      open={openActionsForAgentId === node.id}
                      onOpenChange={(open) => setOpenActionsForAgentId(open ? node.id : null)}
                    >
                      <Tooltip content={tooltipContent}>
                        <PopoverTrigger>{nameElement}</PopoverTrigger>
                      </Tooltip>
                      <PopoverContent className="w-40 p-1">
                        <AgentRowActions
                          onQuickView={() => {
                            setQuickViewAgentId(node.id);
                            setOpenActionsForAgentId(null);
                          }}
                          onGoToSession={() => {
                            void navigate({ to: '/sessions/$id', params: { id: node.id } });
                            setOpenActionsForAgentId(null);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </span>
                <svg
                  role="img"
                  aria-label={`${label} span`}
                  width="100%"
                  viewBox={`0 0 ${width} ${agentRowHeight}`}
                  height={agentRowHeight}
                  preserveAspectRatio="none"
                  className="min-w-0 flex-1"
                  onMouseMove={handleMove}
                  onMouseLeave={handleLeave}
                  onClick={handleClick}
                  onKeyDown={handleKeyDown}
                >
                  {span && (
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
                      data-agent-span={span.id}
                      aria-label={tooltipText(span, spansById)}
                      tabIndex={0}
                      x={xScale(span.start ?? domainMin)}
                      y={(agentRowHeight - barHeight) / 2}
                      width={Math.max(
                        xScale(span.end ?? domainMax) - xScale(span.start ?? domainMin),
                        1,
                      )}
                      height={barHeight}
                      fill={KIND_COLOR.agent}
                      opacity={
                        hoveredAgentId !== null && span.agentId !== hoveredAgentId
                          ? HOVER_DIM_OPACITY
                          : CONFIDENCE_OPACITY[span.confidenceLevel]
                      }
                      onFocus={handleMarkFocus(span)}
                      onBlur={handleMarkBlur}
                    />
                  )}
                </svg>
              </div>
            );
          })}
        </div>
      </div>
      <AgentTimelineOverlay agentId={quickViewAgentId} onClose={() => setQuickViewAgentId(null)} />
    </>
  );
}
