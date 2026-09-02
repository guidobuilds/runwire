import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { formatTokens } from '../../lib/format';
import type { AgentSpan } from '../../lib/timeline';
import { flattenTree, type TreeNode } from '../../lib/tree';
import { cn } from '../../lib/utils';
import { CONFIDENCE_OPACITY, KIND_COLOR } from '../charts/chart-theme';
import { ConfidenceDot } from '../primitives/ConfidenceDot';
import { depthPaddingClass } from '../session-detail/AgentTree';
import { LABEL_GUTTER_WIDTH, useTimeline } from './TimelineContext';
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
 */

const ROW_HEIGHT = 22;
const BAR_HEIGHT = 12;

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

export function AgentTrack({ root, spans }: AgentTrackProps) {
  const { xScale, width, domain, setCursorTime, selectEvent } = useTimeline();
  const [domainMin, domainMax] = domain;

  const lanes = flattenTree(root);
  const spansById = new Map(spans.map((s) => [s.agentId, s]));

  if (lanes.length === 0) {
    return (
      <div role="img" aria-label="No agent span data">
        <span className="text-xs italic text-zinc-500 dark:text-zinc-400">No agent span data</span>
      </div>
    );
  }

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursorTime(pointerToElapsedMs(event.clientX, rect, width, xScale));
  };
  const handleLeave = () => setCursorTime(null);
  // Click-to-select (f6): hit-tests via `data-agent-span` on the same
  // `<svg role="img">` lane element the shared hover contract already uses
  // (see `session-timeline-track-hover-contract`), rather than an onClick on
  // the bare `<rect>` bar itself. The bar carries `tabIndex={0}` so it is a
  // real keyboard focus target; Enter/Space bubbles to this same handler
  // with `event.target` already equal to the bar (`useKeyWithClickEvents`).
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

  return (
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

        return (
          <div key={node.id} className="flex items-center gap-2">
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 overflow-hidden',
                LABEL_GUTTER_WIDTH,
                depthPaddingClass(node.summary.depth),
              )}
            >
              {missingBound && <ConfidenceDot level="low" />}
              <span className="truncate text-xs text-zinc-900 dark:text-zinc-50">{label}</span>
              {span?.model && (
                <span className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                  {span.model}
                </span>
              )}
            </span>
            <svg
              role="img"
              aria-label={`${label} span`}
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
              {span && (
                <rect
                  data-agent-span={span.id}
                  tabIndex={0}
                  x={xScale(span.start ?? domainMin)}
                  y={(ROW_HEIGHT - BAR_HEIGHT) / 2}
                  width={Math.max(
                    xScale(span.end ?? domainMax) - xScale(span.start ?? domainMin),
                    1,
                  )}
                  height={BAR_HEIGHT}
                  fill={KIND_COLOR.agent}
                  opacity={CONFIDENCE_OPACITY[span.confidenceLevel]}
                >
                  <title>{tooltipText(span, spansById)}</title>
                </rect>
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
