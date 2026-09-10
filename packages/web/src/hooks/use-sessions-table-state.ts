import * as React from 'react';
import {
  buildSessionsQuery,
  buildSessionsStatsQuery,
  DEFAULT_PAGE_SIZE,
  EMPTY_FILTERS,
  SEARCH_DEBOUNCE_MS,
  type SessionsFilters,
  type SessionsSortState,
} from '@/lib/sessions-table';

export type SessionsTablePagination = {
  pageIndex: number;
  pageSize: number;
};

export type SetSessionsFiltersOptions = {
  /** Commit the change immediately instead of waiting for the text debounce. */
  immediate?: boolean;
};

export type UseSessionsTableStateResult = {
  /** The displayed (draft) filters — updates as the user types. */
  filters: SessionsFilters;
  sort: SessionsSortState;
  pagination: SessionsTablePagination;
  /** The server query built from the committed filters/sort/pagination. */
  query: ReturnType<typeof buildSessionsQuery>;
  /** The stats query built from the committed filters ONLY (no sort/pagination),
   * so page changes never refetch the cards/chart. */
  statsQuery: ReturnType<typeof buildSessionsStatsQuery>;
  setFilters: (next: SessionsFilters, options?: SetSessionsFiltersOptions) => void;
  setSort: (next: SessionsSortState) => void;
  setPage: (pageIndex: number) => void;
  setPageSize: (pageSize: number) => void;
};

/**
 * Owns the sessions table's client-side state. Keeps a draft copy of the
 * filters for the search input while committing the query after
 * `SEARCH_DEBOUNCE_MS`; discrete controls (preset/cost/harness/sort/clear)
 * commit immediately and cancel or flush the pending text commit so only one
 * request is issued per user intent.
 */
export function useSessionsTableState(): UseSessionsTableStateResult {
  const [filters, setDraftFilters] = React.useState<SessionsFilters>(EMPTY_FILTERS);
  const [committedFilters, setCommittedFilters] = React.useState<SessionsFilters>(EMPTY_FILTERS);
  const [sort, setSortState] = React.useState<SessionsSortState>(null);
  const [pagination, setPagination] = React.useState<SessionsTablePagination>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // The most recent draft filters, read by the debounce timer and by immediate
  // commits without re-creating the timer callback on every keystroke.
  const latestFiltersRef = React.useRef(filters);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingCommit = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // A committed filter/sort change can shrink or reorder the result set, so the
  // page returns to 0. This runs in the SAME commit as the filter/sort update
  // (not in a post-render effect), so the committed query and the pagination
  // agree in the render that follows — exactly one fetch, at offset 0.
  const resetPage = React.useCallback(() => {
    setPagination((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  }, []);

  const setFilters = React.useCallback(
    (next: SessionsFilters, options?: SetSessionsFiltersOptions) => {
      latestFiltersRef.current = next;
      setDraftFilters(next);
      cancelPendingCommit();
      if (options?.immediate) {
        setCommittedFilters(next);
        resetPage();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setCommittedFilters(latestFiltersRef.current);
        resetPage();
      }, SEARCH_DEBOUNCE_MS);
    },
    [cancelPendingCommit, resetPage],
  );

  const setSort = React.useCallback(
    (next: SessionsSortState) => {
      // A sort click within the debounce window must not discard typed text:
      // flush the pending draft commit before applying the sort.
      if (timerRef.current !== null) {
        cancelPendingCommit();
        setCommittedFilters(latestFiltersRef.current);
      }
      setSortState(next);
      resetPage();
    },
    [cancelPendingCommit, resetPage],
  );

  const setPage = React.useCallback((pageIndex: number) => {
    setPagination((previous) =>
      previous.pageIndex === pageIndex ? previous : { ...previous, pageIndex },
    );
  }, []);

  const setPageSize = React.useCallback((pageSize: number) => {
    setPagination((previous) =>
      previous.pageSize === pageSize ? previous : { pageIndex: 0, pageSize },
    );
  }, []);

  // Cancel any pending debounce when the hook unmounts.
  React.useEffect(() => cancelPendingCommit, [cancelPendingCommit]);

  const query = React.useMemo(
    () => buildSessionsQuery(committedFilters, sort, pagination),
    [committedFilters, sort, pagination],
  );

  const statsQuery = React.useMemo(
    () => buildSessionsStatsQuery(committedFilters),
    [committedFilters],
  );

  return {
    filters,
    sort,
    pagination,
    query,
    statsQuery,
    setFilters,
    setSort,
    setPage,
    setPageSize,
  };
}
