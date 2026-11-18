import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTERS, SEARCH_DEBOUNCE_MS, type SessionsFilters } from '@/lib/sessions-table';
import { useSessionsTableState } from './use-sessions-table-state';

function filters(overrides: Partial<SessionsFilters> = {}): SessionsFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

type RecordedRender = {
  q: string | undefined;
  offset: number | undefined;
  pageIndex: number;
};

function trackRenders() {
  const renders: RecordedRender[] = [];
  const { result } = renderHook(() => {
    const state = useSessionsTableState();
    renders.push({
      q: state.query.q,
      offset: state.query.offset,
      pageIndex: state.pagination.pageIndex,
    });
    return state;
  });
  return { result, renders };
}

describe('useSessionsTableState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the draft immediately but commits the query only after the debounce', () => {
    const { result } = renderHook(() => useSessionsTableState());

    act(() => result.current.setFilters(filters({ q: 'auth' })));

    expect(result.current.filters.q).toBe('auth');
    expect(result.current.query.q).toBeUndefined();

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(result.current.query.q).toBeUndefined();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.query.q).toBe('auth');
  });

  it('an immediate commit cancels the pending text timer and commits once', () => {
    const { result } = renderHook(() => useSessionsTableState());

    act(() => result.current.setFilters(filters({ q: 'auth' })));
    expect(vi.getTimerCount()).toBe(1);

    act(() =>
      result.current.setFilters(filters({ q: 'auth', duration: '30m' }), { immediate: true }),
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.query).toMatchObject({ q: 'auth', durationMin: 30 });

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(result.current.query).toMatchObject({ q: 'auth', durationMin: 30 });
  });

  it('a sort change within the debounce window flushes the pending text commit', () => {
    const { result } = renderHook(() => useSessionsTableState());

    act(() => result.current.setFilters(filters({ q: 'auth' })));
    expect(result.current.query.q).toBeUndefined();

    act(() => result.current.setSort({ id: 'name', desc: false }));

    expect(result.current.query.q).toBe('auth');
    expect(result.current.query.sort).toBe('name');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an immediate filter commit from page 2 resets to offset 0 in the same render', () => {
    const { result, renders } = trackRenders();

    act(() => result.current.setPage(2));
    expect(result.current.pagination.pageIndex).toBe(2);
    expect(result.current.query.offset).toBe(20);

    renders.length = 0;
    act(() => result.current.setFilters(filters({ q: 'auth' }), { immediate: true }));

    expect(renders.some((render) => render.q === 'auth' && render.offset !== 0)).toBe(false);
    expect(renders.at(-1)).toMatchObject({ q: 'auth', offset: 0, pageIndex: 0 });
    expect(result.current.query).toMatchObject({ q: 'auth', offset: 0 });
  });

  it('a debounced text commit from page 2 resets to offset 0 in the same render', () => {
    const { result, renders } = trackRenders();

    act(() => result.current.setPage(2));
    expect(result.current.query.offset).toBe(20);

    act(() => result.current.setFilters(filters({ q: 'auth' })));
    expect(result.current.query.offset).toBe(20);

    renders.length = 0;
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    expect(renders.some((render) => render.q === 'auth' && render.offset !== 0)).toBe(false);
    expect(renders.at(-1)).toMatchObject({ q: 'auth', offset: 0, pageIndex: 0 });
    expect(result.current.query).toMatchObject({ q: 'auth', offset: 0 });
  });

  it('a sort change from page 2 resets to offset 0 in the same render', () => {
    const { result, renders } = trackRenders();

    act(() => result.current.setPage(2));
    expect(result.current.query.offset).toBe(20);

    renders.length = 0;
    act(() => result.current.setSort({ id: 'name', desc: false }));

    expect(renders.every((render) => render.offset === 0)).toBe(true);
    expect(renders.at(-1)).toMatchObject({ offset: 0, pageIndex: 0 });
    expect(result.current.query).toMatchObject({ sort: 'name', offset: 0 });
  });

  it('resets to page 0 when committed filters change, but not for setPage alone', () => {
    const { result } = renderHook(() => useSessionsTableState());

    act(() => result.current.setPage(2));
    expect(result.current.pagination.pageIndex).toBe(2);
    expect(result.current.query.offset).toBe(2 * result.current.pagination.pageSize);

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(result.current.pagination.pageIndex).toBe(2);

    act(() => result.current.setFilters(filters({ q: 'auth' }), { immediate: true }));
    expect(result.current.pagination.pageIndex).toBe(0);
    expect(result.current.query.offset).toBe(0);
  });

  it('setPageSize changes the page size and never flushes a pending text commit', () => {
    const { result } = renderHook(() => useSessionsTableState());

    act(() => result.current.setFilters(filters({ q: 'auth' })));
    expect(result.current.query.q).toBeUndefined();

    act(() => result.current.setPageSize(20));

    expect(vi.getTimerCount()).toBe(1);
    expect(result.current.query.q).toBeUndefined();
    expect(result.current.query.limit).toBe(20);
  });
});
