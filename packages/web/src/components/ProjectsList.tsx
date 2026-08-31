import { useMemo, useState } from 'react';
import { useProjects, useStatus } from '../api/queries';
import type { Confidence, ProjectAggregate, Usage } from '../api/types';
import { formatRelative, formatTokens } from '../lib/format';
import { EmptyState, useHasData } from './EmptyState';
import { ConfidenceMarker } from './MetricCell';
import { Badge } from './ui/Badge';
import { QueryState } from './ui/QueryState';
import { Table, Tbody, Td, Th, Thead, Tr } from './ui/Table';
import { Tooltip } from './ui/Tooltip';

/*
 * The three helpers below (`useDisplayNames`, `aggregateTokens`,
 * `AggregateTokens`) are shared with `HarnessList.tsx`, which imports them from
 * here. They live in this file rather than a new module because f4's task
 * ledger fixes the feature's file surface, and a parallel batch is the wrong
 * moment to widen it. Move them out when a third caller appears.
 */

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Adapter id → display name, resolved once from `useStatus()` and handed to
 * every row as a plain function. Hoisted deliberately: a per-badge hook would
 * open one status observer per rendered badge (design.md §5).
 */
export function useDisplayNames(): (harnessId: string) => string {
  const { data } = useStatus();
  return useMemo(() => {
    // Plain `string` keys, not `HarnessId`: at the JSON boundary `harness` is a
    // free string so an unknown/future harness id still resolves (core's
    // model/harness.ts says so explicitly).
    const byId = new Map<string, string>(
      (data?.adapters ?? []).map((adapter) => [adapter.id, adapter.displayName]),
    );
    return (harnessId: string) => byId.get(harnessId) ?? harnessId;
  }, [data]);
}

export type AggregateTokenSummary = {
  /** `undefined` when the harness reported neither half. */
  total: number | undefined;
  confidence: Confidence;
  /** Hover provenance: one line per half, absent halves named as such. */
  title: string;
};

/**
 * Aggregate tokens for a list row: `totalInput + output`, absent halves counted
 * as 0.
 *
 * Confidence is the weakest of the halves that were actually reported, and a
 * sum missing one half is capped at `low` regardless — the number shown is then
 * a floor, not a measurement, and marking it `high` would be the one thing
 * Scout promises never to do. The hover text always names both halves so the
 * gap is on screen, not just implied.
 */
export function aggregateTokens(usage: Usage): AggregateTokenSummary {
  const parts = [
    { label: 'Input', metric: usage.totalInput },
    { label: 'Output', metric: usage.output },
  ];

  const title = parts
    .map(({ label, metric }) =>
      metric
        ? `${label} ${formatTokens(metric.value)} · ${metric.confidence} confidence · ${metric.source}`
        : `${label} — not reported`,
    )
    .join('\n');

  const present = parts.flatMap(({ metric }) => (metric ? [metric] : []));
  if (present.length === 0) return { total: undefined, confidence: 'low', title };

  const total = present.reduce((sum, metric) => sum + metric.value, 0);
  let confidence: Confidence = present.length === parts.length ? 'high' : 'low';
  for (const metric of present) {
    if (CONFIDENCE_RANK[metric.confidence] < CONFIDENCE_RANK[confidence]) {
      confidence = metric.confidence;
    }
  }
  return { total, confidence, title };
}

/** One aggregate-token cell: value, confidence marker, hover breakdown. */
export function AggregateTokens({ usage }: { usage: Usage }) {
  const { total, confidence, title } = aggregateTokens(usage);
  if (total === undefined) {
    return (
      <Tooltip content={title}>
        <span className="text-zinc-500 dark:text-zinc-400">—</span>
      </Tooltip>
    );
  }
  const tone =
    confidence === 'high' ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400';
  return (
    <Tooltip content={title}>
      <span className={tone}>
        <ConfidenceMarker confidence={confidence} />
        {formatTokens(total)}
      </span>
    </Tooltip>
  );
}

export type SortDirection = 'asc' | 'desc';

export type SortState<K extends string> = { key: K; direction: SortDirection };

export function ariaSort<K extends string>(
  sort: SortState<K>,
  key: K,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** Absent values sort last in both directions; they are unknown, not smallest. */
export function compareOptional(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}

export type ProjectsSortKey = 'project' | 'sessions' | 'harnesses' | 'latest' | 'tokens';

export type ProjectsTableProps = {
  projects: readonly ProjectAggregate[];
  displayNameFor: (harnessId: string) => string;
  onOpen: (projectKey: string) => void;
  /** Injected for deterministic relative times in tests. */
  now?: number;
};

/**
 * Pure Projects listing (PRODUCT.md columns). Router-free on purpose: the route
 * supplies `onOpen`, so this renders in a test with no router mounted.
 */
export function ProjectsTable({ projects, displayNameFor, onOpen, now }: ProjectsTableProps) {
  const [sort, setSort] = useState<SortState<ProjectsSortKey>>({
    key: 'latest',
    direction: 'desc',
  });
  const nowMs = now ?? Date.now();

  const rows = useMemo(() => {
    const compare = (a: ProjectAggregate, b: ProjectAggregate): number => {
      switch (sort.key) {
        case 'project':
          return a.project.name.localeCompare(b.project.name);
        case 'sessions':
          return a.sessionCount - b.sessionCount;
        case 'harnesses':
          return a.harnesses.length - b.harnesses.length;
        case 'latest':
          return compareOptional(a.latestActivityAt, b.latestActivityAt);
        case 'tokens':
          return (
            (aggregateTokens(a.aggregateUsage).total ?? -1) -
            (aggregateTokens(b.aggregateUsage).total ?? -1)
          );
      }
    };
    const sorted = [...projects].sort(compare);
    return sort.direction === 'desc' ? sorted.reverse() : sorted;
  }, [projects, sort]);

  const onSort = (key: ProjectsSortKey) => () => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' },
    );
  };

  return (
    <Table>
      <Thead>
        <Tr>
          <Th sortable sortDirection={ariaSort(sort, 'project')} onSort={onSort('project')}>
            Project
          </Th>
          <Th sortable sortDirection={ariaSort(sort, 'sessions')} onSort={onSort('sessions')}>
            Sessions
          </Th>
          <Th sortable sortDirection={ariaSort(sort, 'harnesses')} onSort={onSort('harnesses')}>
            Harnesses
          </Th>
          <Th sortable sortDirection={ariaSort(sort, 'latest')} onSort={onSort('latest')}>
            Latest activity
          </Th>
          <Th sortable sortDirection={ariaSort(sort, 'tokens')} onSort={onSort('tokens')}>
            Aggregate tokens
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((row) => (
          <Tr
            key={row.project.key}
            className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
            onClick={() => onOpen(row.project.key)}
          >
            <Td>
              <span className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(row.project.key);
                  }}
                >
                  {row.project.name}
                </button>
                <Badge>{row.project.identity}</Badge>
                {row.project.worktree ? (
                  <Badge tone="info">worktree: {row.project.worktree}</Badge>
                ) : null}
              </span>
            </Td>
            <Td numeric>{row.sessionCount}</Td>
            <Td>
              <span className="flex flex-wrap gap-1">
                {row.harnesses.map((harness) => (
                  <Badge key={harness}>{displayNameFor(harness)}</Badge>
                ))}
              </span>
            </Td>
            <Td>
              {row.latestActivityAt ? formatRelative(row.latestActivityAt, nowMs) : 'unknown'}
            </Td>
            <Td numeric>
              <AggregateTokens usage={row.aggregateUsage} />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}

export type ProjectsListProps = {
  onOpen: (projectKey: string) => void;
  now?: number;
};

/** Query-wired Projects view: empty state, load/error state, then the table. */
export function ProjectsList({ onOpen, now }: ProjectsListProps) {
  const projects = useProjects();
  const displayNameFor = useDisplayNames();
  const hasData = useHasData();

  if (!hasData) return <EmptyState />;

  return (
    <QueryState isPending={projects.isPending} error={projects.error} refetch={projects.refetch}>
      <ProjectsTable
        projects={projects.data ?? []}
        displayNameFor={displayNameFor}
        onOpen={onOpen}
        now={now}
      />
    </QueryState>
  );
}
