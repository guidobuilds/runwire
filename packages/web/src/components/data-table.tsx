import type { ApiSessionSummary, ApiTokenTotals } from '@runwire/core';
import { Link } from '@tanstack/react-router';
import {
  type ColumnVisibilityState,
  columnVisibilityFeature,
  createColumnHelper,
  FlexRender,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronsUpDownIcon,
  CircleDollarSignIcon,
  ClockIcon,
  Columns3Icon,
  ListFilterIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';
import { HarnessIcon, HarnessIdentity } from '@/components/harness-identity';
import { RelativeDate } from '@/components/relative-date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DEFAULT_SORT,
  PAGE_SIZES,
  type SessionsFilters,
  type SessionsSortState,
  type SortField,
} from '@/lib/sessions-table';
import { cn } from '@/lib/utils';
import { useHarnesses } from '@/queries/harnesses';

// v9: declare the features this table uses — anything you don't register is
// tree-shaken out of the bundle. Sorting/filtering/pagination now live in the
// server query, so only the client-only column-visibility and row-selection
// features remain.
const features = tableFeatures({
  columnVisibilityFeature,
  rowSelectionFeature,
});

const columnHelper = createColumnHelper<typeof features, ApiSessionSummary>();

type DurationPreset = SessionsFilters['duration'];
type CostPreset = SessionsFilters['cost'];

const DURATION_OPTIONS: { value: DurationPreset; label: string }[] = [
  { value: '', label: 'All' },
  { value: '5m', label: '≥ 5m' },
  { value: '30m', label: '≥ 30m' },
  { value: '1h', label: '≥ 1h' },
];

const COST_OPTIONS: { value: CostPreset; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'gt0', label: 'Cost > $0' },
];

function durationLabel(value: DurationPreset): string {
  return DURATION_OPTIONS.find((option) => option.value === value)?.label ?? 'All';
}

function costLabel(value: CostPreset): string {
  return COST_OPTIONS.find((option) => option.value === value)?.label ?? 'All';
}

/** Human labels for the column-visibility menu, keyed by column id. Keeps the
 * menu readable instead of leaking raw DTO field ids (`startedAt`, …). */
const COLUMN_LABELS: Record<string, string> = {
  name: 'Name',
  harness: 'Harness',
  startedAt: 'Started At',
  lastActivity: 'Last Activity',
  duration: 'Duration',
  tokens: 'Tokens',
  cost: 'Cost',
  subagentChildCount: 'Direct',
  subagentDescendantCount: 'Full tree',
};

/** The sorted state to display for a column (server-owned sort). With no
 * explicit sort the server orders by `DEFAULT_SORT`, so that column shows the
 * active direction instead of an unsorted chevron. */
function toSortedState(sort: SessionsSortState, id: SortField): false | 'asc' | 'desc' {
  if (!sort) {
    if (DEFAULT_SORT.id !== id) return false;
    return DEFAULT_SORT.desc ? 'desc' : 'asc';
  }
  if (sort.id !== id) return false;
  return sort.desc ? 'desc' : 'asc';
}

/** Clicking a header cycles its sort: asc -> desc -> unsorted. */
function cycleSort(sort: SessionsSortState, id: SortField): SessionsSortState {
  if (!sort || sort.id !== id) return { id, desc: false };
  if (!sort.desc) return { id, desc: true };
  return null;
}

function sumTokens(totals: ApiTokenTotals): number {
  // Total Tokens = prompt input + output. `reasoningOutput` is a separate
  // breakdown and is never added here (it is already counted inside `output`
  // for harnesses that report it that way, so adding it double-counts).
  return totals.uncachedInput + totals.cachedInput + totals.cacheWrite + totals.output;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

/** A plain, server-controlled sortable header button. */
function SortableHeader({
  label,
  align = 'left',
  sorted,
  onToggle,
}: {
  label: string;
  align?: 'left' | 'right';
  sorted: false | 'asc' | 'desc';
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'group/sort -mx-2 inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-foreground transition-colors select-none hover:bg-accent/60',
        align === 'right' && 'w-full justify-end',
      )}
    >
      <span>{label}</span>
      {sorted === 'asc' ? (
        <ArrowUpIcon className="size-3.5 text-foreground" />
      ) : sorted === 'desc' ? (
        <ArrowDownIcon className="size-3.5 text-foreground" />
      ) : (
        <ChevronsUpDownIcon className="size-3.5 text-muted-foreground opacity-0 group-hover/sort:opacity-100" />
      )}
    </button>
  );
}

export function DataTable({
  data,
  total,
  isFetching,
  filters,
  sort,
  pagination,
  onFiltersChange,
  onSortChange,
  onPageChange,
  onPageSizeChange,
}: {
  data: ApiSessionSummary[];
  total: number;
  isFetching: boolean;
  filters: SessionsFilters;
  sort: SessionsSortState;
  pagination: { pageIndex: number; pageSize: number };
  onFiltersChange: (next: SessionsFilters, options?: { immediate?: boolean }) => void;
  onSortChange: (next: SessionsSortState) => void;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  // Per-column date format, owned by the mounted table so it survives refetch
  // rerenders. Started At and Last Activity toggle independently; nothing is
  // persisted (no storage or global preferences).
  const [absoluteDateColumns, setAbsoluteDateColumns] = React.useState({
    startedAt: false,
    lastActivity: false,
  });
  // Read by the memoized column cells so the `columns` identity stays stable
  // across a toggle. Re-creating the columns would remount the date controls
  // and drop keyboard focus after Enter/Space.
  const absoluteDateColumnsRef = React.useRef(absoluteDateColumns);
  absoluteDateColumnsRef.current = absoluteDateColumns;

  const { data: harnessOptions, isPending: harnessesPending } = useHarnesses();

  function toggleHarness(id: string, checked: boolean) {
    const next = checked
      ? [...filters.harnessIds, id]
      : filters.harnessIds.filter((value) => value !== id);
    onFiltersChange({ ...filters, harnessIds: next }, { immediate: true });
  }

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: 'select',
          header: ({ table }) => (
            <div className="flex items-center justify-center">
              <Checkbox
                checked={table.getIsAllPageRowsSelected()}
                indeterminate={
                  table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
                }
                onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                aria-label="Select all"
              />
            </div>
          ),
          cell: ({ row }) => (
            <div className="flex items-center justify-center">
              <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                aria-label="Select row"
              />
            </div>
          ),
          enableHiding: false,
        }),
        columnHelper.accessor('name', {
          header: () => (
            <SortableHeader
              label="Name"
              sorted={toSortedState(sort, 'name')}
              onToggle={() => onSortChange(cycleSort(sort, 'name'))}
            />
          ),
          cell: ({ row }) => (
            <Link
              to="/sessions/$id"
              params={{ id: row.original.id }}
              className="text-foreground underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
          ),
          enableHiding: false,
        }),
        columnHelper.accessor((row) => row.harness.id, {
          id: 'harness',
          header: () => (
            <SortableHeader
              label="Harness"
              sorted={toSortedState(sort, 'harness')}
              onToggle={() => onSortChange(cycleSort(sort, 'harness'))}
            />
          ),
          cell: ({ row }) => <HarnessIdentity harness={row.original.harness} />,
        }),
        columnHelper.accessor('startedAt', {
          id: 'startedAt',
          header: () => (
            <SortableHeader
              label="Started At"
              sorted={toSortedState(sort, 'startedAt')}
              onToggle={() => onSortChange(cycleSort(sort, 'startedAt'))}
            />
          ),
          cell: ({ getValue }) => (
            <RelativeDate
              value={getValue()}
              showAbsolute={absoluteDateColumnsRef.current.startedAt}
              onToggle={() =>
                setAbsoluteDateColumns((previous) => ({
                  ...previous,
                  startedAt: !previous.startedAt,
                }))
              }
            />
          ),
        }),
        columnHelper.accessor('lastActivity', {
          id: 'lastActivity',
          header: () => (
            <SortableHeader
              label="Last Activity"
              sorted={toSortedState(sort, 'lastActivity')}
              onToggle={() => onSortChange(cycleSort(sort, 'lastActivity'))}
            />
          ),
          cell: ({ getValue }) => (
            <RelativeDate
              value={getValue()}
              showAbsolute={absoluteDateColumnsRef.current.lastActivity}
              onToggle={() =>
                setAbsoluteDateColumns((previous) => ({
                  ...previous,
                  lastActivity: !previous.lastActivity,
                }))
              }
            />
          ),
        }),
        columnHelper.accessor('durationMs', {
          id: 'duration',
          header: () => (
            <SortableHeader
              align="right"
              label="Duration"
              sorted={toSortedState(sort, 'duration')}
              onToggle={() => onSortChange(cycleSort(sort, 'duration'))}
            />
          ),
          cell: ({ getValue }) => <div className="text-right">{formatDuration(getValue())}</div>,
        }),
        columnHelper.accessor((row) => sumTokens(row.tokensInclusive), {
          id: 'tokens',
          header: () => (
            <SortableHeader
              align="right"
              label="Tokens"
              sorted={toSortedState(sort, 'tokens')}
              onToggle={() => onSortChange(cycleSort(sort, 'tokens'))}
            />
          ),
          cell: ({ getValue }) => (
            <div className="text-right">{formatCompactNumber(getValue())}</div>
          ),
        }),
        columnHelper.accessor('costUsd', {
          id: 'cost',
          header: () => (
            <SortableHeader
              align="right"
              label="Cost"
              sorted={toSortedState(sort, 'cost')}
              onToggle={() => onSortChange(cycleSort(sort, 'cost'))}
            />
          ),
          cell: ({ getValue }) => <div className="text-right">{formatCurrency(getValue())}</div>,
        }),
        // Display-only subagent counters (server computed). Plain-string headers,
        // so they never become a sort button; hideable via the Columns menu.
        columnHelper.accessor('subagentChildCount', {
          id: 'subagentChildCount',
          header: 'Direct',
          cell: ({ getValue }) => <div className="text-right">{getValue()}</div>,
        }),
        columnHelper.accessor('subagentDescendantCount', {
          id: 'subagentDescendantCount',
          header: 'Full tree',
          cell: ({ getValue }) => <div className="text-right">{getValue()}</div>,
        }),
      ]),
    [sort, onSortChange],
  );

  const table = useTable({
    features,
    data,
    columns,
    state: { columnVisibility, rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
  });

  const rangeStart = pagination.pageIndex * pagination.pageSize + 1;
  const rangeEnd = Math.min(total, rangeStart + data.length - 1);
  const rangeLabel =
    data.length === 0 ? '0 of 0 rows' : `${rangeStart}–${rangeEnd} of ${total} rows`;
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const canPreviousPage = pagination.pageIndex > 0;
  const canNextPage = pagination.pageIndex + 1 < totalPages;

  return (
    <div className="flex w-full flex-col justify-start gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
        <div className="relative w-full max-w-xs min-w-0">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search sessions"
            className="pr-8 pl-8"
            placeholder="Search sessions…"
            value={filters.q}
            onChange={(event) => onFiltersChange({ ...filters, q: event.target.value })}
          />
          {filters.q ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => onFiltersChange({ ...filters, q: '' }, { immediate: true })}
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <ListFilterIcon data-icon="inline-start" />
              Harness
              {filters.harnessIds.length > 0 ? (
                <Badge variant="secondary">{filters.harnessIds.length}</Badge>
              ) : (
                <ChevronDownIcon data-icon="inline-end" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {harnessesPending ? (
                <DropdownMenuItem disabled>Loading harnesses…</DropdownMenuItem>
              ) : harnessOptions && harnessOptions.length > 0 ? (
                harnessOptions.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={filters.harnessIds.includes(option.id)}
                    onCheckedChange={(checked) => toggleHarness(option.id, !!checked)}
                  >
                    <HarnessIcon id={option.id} />
                    {option.displayName}
                  </DropdownMenuCheckboxItem>
                ))
              ) : (
                <DropdownMenuItem disabled>No harnesses</DropdownMenuItem>
              )}
              {filters.harnessIds.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      onFiltersChange({ ...filters, harnessIds: [] }, { immediate: true })
                    }
                  >
                    <XIcon />
                    Clear
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <ClockIcon data-icon="inline-start" />
              Duration
              {filters.duration ? (
                <Badge variant="secondary">{durationLabel(filters.duration)}</Badge>
              ) : (
                <ChevronDownIcon data-icon="inline-end" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup
                value={filters.duration}
                onValueChange={(value) =>
                  onFiltersChange(
                    { ...filters, duration: value as DurationPreset },
                    { immediate: true },
                  )
                }
              >
                {DURATION_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value || 'all'}
                    closeOnClick
                    value={option.value}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <CircleDollarSignIcon data-icon="inline-start" />
              Cost
              {filters.cost ? (
                <Badge variant="secondary">{costLabel(filters.cost)}</Badge>
              ) : (
                <ChevronDownIcon data-icon="inline-end" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup
                value={filters.cost}
                onValueChange={(value) =>
                  onFiltersChange({ ...filters, cost: value as CostPreset }, { immediate: true })
                }
              >
                {COST_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value || 'all'}
                    closeOnClick
                    value={option.value}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Columns3Icon data-icon="inline-start" />
              Columns
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              {table
                .getAllColumns()
                .filter((column) => typeof column.accessorFn !== 'undefined' && column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {COLUMN_LABELS[column.id] ?? column.id}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6">
        <div
          aria-busy={isFetching}
          className={cn(
            'overflow-hidden rounded-lg border transition-opacity duration-200',
            isFetching && 'opacity-60',
          )}
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder ? null : <FlexRender header={header} />}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="**:data-[slot=table-cell]:first:w-8">
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {isFetching ? <span className="sr-only">Refreshing sessions…</span> : null}
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {table.getSelectedRowModel().rows.length} of {data.length} row(s) selected.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${pagination.pageSize}`}
                onValueChange={(value) => onPageSizeChange(Number(value))}
                items={PAGE_SIZES.map((pageSize) => ({
                  label: `${pageSize}`,
                  value: `${pageSize}`,
                }))}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue placeholder={pagination.pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  <SelectGroup>
                    {PAGE_SIZES.map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              {rangeLabel}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => onPageChange(0)}
                disabled={!canPreviousPage}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeftIcon />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => onPageChange(pagination.pageIndex - 1)}
                disabled={!canPreviousPage}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => onPageChange(pagination.pageIndex + 1)}
                disabled={!canNextPage}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRightIcon />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => onPageChange(totalPages - 1)}
                disabled={!canNextPage}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRightIcon />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
