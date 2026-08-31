import type { SessionRow } from './model';

export type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom';
export type SubagentsFilter = 'any' | 'with' | 'without';

/** `from`/`to` are `YYYY-MM-DD` (what `<input type="date">` produces). */
export type DateFilter = {
  preset: DatePreset;
  from?: string;
  to?: string;
};

/**
 * Client-side filters state (design.md §6). Every array means "no narrowing" when
 * empty, so a freshly cleared multi-select and "everything selected" behave the
 * same way.
 */
export type SessionFilters = {
  harness: string[];
  project: string[];
  model: string[];
  mode: string[];
  date: DateFilter;
  subagents: SubagentsFilter;
  search: string;
};

export function emptyFilters(): SessionFilters {
  return {
    harness: [],
    project: [],
    model: [],
    mode: [],
    date: { preset: 'all' },
    subagents: 'any',
    search: '',
  };
}

export type FilterOption = { value: string; label: string };

export type FilterOptionSets = {
  harness: FilterOption[];
  project: FilterOption[];
  model: FilterOption[];
  mode: FilterOption[];
};

const DAY_MS = 86_400_000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * `YYYY-MM-DD` at local midnight. Deliberately not `Date.parse(dateOnly)`,
 * which ECMA-262 defines as UTC — that would shift the boundary by the local
 * offset and drop or admit a whole evening of sessions.
 */
function localDayStart(day: string): number {
  return new Date(`${day}T00:00:00.000`).getTime();
}

/** Same day at 23:59:59.999 local, so a custom range is inclusive at both ends. */
function localDayEnd(day: string): number {
  return new Date(`${day}T23:59:59.999`).getTime();
}

function startedAtMs(row: SessionRow): number | undefined {
  const iso = row.startedAt?.value;
  if (iso === undefined) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * A row without a usable `startedAt` cannot satisfy any date window, so every
 * preset except `all` excludes it. That is deliberate: silently keeping
 * undated rows would make "today" quietly mean "today, plus everything we
 * could not date".
 */
function matchesDate(row: SessionRow, dates: DateFilter, now: number): boolean {
  if (dates.preset === 'all') return true;

  const started = startedAtMs(row);
  if (started === undefined) return false;

  if (dates.preset === 'custom') {
    if (dates.from !== undefined && dates.from !== '') {
      const from = localDayStart(dates.from);
      if (Number.isFinite(from) && started < from) return false;
    }
    if (dates.to !== undefined && dates.to !== '') {
      const to = localDayEnd(dates.to);
      if (Number.isFinite(to) && started > to) return false;
    }
    return true;
  }

  if (dates.preset === 'today') return started >= startOfLocalDay(now);
  if (dates.preset === '7d') return started >= now - 7 * DAY_MS;
  return started >= now - 30 * DAY_MS;
}

function matchesSearch(row: SessionRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return row.label.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle);
}

function matchesList(selected: readonly string[], value: string | undefined): boolean {
  if (selected.length === 0) return true;
  return value !== undefined && selected.includes(value);
}

/**
 * Pure client-side filtering. `now` is injected so date presets are
 * deterministic in tests (design.md §6); it defaults to the wall clock.
 */
export function applyFilters(
  rows: readonly SessionRow[],
  filters: SessionFilters,
  now: Date | number | string = Date.now(),
): SessionRow[] {
  const nowMs = new Date(now).getTime();
  return rows.filter((row) => {
    if (!matchesList(filters.harness, row.harness)) return false;
    if (!matchesList(filters.project, row.projectKey)) return false;
    if (!matchesList(filters.model, row.model?.value)) return false;
    if (!matchesList(filters.mode, row.mode?.value)) return false;
    if (filters.subagents === 'with' && !row.hasSubagents) return false;
    if (filters.subagents === 'without' && row.hasSubagents) return false;
    if (!matchesDate(row, filters.date, nowMs)) return false;
    return matchesSearch(row, filters.search);
  });
}

function collect(
  rows: readonly SessionRow[],
  pick: (row: SessionRow) => { value: string; label: string } | undefined,
): FilterOption[] {
  const byValue = new Map<string, string>();
  for (const row of rows) {
    const option = pick(row);
    if (option === undefined || option.value === '') continue;
    if (!byValue.has(option.value)) byValue.set(option.value, option.label);
  }
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Option lists for the toolbar selects — the distinct values actually present
 * in the current rows, so no choice here can ever return nothing.
 */
export function distinctOptions(rows: readonly SessionRow[]): FilterOptionSets {
  return {
    harness: collect(rows, (row) => ({ value: row.harness, label: row.harness })),
    project: collect(rows, (row) => ({ value: row.projectKey, label: row.projectName })),
    model: collect(rows, (row) =>
      row.model === undefined ? undefined : { value: row.model.value, label: row.model.value },
    ),
    mode: collect(rows, (row) =>
      row.mode === undefined ? undefined : { value: row.mode.value, label: row.mode.value },
    ),
  };
}
