import {
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  type ReactTable,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Metric, SessionRollup, SessionSummary } from '../../api/types';
import type { FieldKey } from '../../lib/capabilities';
import { isInTray, toggleTray, usePrefs } from '../../state/prefs';
import { ConfidenceDot } from '../primitives/ConfidenceDot';
import { HarnessLogo } from '../primitives/HarnessLogo';
import { MetricCell } from '../primitives/MetricCell';
import { Table, Tbody, Td, Th, Thead, Tr } from '../primitives/Table';
import { Button } from '../ui/button';
import {
  applyFilters,
  distinctOptions,
  emptyFilters,
  type SessionFilters as SessionFilterState,
} from './filters';
import type { HarnessDirectory, SessionRow } from './model';
import { toSessionRows } from './model';
import { SessionFilters } from './SessionFilters';

/**
 * Only filtering stays outside TanStack Table, in the pure `applyFilters`
 * (design.md §6) so those semantics are unit-testable with no rendering at
 * all -- the filtered array is what the table receives as `data`. Sorting
 * and pagination (D45) are both real registered v9 features, not parallel
 * hand-rolled logic: `getRowModel()` resolves through the sorted model to
 * the paginated one, so what's on screen is always what the feature APIs
 * computed.
 *
 * v9 registers features explicitly, and row-model factories travel with them
 * rather than being separate options. `columnMeta` is v9's per-table metadata
 * slot (no global declaration merging) and carries the right-alignment flag.
 *
 * `columnVisibilityFeature` is registered per D45's literal feature list (the
 * same set shadcn's own `data-table` docs use) and `row.getVisibleCells()`
 * below is visibility-aware, but this build ships no column-hiding control --
 * no design doc or this task's own verification list asks for one, so adding
 * a new toolbar surface for it would be scope beyond the approved change.
 * Wiring stays real (not inert): a future toggle needs no further table
 * rework, only a control that calls `column.toggleVisibility()`.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  columnVisibilityFeature,
  columnMeta: {} as { numeric?: boolean },
});

const helper = createColumnHelper<typeof features, SessionRow>();

/**
 * No design doc pins a default (checked docs/DECISIONS.md and this slug's
 * design.md -- neither mentions page size); 25 is the documented choice for
 * this build, matching a session table row's compactness against the
 * "low thousands" of real sessions D-decisions describes.
 */
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
/** The `<option>` value TanStack Table's own `pageSize: Infinity` convention maps to. */
const ALL_ROWS_OPTION = 'all';

function pageSizeOptionValue(size: number): string {
  return Number.isFinite(size) ? String(size) : ALL_ROWS_OPTION;
}

function parsePageSizeOption(value: string): number {
  return value === ALL_ROWS_OPTION ? Number.POSITIVE_INFINITY : Number(value);
}

export type SessionTableScope = 'project' | 'harness' | 'all';

export type SessionTableProps = {
  scope: SessionTableScope;
  summaries: readonly SessionSummary[];
  rollups: Readonly<Record<string, SessionRollup>>;
  /**
   * Adapter facts for every harness in `summaries`, resolved ONCE by the caller
   * through `useHarnessDirectory()` and passed down (design.md §5/§6).
   *
   * Required but explicitly nullable, mirroring `MetricCell.capabilities`:
   * `undefined` means status has not resolved yet and flows straight through to
   * each cell, which reads it as `missing`. This prop is the reason the session
   * view opens ZERO `['status']` query observers — `ConnectedMetricCell` would
   * cost 2 per cell (~4400 across a 370-row view), which is exactly the cost
   * the f3 amendment removed. f5-t4 pins that with an observer-count assertion.
   */
  harnesses: HarnessDirectory | undefined;
  /**
   * Row activation. The routes pass a router `navigate` to `/sessions/$id`;
   * keeping it a callback is what lets this component render with no router
   * context and no query client of its own.
   */
  onOpen?: (id: string) => void;
};

function ariaSort(direction: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return 'none';
}

type ColumnBuildOptions = {
  scope: SessionTableScope;
  suffix: string;
  harnesses: HarnessDirectory | undefined;
  /** Whether the Session column's id subtext should render (design.md §5). */
  showTitles: boolean;
};

function buildColumns({ scope, suffix, harnesses, showTitles }: ColumnBuildOptions) {
  /** Hoisted lookup: a plain object read per cell, never a query subscription. */
  const infoFor = (harness: string) => (harnesses ? harnesses[harness] : undefined);

  const cell = (
    row: SessionRow,
    field: FieldKey,
    value: Metric<unknown> | undefined,
    align: 'left' | 'right',
  ) => {
    const info = infoFor(row.harness);
    return (
      <MetricCell
        metric={value}
        field={field}
        harness={row.harness}
        capabilities={info?.capabilities}
        displayName={info?.displayName}
        align={align}
      />
    );
  };

  const select = helper.display({
    id: 'select',
    // Never hideable: this is the compare-tray control, not a data column.
    enableHiding: false,
    header: () => <span className="sr-only">Compare</span>,
    cell: (info) => {
      const row = info.row.original;
      return (
        <input
          type="checkbox"
          className="cursor-pointer"
          aria-label={`Compare ${row.label}`}
          checked={isInTray(row.id)}
          onChange={() => {
            toggleTray(row.id);
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
      );
    },
  });

  const label = helper.accessor((row) => row.label, {
    id: 'label',
    header: 'Session',
    // Never hideable: the row's own identity, not an optional data column.
    enableHiding: false,
    sortFn: sortFn_text,
    sortUndefined: 'last',
    cell: (info) => {
      const row = info.row.original;
      // Titles off: `label` already equals `shortId`, so the subtext line
      // would just repeat it -- only show the id subtext when titles are on
      // (design.md §5's "title + id + confidence subtext").
      const showSubtext = showTitles || row.confidence !== undefined;
      return (
        <span className="flex items-start gap-1.5">
          {row.hasDiagnostics ? (
            <span
              role="img"
              aria-label="Has data-quality notes"
              title="This session has data-quality notes"
              className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            >
              ⚠
            </span>
          ) : null}
          <span className="flex flex-col">
            <span className="font-medium">{row.label}</span>
            {showSubtext ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {showTitles ? <span className="font-mono">{row.shortId}</span> : null}
                {row.confidence !== undefined ? (
                  <ConfidenceDot level={row.confidence} decorative />
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
      );
    },
  });

  const project = helper.accessor((row) => row.projectName, {
    id: 'project',
    header: 'Project',
    sortFn: sortFn_text,
    sortUndefined: 'last',
    cell: (info) => {
      const row = info.row.original;
      const letter = (row.projectName.trim().charAt(0) || '?').toUpperCase();
      return (
        <span className="flex flex-col">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="flex size-4 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
            >
              {letter}
            </span>
            {row.projectName}
          </span>
          {row.projectWorktree ? (
            <span className="pl-5 text-xs text-muted-foreground">{row.projectWorktree}</span>
          ) : null}
        </span>
      );
    },
  });

  const harness = helper.accessor((row) => row.harness, {
    id: 'harness',
    header: 'Harness',
    sortFn: sortFn_text,
    sortUndefined: 'last',
    cell: (info) => {
      const row = info.row.original;
      return (
        <HarnessLogo
          harnessId={row.harness}
          displayName={infoFor(row.harness)?.displayName}
          size="sm"
        />
      );
    },
  });

  const model = helper.accessor((row) => row.model?.value, {
    id: 'model',
    header: 'Model',
    sortFn: sortFn_text,
    sortUndefined: 'last',
    cell: (info) => (
      <span className="font-mono">
        {cell(info.row.original, 'model', info.row.original.model, 'left')}
      </span>
    ),
  });

  const mode = helper.accessor((row) => row.mode?.value, {
    id: 'mode',
    header: 'Mode',
    sortFn: sortFn_text,
    sortUndefined: 'last',
    cell: (info) => (
      <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs">
        {cell(info.row.original, 'mode', info.row.original.mode, 'left')}
      </span>
    ),
  });

  const startedAt = helper.accessor((row) => row.startedAt?.value, {
    id: 'startedAt',
    header: 'Started',
    // ISO-8601 UTC strings order correctly as plain strings (design.md §6).
    sortFn: sortFn_basic,
    sortUndefined: 'last',
    cell: (info) => cell(info.row.original, 'startedAt', info.row.original.startedAt, 'left'),
  });

  const duration = helper.accessor((row) => row.durationMs?.value, {
    id: 'durationMs',
    header: 'Duration',
    sortFn: sortFn_basic,
    sortUndefined: 'last',
    meta: { numeric: true },
    cell: (info) => cell(info.row.original, 'durationMs', info.row.original.durationMs, 'right'),
  });

  const uncachedInput = helper.accessor((row) => row.usage.uncachedInput?.value, {
    id: 'uncachedInput',
    header: `Input ${suffix}`,
    sortFn: sortFn_basic,
    sortUndefined: 'last',
    meta: { numeric: true },
    cell: (info) =>
      cell(info.row.original, 'uncachedInput', info.row.original.usage.uncachedInput, 'right'),
  });

  const cachedInput = helper.accessor((row) => row.usage.cachedInput?.value, {
    id: 'cachedInput',
    header: `Cached ${suffix}`,
    sortFn: sortFn_basic,
    sortUndefined: 'last',
    meta: { numeric: true },
    cell: (info) =>
      cell(info.row.original, 'cachedInput', info.row.original.usage.cachedInput, 'right'),
  });

  const output = helper.accessor((row) => row.usage.output?.value, {
    id: 'output',
    header: `Output ${suffix}`,
    sortFn: sortFn_basic,
    sortUndefined: 'last',
    meta: { numeric: true },
    cell: (info) => cell(info.row.original, 'output', info.row.original.usage.output, 'right'),
  });

  const subagents = helper.accessor((row) => row.subagents?.value, {
    id: 'subagents',
    header: 'Subagents',
    sortFn: sortFn_basic,
    sortUndefined: 'last',
    meta: { numeric: true },
    cell: (info) => cell(info.row.original, 'subagents', info.row.original.subagents, 'right'),
  });

  // `helper.columns` keeps each column's own value type while widening the list
  // to what `useTable` accepts; the Project column is fixed context in
  // 'project' scope (every row already belongs to it) but a real column in
  // 'harness' scope and in the unscoped 'all' landing scope (design.md §5).
  return scope === 'project'
    ? helper.columns([
        select,
        label,
        harness,
        model,
        mode,
        startedAt,
        duration,
        uncachedInput,
        cachedInput,
        output,
        subagents,
      ])
    : helper.columns([
        select,
        label,
        project,
        harness,
        model,
        mode,
        startedAt,
        duration,
        uncachedInput,
        cachedInput,
        output,
        subagents,
      ]);
}

/**
 * The one session view behind `/projects/$key`, `/harnesses/$id`, and the
 * unscoped Sessions landing at `/` (design.md §2's reuse contract: one
 * component, scope arrives as a prop, never a second implementation).
 *
 * Renders from props only — no router, no query client — so the whole view
 * costs zero `['status']` query observers however many rows it draws.
 */
export function SessionTable({ scope, summaries, rollups, harnesses, onOpen }: SessionTableProps) {
  const prefs = usePrefs();
  const [filters, setFilters] = useState<SessionFilterState>(emptyFilters);

  // Narrowed to the two fields `toSessionRow` actually reads (`SessionRowPrefs`
  // in model.ts), not the whole `usePrefs()` snapshot: `prefs.compareTray`
  // changes on every tray toggle (state/prefs.ts's `commit()` allocates a new
  // snapshot object per mutation), and depending on the whole object here
  // would give `data` below a new reference on every tray click, wrongly
  // tripping the page-reset-on-data-change logic further down even though the
  // row set never changed. Building the narrowed `SessionRowPrefs` object
  // inside the callback (member-accessing `prefs.inclusive`/`prefs.showTitles`
  // rather than closing over `prefs` itself) is also what keeps this
  // exhaustive-deps clean -- the memo genuinely only reads these two fields,
  // and the dependency array says so precisely.
  const allRows = useMemo(
    () =>
      toSessionRows(summaries, rollups, {
        inclusive: prefs.inclusive,
        showTitles: prefs.showTitles,
      }),
    [summaries, rollups, prefs.inclusive, prefs.showTitles],
  );
  const options = useMemo(() => distinctOptions(allRows), [allRows]);
  const data = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);
  // Same lookup `routes/harnesses.$id.tsx` uses: a plain object read against
  // the already-resolved `harnesses` prop, not a query -- the harness combobox
  // needs a visible name per option/trigger chip (unlike `HarnessLogo`'s own
  // `displayName`, which is title/aria-label only).
  const displayNameFor = (harnessId: string) => harnesses?.[harnessId]?.displayName ?? harnessId;

  const suffix = prefs.inclusive ? '(incl.)' : '(excl.)';
  const columns = useMemo(
    () => buildColumns({ scope, suffix, harnesses, showTitles: prefs.showTitles }),
    [scope, suffix, harnesses, prefs.showTitles],
  );

  // Pagination is owned here as plain React state (mirroring `filters`
  // above), not left to `rowPaginationFeature`'s uncontrolled internal atom.
  // That is what makes the render-phase reset below safe and synchronous:
  // it calls React's own `setPagination`, not an external store mutation
  // mid-render. `rowPaginationFeature`'s own `autoResetPageIndex` resets on
  // the table's *internal* row-model recomputation, which this app's tests
  // showed does not reliably land inside the same React commit as a `data`
  // prop change (confirmed empirically, not assumed: uncontrolled, narrowing
  // a filter from page 2 left the view on page 2 of the new, smaller page
  // count).
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE });

  // React's documented pattern for "adjust state when a prop changes"
  // without an Effect: comparing against the previous `data` reference
  // during render and resetting to page 1 makes "a narrower filter goes
  // back to page 1" happen in the same render as the filter change, not one
  // tick later.
  const [pageResetFor, setPageResetFor] = useState(data);
  if (pageResetFor !== data) {
    setPageResetFor(data);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  const tableApi = useTable({
    features,
    columns,
    data,
    getRowId: (row) => row.id,
    // Explicit: TanStack's default sniffs the first rows' values and starts a
    // numeric column descending, so the direction of a first click would
    // otherwise depend on the data.
    sortDescFirst: false,
    initialState: { sorting: [{ id: 'startedAt', desc: true }] },
    state: { pagination },
    onPaginationChange: setPagination,
  });

  return (
    // `flex h-full min-h-0 flex-col`: the caller (`routes/index.tsx`) gives
    // this a definite height to fill (fix-appshell-height-bounding). Filters
    // and pagination are `shrink-0` (see `SessionFilters`/`DataTablePagination`
    // below) so they always stay visible; the `<Table>` region is the only
    // `flex-1 min-h-0` piece, so it is the one that grows/shrinks and
    // scrolls internally.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <SessionFilters
        scope={scope}
        filters={filters}
        options={options}
        displayNameFor={displayNameFor}
        onChange={setFilters}
        matched={data.length}
        total={allRows.length}
      />

      {/*
       * `flex-1 min-h-[12rem] overflow-auto` (fix-appshell-height-bounding,
       * amended by fix-narrow-viewport-table-collapse): AppShell.tsx now
       * establishes a real bounded flex chain from the viewport down to this
       * component's own root (`h-dvh` shell -> `app-content` `flex-1
       * min-h-0` -> this file's root `h-full min-h-0 flex-col`), so this
       * region can size against real remaining space instead of guessing
       * with `calc(100vh-...)` viewport units (the prior fix, which under-
       * or over-counted the real chrome above it). `flex-1` still lets it
       * grow to fill available space in the common case; `min-h-[12rem]`
       * (header `h-10` + ~3-4 data rows) is a hard floor so a tall
       * `SessionFilters` bar (wraps to multiple lines at narrow widths, see
       * `bounded-flex-shell-filters-bar-wrap-collapses-table` in
       * `.forge/lessons.md`) can no longer squeeze this region to 0 visible
       * rows -- below that floor, `app-content`'s own `overflow-y-auto`
       * fallback (AppShell.tsx) takes over with a small amount of scroll
       * instead. Passed as `containerClassName` straight into `Table`'s own
       * scroll container (not a wrapper div around `Table`) so exactly one
       * element owns both `overflow-x` and `overflow-y` -- see `Table`'s doc
       * comment and `.forge/lessons.md`'s `nested-overflow-auto-breaks-
       * sticky-th` for why a second ancestor `overflow-y-auto` div breaks
       * `<Thead sticky>`.
       */}
      <Table containerClassName="flex-1 min-h-[12rem] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        <Thead sticky>
          {tableApi.getHeaderGroups().map((headerGroup) => (
            <Tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <Th
                  key={header.id}
                  sortable={header.column.getCanSort()}
                  sortDirection={ariaSort(header.column.getIsSorted())}
                  onSort={() => {
                    header.column.toggleSorting();
                  }}
                >
                  <tableApi.FlexRender header={header} />
                </Th>
              ))}
            </Tr>
          ))}
        </Thead>
        <Tbody>
          {tableApi.getRowModel().rows.map((row) => (
            <Tr
              key={row.id}
              tabIndex={0}
              className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
              onClick={() => onOpen?.(row.original.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onOpen?.(row.original.id);
                }
              }}
            >
              {row.getVisibleCells().map((tableCell) => (
                <Td key={tableCell.id} numeric={tableCell.column.columnDef.meta?.numeric}>
                  <tableApi.FlexRender cell={tableCell} />
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </Table>

      {data.length === 0 ? (
        <p className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
          {allRows.length === 0 ? 'No sessions here yet.' : 'No sessions match these filters.'}
        </p>
      ) : (
        <DataTablePagination table={tableApi} />
      )}
    </div>
  );
}

const PAGE_SIZE_SELECT_CLASS =
  'rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100';

/**
 * Real pagination (D45): rows-per-page, a page indicator, and prev/next/
 * first/last navigation, all driven by `rowPaginationFeature`'s own state and
 * getters -- nothing here recomputes a page slice by hand. `table.state` is
 * `useTable`'s reactive snapshot of every registered state slice (no
 * selector was passed to `useTable`, so it always includes `pagination`),
 * matching the getting-started pattern shadcn's `data-table` docs use.
 */
function DataTablePagination({ table }: { table: ReactTable<typeof features, SessionRow> }) {
  const { pageIndex, pageSize } = table.state.pagination;
  const pageCount = table.getPageCount();
  const rowCount = table.getRowCount();

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-300">
      <label className="flex items-center gap-2" htmlFor="session-table-page-size">
        Rows per page
        <select
          id="session-table-page-size"
          className={PAGE_SIZE_SELECT_CLASS}
          value={pageSizeOptionValue(pageSize)}
          onChange={(event) => {
            table.setPageSize(parsePageSizeOption(event.target.value));
          }}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
          <option value={ALL_ROWS_OPTION}>All</option>
        </select>
      </label>

      <div className="flex items-center gap-3">
        <span>
          Page {rowCount === 0 ? 0 : pageIndex + 1} of {pageCount}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => {
              table.firstPage();
            }}
          >
            <ChevronsLeftIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => {
              table.previousPage();
            }}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => {
              table.nextPage();
            }}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={!table.getCanLastPage()}
            onClick={() => {
              table.lastPage();
            }}
          >
            <ChevronsRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
