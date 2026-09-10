import type { ApiSessionsStats } from '@scout/core';
import { createFileRoute } from '@tanstack/react-router';
import { type ChartAreaDataPoint, ChartAreaInteractive } from '@/components/chart-area-interactive';
import { DataTable } from '@/components/data-table';
import { type SectionCardData, SectionCards } from '@/components/section-cards';
import { useSessionsTableState } from '@/hooks/use-sessions-table-state';
import { useSessions, useSessionsStats } from '@/queries/sessions';

// The one deliberate hand-written composition file for f4 (see plan.md decision
// #13 / stack-research.md §A3): dashboard-01's own `page.tsx` is silently dropped
// by the shadcn CLI on Vite, so this route hand-arranges the CLI-generated
// SectionCards/ChartAreaInteractive/DataTable. The table rows come from
// `useSessions()` (paged), while the SectionCards/ChartAreaInteractive metrics
// come from `useSessionsStats()` — a separate `GET /api/sessions/stats` endpoint
// that aggregates over the FULL filtered root set, so the cards/chart no longer
// depend on the visible page. Both queries use the same committed filters. The
// AppSidebar/SiteHeader chrome moved to __root.tsx in f6 (shared app-wide, not
// re-wrapped here). Table state is intentionally client-only (no URL search
// params).
export const Route = createFileRoute('/sessions/')({
  component: SessionsDashboard,
});

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

/** Total Sessions / Total Cost / Total Tokens / Avg Duration, formatted from
 * the server-side aggregates over the full filtered set. */
function cardsFromStats(stats: ApiSessionsStats): SectionCardData[] {
  return [
    { label: 'Total Sessions', value: String(stats.totalSessions) },
    { label: 'Total Cost', value: formatCurrency(stats.totalCostUsd) },
    { label: 'Total Tokens', value: formatCompactNumber(stats.totalTokens) },
    { label: 'Avg Duration', value: formatDuration(stats.avgDurationMs) },
  ];
}

/** The stats endpoint already returns the day-bucketed series the chart wants. */
function chartDataFromStats(stats: ApiSessionsStats): ChartAreaDataPoint[] {
  return stats.series.map((point) => ({ date: point.date, sessions: point.sessions }));
}

function SessionsDashboard() {
  const t = useSessionsTableState();
  const { data, isPending, isError, error, isFetching } = useSessions(t.query);
  const stats = useSessionsStats(t.statsQuery);

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
              {stats.isPending ? (
                <p className="px-4 text-sm text-muted-foreground lg:px-6">Loading metrics…</p>
              ) : stats.isError ? (
                <p className="px-4 text-sm text-destructive lg:px-6">
                  Failed to load metrics:{' '}
                  {stats.error instanceof Error ? stats.error.message : 'unknown error'}
                </p>
              ) : (
                <>
                  <SectionCards cards={cardsFromStats(stats.data)} />
                  <div className="px-4 lg:px-6">
                    <ChartAreaInteractive data={chartDataFromStats(stats.data)} />
                  </div>
                </>
              )}
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
