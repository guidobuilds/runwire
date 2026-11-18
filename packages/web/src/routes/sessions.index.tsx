import type { ApiSessionsStats } from '@runwire/core';
import { createFileRoute } from '@tanstack/react-router';
import { type ChartAreaDataPoint, ChartAreaInteractive } from '@/components/chart-area-interactive';
import { DataTable } from '@/components/data-table';
import { type SectionCardData, SectionCards } from '@/components/section-cards';
import { useSessionsTableState } from '@/hooks/use-sessions-table-state';
import { useSessions, useSessionsStats } from '@/queries/sessions';

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

function cardsFromStats(stats: ApiSessionsStats): SectionCardData[] {
  return [
    { label: 'Total Sessions', value: String(stats.totalSessions) },
    { label: 'Total Cost', value: formatCurrency(stats.totalCostUsd) },
    { label: 'Total Tokens', value: formatCompactNumber(stats.totalTokens) },
    { label: 'Avg Duration', value: formatDuration(stats.avgDurationMs) },
  ];
}

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
