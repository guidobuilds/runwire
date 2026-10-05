import type { ListSessionsQuery } from '@runwire/core';

/** Server-sortable columns of the sessions table. */
export type SortField =
  | 'name'
  | 'harness'
  | 'startedAt'
  | 'lastActivity'
  | 'duration'
  | 'tokens'
  | 'cost';

/** A single active server sort, or `null` for the server default order. */
export type SessionsSortState = { id: SortField; desc: boolean } | null;

/**
 * The server's default order when no `sort` param is sent: newest real tree
 * activity first (`lastActivity DESC, id ASC`). The UI renders this as the
 * active indicator while `sort` is `null`, so the visible state and the
 * server order always agree.
 */
export const DEFAULT_SORT: { id: SortField; desc: boolean } = {
  id: 'lastActivity',
  desc: true,
};

/** The table's toolbar filter values. Unlike the old URL shape every field is
 * present; "unset" is encoded as `''` / `[]` rather than an absent key. */
export type SessionsFilters = {
  /** Raw search text; trimmed when building the query. */
  q: string;
  /** Selected harness ids (multi-select; empty means no harness restriction). */
  harnessIds: string[];
  /** Minimum-duration preset. */
  duration: '5m' | '30m' | '1h' | '';
  /** Cost preset. */
  cost: 'gt0' | '';
};

/** Duration preset -> inclusive lower bound in minutes. */
export const DURATION_MINUTES = { '5m': 5, '30m': 30, '1h': 60 } as const;

/** How long typed search text waits before it becomes a committed query. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Selectable server page sizes. */
export const PAGE_SIZES = [10, 20, 30, 40, 50];

/** The page size the table starts on. */
export const DEFAULT_PAGE_SIZE = 10;

/** A fresh, unfiltered toolbar state. */
export const EMPTY_FILTERS: SessionsFilters = {
  q: '',
  harnessIds: [],
  duration: '',
  cost: '',
};

/**
 * Pure mapping from the committed toolbar filters to the filters-only server
 * query (no sort, no pagination). Shared by `buildSessionsQuery` for the list
 * and used directly for the `/api/sessions/stats` query so the two can never
 * drift; the stats endpoint rejects `limit`/`offset`/`sort`.
 */
export function buildSessionsStatsQuery(filters: SessionsFilters): ListSessionsQuery {
  const query: ListSessionsQuery = {};

  const q = filters.q.trim();
  if (q) query.q = q;

  if (filters.duration) query.durationMin = DURATION_MINUTES[filters.duration];

  if (filters.cost === 'gt0') query.costOnly = true;

  if (filters.harnessIds.length > 0) query.harness = filters.harnessIds.join(',');

  return query;
}

/**
 * Pure mapping from the controlled table state to the server's
 * `ListSessionsQuery` contract. Unset filters are omitted entirely (the server
 * rejects empty values); pagination is always sent.
 */
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
