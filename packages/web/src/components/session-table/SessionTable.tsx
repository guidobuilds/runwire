import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import type { Metric, SessionRollup, SessionSummary } from '../../api/types';
import type { FieldKey } from '../../lib/capabilities';
import { isInTray, toggleTray, usePrefs } from '../../state/prefs';
import { ConfidenceDot } from '../primitives/ConfidenceDot';
import { HarnessBadge } from '../primitives/HarnessBadge';
import { MetricCell } from '../primitives/MetricCell';
import { Table, Tbody, Td, Th, Thead, Tr } from '../primitives/Table';
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
 * Only sorting is delegated to TanStack Table v9; filtering stays in the pure
 * `applyFilters` (design.md §6) so those semantics are unit-testable with
 * no rendering at all.
 *
 * v9 registers features explicitly, and row-model factories travel with them
 * rather than being separate options. `columnMeta` is v9's per-table metadata
 * slot (no global declaration merging) and carries the right-alignment flag.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnMeta: {} as { numeric?: boolean },
});

const helper = createColumnHelper<typeof features, SessionRow>();

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
              className="flex size-4 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
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
        <HarnessBadge harnessId={row.harness} displayName={infoFor(row.harness)?.displayName} />
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

  const allRows = useMemo(
    () => toSessionRows(summaries, rollups, prefs),
    [summaries, rollups, prefs],
  );
  const options = useMemo(() => distinctOptions(allRows), [allRows]);
  const data = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);

  const suffix = prefs.inclusive ? '(incl.)' : '(excl.)';
  const columns = useMemo(
    () => buildColumns({ scope, suffix, harnesses, showTitles: prefs.showTitles }),
    [scope, suffix, harnesses, prefs.showTitles],
  );

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
  });

  return (
    <div className="space-y-3">
      <SessionFilters
        scope={scope}
        filters={filters}
        options={options}
        inclusive={prefs.inclusive}
        onChange={setFilters}
        matched={data.length}
        total={allRows.length}
      />

      <Table>
        <Thead>
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
              {row.getAllCells().map((tableCell) => (
                <Td key={tableCell.id} numeric={tableCell.column.columnDef.meta?.numeric}>
                  <tableApi.FlexRender cell={tableCell} />
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </Table>

      {data.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {allRows.length === 0 ? 'No sessions here yet.' : 'No sessions match these filters.'}
        </p>
      ) : null}
    </div>
  );
}
