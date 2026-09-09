import type { Event, EventFilter } from '@scout/core';
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
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export type EventsTableProps = {
  sessionId: string;
  /** Optional initial state for isolated component tests. */
  initialFilter?: EventFilter;
  /** Optional initial state for isolated component tests; 1-based. */
  initialPage?: number;
  pageSize?: number;
  refresh?: number;
};

const EVENT_FILTERS: readonly EventFilter[] = [
  'signals',
  'relevant',
  'all',
  'mcp',
  'skill',
  'hook',
  'read',
  'write',
  'exec',
  'agent',
  'error',
];

const EVENT_FILTER_LABELS: Record<EventFilter, string> = {
  signals: 'Harness signals',
  relevant: 'Relevant events',
  all: 'All events',
  mcp: 'MCP',
  skill: 'Skill',
  hook: 'Hook',
  read: 'Read',
  write: 'Write',
  exec: 'Exec',
  agent: 'Agent',
  error: 'Error',
};

const KIND_LABELS: Record<Event['kind'], string> = {
  call: 'Call',
  tool: 'Tool',
  turn: 'Turn',
  harness: 'Harness',
  compaction: 'Compaction',
  'model-change': 'Model change',
  'mode-change': 'Mode change',
};

const KIND_BADGE_VARIANT: Record<Event['kind'], 'default' | 'secondary' | 'outline' | 'ghost'> = {
  call: 'secondary',
  tool: 'outline',
  turn: 'ghost',
  harness: 'outline',
  compaction: 'default',
  'model-change': 'default',
  'mode-change': 'default',
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

/** Metadata-only: only the fields already on the Event union, never args/paths/output. */
function eventDetail(event: Event): string {
  switch (event.kind) {
    case 'call':
      return event.model ?? 'no model';
    case 'tool':
      return [event.category, event.toolName].filter(Boolean).join(' · ') || 'tool';
    case 'turn':
      return event.durationMs === null ? 'no duration' : `${formatNumber(event.durationMs)} ms`;
    case 'harness':
      return event.toolName ?? 'harness';
    case 'compaction':
      return event.trigger ?? 'compaction';
    case 'model-change':
    case 'mode-change':
      return `${event.from ?? '?'} → ${event.to ?? '?'}`;
  }
}

const SKELETON_ROW_KEYS = ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'] as const;

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Merged, paginated, filterable events table (G8). Always scope=tree — the
 * merged reader has no per-lane view, it covers the whole session tree. */
export function EventsTable({
  sessionId,
  initialFilter = 'signals',
  initialPage = 1,
  pageSize: initialPageSize = 50,
  refresh = 0,
}: EventsTableProps) {
  const [filter, setFilter] = useState<EventFilter>(initialFilter);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const offset = (page - 1) * pageSize;
  const query = useSessionProfileMergedEvents(sessionId, {
    scope: 'tree',
    filter,
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

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>
          <h2 className="font-semibold text-lg">Events</h2>
        </CardTitle>
        <Select
          onValueChange={(value) => {
            setFilter(value as EventFilter);
            setPage(1);
          }}
          value={filter}
        >
          <SelectTrigger aria-label="Event filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVENT_FILTERS.map((item) => (
              <SelectItem key={item} value={item}>
                {EVENT_FILTER_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                  <TableHead>Time</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={5}>
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
                      <TableCell className="font-mono text-xs">{modelCell(event)}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground text-xs">
                        {eventDetail(event)}
                        {event.error ? (
                          <Badge className="ml-2" variant="destructive">
                            error
                          </Badge>
                        ) : null}
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
