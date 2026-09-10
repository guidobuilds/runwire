import { describe, expect, it } from 'vitest';
import {
  buildSessionsQuery,
  buildSessionsStatsQuery,
  DEFAULT_PAGE_SIZE,
  DURATION_MINUTES,
  EMPTY_FILTERS,
  PAGE_SIZES,
  SEARCH_DEBOUNCE_MS,
  type SessionsFilters,
  type SessionsSortState,
} from './sessions-table';

const pagination = { pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE };

function filters(overrides: Partial<SessionsFilters> = {}): SessionsFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

describe('sessions-table constants', () => {
  it('exposes the documented preset and pagination values', () => {
    expect(DURATION_MINUTES).toEqual({ '5m': 5, '30m': 30, '1h': 60 });
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
    expect(PAGE_SIZES).toEqual([10, 20, 30, 40, 50]);
    expect(DEFAULT_PAGE_SIZE).toBe(10);
  });
});

describe('buildSessionsQuery filters', () => {
  it('omits every unset filter and still sends pagination', () => {
    expect(buildSessionsQuery(EMPTY_FILTERS, null, pagination)).toEqual({
      limit: 10,
      offset: 0,
    });
  });

  it('sends trimmed non-empty q and omits whitespace-only q', () => {
    expect(buildSessionsQuery(filters({ q: '  auth  ' }), null, pagination).q).toBe('auth');
    expect(buildSessionsQuery(filters({ q: '   ' }), null, pagination).q).toBeUndefined();
    expect(buildSessionsQuery(filters({ q: '' }), null, pagination).q).toBeUndefined();
  });

  it.each([
    ['5m', 5],
    ['30m', 30],
    ['1h', 60],
  ] as const)('maps duration %s to durationMin %i and omits the empty preset', (duration, min) => {
    expect(buildSessionsQuery(filters({ duration }), null, pagination).durationMin).toBe(min);
    expect(buildSessionsQuery(EMPTY_FILTERS, null, pagination).durationMin).toBeUndefined();
  });

  it("maps cost 'gt0' to costOnly true and omits the empty preset", () => {
    expect(buildSessionsQuery(filters({ cost: 'gt0' }), null, pagination).costOnly).toBe(true);
    expect(buildSessionsQuery(EMPTY_FILTERS, null, pagination).costOnly).toBeUndefined();
  });

  it('joins harnessIds into a comma-separated harness and omits an empty list', () => {
    expect(
      buildSessionsQuery(filters({ harnessIds: ['claude-code', 'opencode'] }), null, pagination)
        .harness,
    ).toBe('claude-code,opencode');
    expect(buildSessionsQuery(EMPTY_FILTERS, null, pagination).harness).toBeUndefined();
  });
});

describe('buildSessionsQuery sort', () => {
  it('omits sort when null', () => {
    expect(buildSessionsQuery(EMPTY_FILTERS, null, pagination).sort).toBeUndefined();
  });

  it.each([
    [{ id: 'name', desc: false }, 'name'],
    [{ id: 'name', desc: true }, '-name'],
    [{ id: 'startedAt', desc: false }, 'startedAt'],
    [{ id: 'cost', desc: true }, '-cost'],
  ] as const)('serializes %o as %s', (sort: SessionsSortState, expected: string) => {
    expect(buildSessionsQuery(EMPTY_FILTERS, sort, pagination).sort).toBe(expected);
  });
});

describe('buildSessionsQuery pagination', () => {
  it('maps pageIndex/pageSize to limit/offset', () => {
    expect(buildSessionsQuery(EMPTY_FILTERS, null, { pageIndex: 0, pageSize: 10 })).toMatchObject({
      limit: 10,
      offset: 0,
    });
    expect(buildSessionsQuery(EMPTY_FILTERS, null, { pageIndex: 3, pageSize: 20 })).toMatchObject({
      limit: 20,
      offset: 60,
    });
    expect(buildSessionsQuery(EMPTY_FILTERS, null, { pageIndex: 2, pageSize: 50 })).toMatchObject({
      limit: 50,
      offset: 100,
    });
  });
});

describe('buildSessionsStatsQuery', () => {
  it('maps only committed filters and never sort/pagination', () => {
    expect(
      buildSessionsStatsQuery(
        filters({ q: '  auth  ', duration: '30m', cost: 'gt0', harnessIds: ['a', 'b'] }),
      ),
    ).toEqual({ q: 'auth', durationMin: 30, costOnly: true, harness: 'a,b' });
  });

  it('an empty filter set yields an empty query (no limit/offset/sort keys)', () => {
    expect(buildSessionsStatsQuery(EMPTY_FILTERS)).toEqual({});
  });

  it('agrees with buildSessionsQuery on every filter field', () => {
    const f = filters({ q: 'refactor', duration: '5m', cost: 'gt0', harnessIds: ['claude-code'] });
    const {
      limit: _limit,
      offset: _offset,
      sort: _sort,
      ...listFilters
    } = buildSessionsQuery(f, { id: 'name', desc: true }, pagination);
    expect(buildSessionsStatsQuery(f)).toEqual(listFilters);
  });
});
