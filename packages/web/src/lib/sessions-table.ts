import type { ListSessionsQuery } from '@runwire/core';

export type SortField =
  | 'name'
  | 'harness'
  | 'startedAt'
  | 'lastActivity'
  | 'duration'
  | 'tokens'
  | 'cost';

export type SessionsSortState = { id: SortField; desc: boolean } | null;

export const DEFAULT_SORT: { id: SortField; desc: boolean } = {
  id: 'lastActivity',
  desc: true,
};

export type SessionsFilters = {
  q: string;
  harnessIds: string[];
  duration: '5m' | '30m' | '1h' | '';
  cost: 'gt0' | '';
};

export const DURATION_MINUTES = { '5m': 5, '30m': 30, '1h': 60 } as const;

export const SEARCH_DEBOUNCE_MS = 300;

export const PAGE_SIZES = [10, 20, 30, 40, 50];

export const DEFAULT_PAGE_SIZE = 10;

export const EMPTY_FILTERS: SessionsFilters = {
  q: '',
  harnessIds: [],
  duration: '',
  cost: '',
};

export function buildSessionsStatsQuery(filters: SessionsFilters): ListSessionsQuery {
  const query: ListSessionsQuery = {};

  const q = filters.q.trim();
  if (q) query.q = q;

  if (filters.duration) query.durationMin = DURATION_MINUTES[filters.duration];

  if (filters.cost === 'gt0') query.costOnly = true;

  if (filters.harnessIds.length > 0) query.harness = filters.harnessIds.join(',');

  return query;
}

export function buildSessionsQuery(
  filters: SessionsFilters,
  sort: SessionsSortState,
  pagination: { pageIndex: number; pageSize: number },
): ListSessionsQuery {
  const query = buildSessionsStatsQuery(filters);

  if (sort) query.sort = `${sort.desc ? '-' : ''}${sort.id}`;

  query.limit = pagination.pageSize;
  query.offset = pagination.pageIndex * pagination.pageSize;

  return query;
}
