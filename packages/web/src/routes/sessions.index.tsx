import type { ApiSessionSummary, ApiTokenTotals } from '@scout/core';
import { createFileRoute } from '@tanstack/react-router';
import { type ChartAreaDataPoint, ChartAreaInteractive } from '@/components/chart-area-interactive';
import { DataTable } from '@/components/data-table';
import { type SectionCardData, SectionCards } from '@/components/section-cards';
import { useSessionsTableState } from '@/hooks/use-sessions-table-state';
import { useSessions } from '@/queries/sessions';

// The one deliberate hand-written composition file for f4 (see plan.md decision
// #13 / stack-research.md §A3): dashboard-01's own `page.tsx` is silently dropped
// by the shadcn CLI on Vite, so this route hand-arranges the CLI-generated
// SectionCards/ChartAreaInteractive/DataTable, feeding all of them from a single
// `useSessions()` call -- no separate API endpoint for the card metrics or chart
// series, both are computed client-side from that one list. The AppSidebar/
// SiteHeader chrome moved to __root.tsx in f6 (shared app-wide, not re-wrapped
// here). Table state is intentionally client-only (no URL search params).
export const Route = createFileRoute('/sessions/')({
  component: SessionsDashboard,
});

function sumTokens(totals: ApiTokenTotals): number {
  return (
    totals.uncachedInput +
    totals.cachedInput +
    totals.cacheWrite +
    totals.output +
    totals.reasoningOutput
  );
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Total Sessions / Total Cost / Total Tokens / Avg Duration, computed
 * client-side from the fetched `ApiSessionSummary[]` (plan.md decision #13). */
function computeCards(sessions: ApiSessionSummary[]): SectionCardData[] {
  const totalCost = sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const totalTokens = sessions.reduce((sum, s) => sum + sumTokens(s.tokensInclusive), 0);
  const durations = sessions.map((s) => s.durationMs).filter((d): d is number => d !== null);
  const avgDurationMs =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return [
    { label: 'Total Sessions', value: String(sessions.length) },
    { label: 'Total Cost', value: formatCurrency(totalCost) },
    { label: 'Total Tokens', value: formatCompactNumber(totalTokens) },
    { label: 'Avg Duration', value: formatDuration(avgDurationMs) },
  ];
}

/** Sessions-per-day series, bucketed client-side from `startedAt` (plan.md
 * decision #13) — sessions with no `startedAt` are excluded from the chart. */
function computeChartData(sessions: ApiSessionSummary[]): ChartAreaDataPoint[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (!session.startedAt) continue;
    const day = session.startedAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, sessions: count }));
}

function SessionsDashboard() {
  const t = useSessionsTableState();
  const { data, isPending, isError, error, isFetching } = useSessions(t.query);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          {isPending ? (
            <p className="px-4 text-sm text-muted-foreground lg:px-6">Loading sessions…</p>
          ) : isError ? (
            <p className="px-4 text-sm text-destructive lg:px-6">
              Failed to load sessions: {error instanceof Error ? error.message : 'unknown error'}
            </p>
          ) : (
            <>
              {data.total > data.items.length ? (
                <p className="px-4 text-sm text-muted-foreground lg:px-6">
                  Showing metrics for this page's {data.items.length} of {data.total} sessions.
                </p>
              ) : null}
              <SectionCards cards={computeCards(data.items)} />
              <div className="px-4 lg:px-6">
                <ChartAreaInteractive data={computeChartData(data.items)} />
              </div>
              <DataTable
                data={data.items}
                total={data.total}
                isFetching={isFetching}
                filters={t.filters}
                sort={t.sort}
                pagination={t.pagination}
                onFiltersChange={t.setFilters}
                onSortChange={t.setSort}
                onPageChange={t.setPage}
                onPageSizeChange={t.setPageSize}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
