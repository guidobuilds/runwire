import { useMemo, useState } from 'react';
import { useHarnesses } from '../api/queries';
import type { HarnessAggregate } from '../api/types';
import { formatRelative } from '../lib/format';
import { EmptyState, useHasData } from './EmptyState';
// Shared list helpers live in ProjectsList.tsx — see the note at the top of
// that file for why f4 keeps them there rather than in a new module.
import {
  AggregateTokens,
  aggregateTokens,
  ariaSort,
  compareOptional,
  type SortState,
  useDisplayNames,
} from './ProjectsList';
import { QueryState } from './ui/QueryState';
import { Table, Tbody, Td, Th, Thead, Tr } from './ui/Table';

export type HarnessSortKey = 'harness' | 'sessions' | 'projects' | 'latest' | 'tokens';

export type HarnessTableProps = {
  harnesses: readonly HarnessAggregate[];
  displayNameFor: (harnessId: string) => string;
  onOpen: (harnessId: string) => void;
  /** Injected for deterministic relative times in tests. */
  now?: number;
};

/** Pure Harnesses table. Router-free: the route supplies `onOpen`. */
export function HarnessTable({ harnesses, displayNameFor, onOpen, now }: HarnessTableProps) {
  const [sort, setSort] = useState<SortState<HarnessSortKey>>({
    key: 'latest',
    direction: 'desc',
  });
  const nowMs = now ?? Date.now();

  const rows = useMemo(() => {
    const compare = (a: HarnessAggregate, b: HarnessAggregate): number => {
      switch (sort.key) {
        case 'harness':
          return displayNameFor(a.harness).localeCompare(displayNameFor(b.harness));
        case 'sessions':
          return a.sessionCount - b.sessionCount;
        case 'projects':
          return a.projects.length - b.projects.length;
        case 'latest':
          return compareOptional(a.latestActivityAt, b.latestActivityAt);
        case 'tokens':
          return (
            (aggregateTokens(a.aggregateUsage).total ?? -1) -
            (aggregateTokens(b.aggregateUsage).total ?? -1)
          );
      }
    };
    const sorted = [...harnesses].sort(compare);
    return sort.direction === 'desc' ? sorted.reverse() : sorted;
  }, [harnesses, sort, displayNameFor]);

  const onSort = (key: HarnessSortKey) => () => {
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
          <Th sortable sortDirection={ariaSort(sort, 'harness')} onSort={onSort('harness')}>
            Harness
          </Th>
          <Th sortable sortDirection={ariaSort(sort, 'sessions')} onSort={onSort('sessions')}>
            Sessions
          </Th>
          <Th sortable sortDirection={ariaSort(sort, 'projects')} onSort={onSort('projects')}>
            Projects
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
            key={row.harness}
            className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
            onClick={() => onOpen(row.harness)}
          >
            <Td>
              <button
                type="button"
                className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(row.harness);
                }}
              >
                {displayNameFor(row.harness)}
              </button>
            </Td>
            <Td numeric>{row.sessionCount}</Td>
            <Td numeric>{row.projects.length}</Td>
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

export type HarnessListProps = {
  onOpen: (harnessId: string) => void;
  now?: number;
};

/** Query-wired Harnesses view: empty state, load/error state, then the table. */
export function HarnessList({ onOpen, now }: HarnessListProps) {
  const harnesses = useHarnesses();
  const displayNameFor = useDisplayNames();
  const hasData = useHasData();

  if (!hasData) return <EmptyState />;

  return (
    <QueryState isPending={harnesses.isPending} error={harnesses.error} refetch={harnesses.refetch}>
      <HarnessTable
        harnesses={harnesses.data ?? []}
        displayNameFor={displayNameFor}
        onOpen={onOpen}
        now={now}
      />
    </QueryState>
  );
}
