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
  immediate?: boolean;
};

export type UseSessionsTableStateResult = {
  filters: SessionsFilters;
  sort: SessionsSortState;
  pagination: SessionsTablePagination;
  query: ReturnType<typeof buildSessionsQuery>;
  statsQuery: ReturnType<typeof buildSessionsStatsQuery>;
  setFilters: (next: SessionsFilters, options?: SetSessionsFiltersOptions) => void;
  setSort: (next: SessionsSortState) => void;
  setPage: (pageIndex: number) => void;
  setPageSize: (pageSize: number) => void;
};

export function useSessionsTableState(): UseSessionsTableStateResult {
  const [filters, setDraftFilters] = React.useState<SessionsFilters>(EMPTY_FILTERS);
  const [committedFilters, setCommittedFilters] = React.useState<SessionsFilters>(EMPTY_FILTERS);
  const [sort, setSortState] = React.useState<SessionsSortState>(null);
  const [pagination, setPagination] = React.useState<SessionsTablePagination>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const latestFiltersRef = React.useRef(filters);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingCommit = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

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
