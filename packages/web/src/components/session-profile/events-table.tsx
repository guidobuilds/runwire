import type {
  Event,
  EventAction,
  EventKind,
  EventSortField,
  EventStatus,
  SortDirection,
} from '@runwire/core';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSessionProfileMergedEvents } from '@/queries/session-profile';
import { formatNumber, formatTime, readableAgent, readableModel } from './format';

const EM_DASH = '—';
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;

export type EventsTableProps = {
  sessionId: string;
  /** Optional initial state for isolated component tests. */
  initialSort?: EventSortField;
  initialDir?: SortDirection;
  initialKind?: EventKind;
  initialStatus?: EventStatus;
  initialPage?: number;
  pageSize?: number;
  refresh?: number;
};

const EVENT_KINDS: readonly EventKind[] = [
  'call',
  'tool',
  'turn',
  'harness',
  'compaction',
  'model-change',
  'mode-change',
];

const KIND_LABELS: Record<EventKind, string> = {
  call: 'Call',
  tool: 'Tool',
  turn: 'Turn',
  harness: 'Harness',
  compaction: 'Compaction',
  'model-change': 'Model change',
  'mode-change': 'Mode change',
};

const KIND_BADGE_VARIANT: Record<EventKind, 'default' | 'secondary' | 'outline' | 'ghost'> = {
  call: 'secondary',
  tool: 'outline',
  turn: 'ghost',
  harness: 'outline',
  compaction: 'default',
  'model-change': 'default',
  'mode-change': 'default',
};

const ACTION_LABELS: Record<EventAction, string> = {
  call: 'Model call',
  tool: 'Tool',
  turn: 'Turn',
  harness: 'Harness',
  compaction: 'Compaction',
  'model-change': 'Model change',
  'mode-change': 'Mode change',
  read: 'Read',
  write: 'Write',
  exec: 'Execute',
  search: 'Search',
  plan: 'Plan',
  agent: 'Agent',
  web: 'Web',
  mcp: 'MCP',
  skill: 'Skill',
  other: 'Other',
};

/** Never the raw full session id in a cell (merged events span the whole
 * tree): the tail after the last '/' or ':' — used when the scope nodes
 * carry no agentType for this stream. */
function agentLabel(sessionId: string): string {
  const cut = Math.max(sessionId.lastIndexOf('/'), sessionId.lastIndexOf(':'));
  return cut === -1 ? sessionId : sessionId.slice(cut + 1);
}

/** Prefer the scope node's agentType (human-readable); fall back to the short id tail. */
function agentCell(sessionId: string, agentTypeById: Map<string, string | null>): string {
  const agentType = agentTypeById.get(sessionId);
  return agentType == null || agentType === '' ? agentLabel(sessionId) : readableAgent(agentType);
}

/** Model exists on `call` and `tool` events; every other kind shows an em dash. */
function modelCell(event: Event): string {
  if (event.kind !== 'call' && event.kind !== 'tool') return EM_DASH;
  return event.model ? readableModel(event.model) : EM_DASH;
}

/** Server-owned metadata-only subject; a turn has none, so its duration is the
 * fallback so no row loses its only detail. */
function subjectCell(event: Event): string {
  if (event.subject !== null) return event.subject;
  if (event.kind === 'turn' && event.durationMs !== null)
    return `${formatNumber(event.durationMs)} ms`;
  return EM_DASH;
}

const SKELETON_ROW_KEYS = ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'] as const;

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function SortHead({
  field,
  label,
  sort,
  dir,
  onSort,
}: {
  field: EventSortField;
  label: string;
  sort: EventSortField;
  dir: SortDirection;
  onSort: (field: EventSortField) => void;
}) {
  const active = sort === field;
  return (
    <TableHead aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        className="inline-flex items-center gap-1 font-medium"
        onClick={() => onSort(field)}
        type="button"
      >
        {label}
        {active ? <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span> : null}
      </button>
    </TableHead>
  );
}

/** Server-driven merged events datatable (G8). Filtering, sorting, and
 * pagination are all owned by `/api/sessions/:id/profile/events`; the table
 * only holds the controls' state. Always scope=tree — the merged reader has no
 * per-lane view, it covers the whole session tree. */
export function EventsTable({
  sessionId,
  initialSort = 'time',
  initialDir = 'asc',
  initialKind,
  initialStatus,
  initialPage = 1,
  pageSize: initialPageSize = 10,
  refresh = 0,
}: EventsTableProps) {
  const [sort, setSort] = useState<EventSortField>(initialSort);
  const [dir, setDir] = useState<SortDirection>(initialDir);
  const [kind, setKind] = useState<EventKind | 'all'>(initialKind ?? 'all');
  const [status, setStatus] = useState<EventStatus | 'all'>(initialStatus ?? 'all');
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const offset = (page - 1) * pageSize;
  const query = useSessionProfileMergedEvents(sessionId, {
    scope: 'tree',
    sort,
    dir,
    kind: kind === 'all' ? undefined : [kind],
    status: status === 'all' ? undefined : status,
    limit: pageSize,
    offset,
    refresh,
  });

  const agentTypeById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const node of query.data?.nodes ?? []) map.set(node.id, node.agentType);
    return map;
  }, [query.data?.nodes]);

  const pages = query.data ? pageCount(query.data.total, pageSize) : 1;

  function toggleSort(field: EventSortField) {
    if (sort === field) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setDir('asc');
    }
    setPage(1);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>
          <h2 className="font-semibold text-lg">Events</h2>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            onValueChange={(value) => {
              setKind(value as EventKind | 'all');
              setPage(1);
            }}
            value={kind}
          >
            <SelectTrigger aria-label="Event kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {EVENT_KINDS.map((item) => (
                <SelectItem key={item} value={item}>
                  {KIND_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) => {
              setStatus(value as EventStatus | 'all');
              setPage(1);
            }}
            value={status}
          >
            <SelectTrigger aria-label="Event status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ok">OK</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isLoading ? (
          <div className="flex flex-col gap-2">
            {SKELETON_ROW_KEYS.map((key) => (
              <Skeleton className="h-8 w-full" key={key} />
            ))}
          </div>
        ) : null}

        {query.isError ? (
          <div
            className="flex items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm"
            role="alert"
          >
            <span>Events could not be loaded.</span>
            <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
              Retry
            </Button>
          </div>
        ) : null}

        {query.data ? (
          <div className={query.isPlaceholderData ? 'opacity-60' : undefined}>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead dir={dir} field="time" label="Time" onSort={toggleSort} sort={sort} />
                  <SortHead dir={dir} field="agent" label="Agent" onSort={toggleSort} sort={sort} />
                  <SortHead dir={dir} field="kind" label="Kind" onSort={toggleSort} sort={sort} />
                  <SortHead
                    dir={dir}
                    field="action"
                    label="Action"
                    onSort={toggleSort}
                    sort={sort}
                  />
                  <SortHead
                    dir={dir}
                    field="subject"
                    label="Subject"
                    onSort={toggleSort}
                    sort={sort}
                  />
                  <SortHead dir={dir} field="model" label="Model" onSort={toggleSort} sort={sort} />
                  <SortHead
                    dir={dir}
                    field="status"
                    label="Status"
                    onSort={toggleSort}
                    sort={sort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={7}>
                      No events for this filter
                    </TableCell>
                  </TableRow>
                ) : (
                  query.data.items.map((event) => (
                    <TableRow key={`${event.sessionId}\0${event.seq}`}>
                      <TableCell className="font-mono text-xs">{formatTime(event.at)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {agentCell(event.sessionId, agentTypeById)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={KIND_BADGE_VARIANT[event.kind]}>
                          {KIND_LABELS[event.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{ACTION_LABELS[event.action]}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground text-xs">
                        {subjectCell(event)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{modelCell(event)}</TableCell>
                      <TableCell>
                        {event.error ? (
                          <Badge variant="destructive">Error</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">OK</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {query.data ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span>{formatNumber(query.data.total)} events total</span>
              {query.data.excludedNullAtCount > 0 ? (
                <span>
                  {formatNumber(query.data.excludedNullAtCount)} events without timestamp not shown
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Rows per page</span>
              <Select
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
                value={String(pageSize)}
              >
                <SelectTrigger aria-label="Rows per page" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        {query.data && pages > 1 ? (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  aria-disabled={page <= 1}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (page > 1) setPage(page - 1);
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-2 text-sm">
                  Page {page} of {pages}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  aria-disabled={page >= pages}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (page < pages) setPage(page + 1);
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </CardContent>
    </Card>
  );
}
