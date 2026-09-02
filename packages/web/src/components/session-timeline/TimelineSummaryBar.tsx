import type { ReactNode } from 'react';
import type { Capability, SessionRollup, SessionSummary } from '../../api/types';
import { formatTokens } from '../../lib/format';
import { MetricCell } from '../primitives/MetricCell';
import { sumPresentUsage } from '../session-detail/TokenBreakdown';

/**
 * Compact summary line above `SessionTimeline`'s four tracks (design.md
 * §3.6, f7-t1): duration/total tokens/tool count are sourced from numbers
 * `TokenBreakdown`/`CountsPanel` already render on this same page —
 * `rollup.inclusive.usage` (via the same `sumPresentUsage` helper
 * `TokenBreakdown`'s own "Total (inclusive)" line uses) and `rollup.inclusive
 * .counts.toolCalls` — never re-derived from the merged trace stream, so
 * this bar can never silently disagree with the panels above it on the same
 * session.
 *
 * "Agents" is `subtree.summaries.length` — the total distinct agents in this
 * session's subtree, root INCLUDED. This is deliberately a different number
 * from `CountsPanel`'s "Subagents" row (`rollup.inclusive.counts.subagents`,
 * root EXCLUDED by construction — see `packages/core/src/link/link.ts`'s
 * `descendants`) — the two stats answer different questions ("how many
 * agents does this timeline span" vs. "how many subagents did the root
 * spawn") and will always differ by exactly 1 on any session with at least
 * one subagent. This is not drift to be reconciled; see the cross-panel
 * lock-in test in `SessionDetail.test.tsx` and f7's `archiveWhen` in
 * `.forge/session-timeline/feature-list.json`.
 *
 * MCP call count is the one genuinely new number (no equivalent exists
 * elsewhere on the page): a plain count of `ComponentEvent`s with
 * `kind === 'mcp'`, supplied by the caller (`useSessionTimelineData`'s
 * already-derived `componentEvents`).
 */

export type TimelineSummaryBarProps = {
  summary: SessionSummary;
  rollup: SessionRollup | undefined;
  agentCount: number;
  mcpCallCount: number;
  capabilities: readonly Capability[] | undefined;
  displayName: string;
  /** Whether the timeline's shared domain is currently narrower than the full session (f9) -- when true, a "Reset zoom" control renders. Optional so every caller that predates f9 (only this file's own tests) keeps compiling unchanged. */
  isZoomed?: boolean;
  /** Restores the full-session domain (f9). Required together with `isZoomed` for the reset control to render -- see the `isZoomed && onResetZoom` guard below. */
  onResetZoom?: () => void;
};

function Stat({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {children}
      </dd>
    </div>
  );
}

export function TimelineSummaryBar({
  summary,
  rollup,
  agentCount,
  mcpCallCount,
  capabilities,
  displayName,
  isZoomed = false,
  onResetZoom,
}: TimelineSummaryBarProps) {
  const harness = summary.harness;
  const totalTokens = sumPresentUsage(rollup?.inclusive.usage ?? {});

  return (
    <div data-slot="timeline-summary-bar-row" className="flex items-start gap-3">
      <dl
        data-slot="timeline-summary-bar"
        className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-5"
      >
        <Stat label="Duration">
          <MetricCell
            field="durationMs"
            harness={harness}
            metric={summary.timing.durationMs}
            capabilities={capabilities}
            displayName={displayName}
          />
        </Stat>
        <Stat label="Total tokens">
          {totalTokens !== undefined ? (
            formatTokens(totalTokens)
          ) : (
            <MetricCell
              field="totalInput"
              harness={harness}
              capabilities={capabilities}
              displayName={displayName}
            />
          )}
        </Stat>
        <Stat
          label="Agents"
          title="Total agents in this session's subtree, including the root (root-inclusive) — distinct from Counts' root-exclusive Subagents row by exactly 1 when subagents exist"
        >
          {agentCount}
        </Stat>
        <Stat label="Tool calls">
          <MetricCell
            field="toolCalls"
            harness={harness}
            metric={rollup?.inclusive.counts.toolCalls}
            capabilities={capabilities}
            displayName={displayName}
          />
        </Stat>
        <Stat label="MCP calls">{mcpCallCount}</Stat>
      </dl>
      {/*
       * Reset-zoom control (f9-t3): only rendered once a drag-select (f9-t2)
       * has actually narrowed the shared domain -- `isZoomed` is computed by
       * `SessionTimeline` by comparing its own `domain` state against the
       * full-session `[0, maxElapsed]` range, not re-derived here. A
       * double-click on the tracks area is the secondary reset affordance
       * (wired in `SessionTimeline.tsx`, not this file).
       */}
      {isZoomed && onResetZoom ? (
        <button
          type="button"
          data-slot="reset-zoom-button"
          onClick={onResetZoom}
          className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reset zoom
        </button>
      ) : null}
    </div>
  );
}
