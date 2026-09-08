import type { EventFilter, TokenField } from '@scout/core';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { AgentGraph } from '@/components/session-profile/agent-graph';
import { EventsTable } from '@/components/session-profile/events-table';
import { TOKEN_FIELDS } from '@/components/session-profile/format';
import { Header, HeaderSkeleton } from '@/components/session-profile/header';
import { SignalsAccordion } from '@/components/session-profile/signals-accordion';
import { TokenChart } from '@/components/session-profile/token-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/queries/sessions';

export const Route = createFileRoute('/sessions/$id')({
  validateSearch: validateSearch,
  component: SessionProfileRoute,
});

const EVENT_FILTERS = [
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
] as const satisfies readonly EventFilter[];

type SessionProfileSearch = {
  field?: TokenField;
  filter?: EventFilter;
  page?: number;
};

function isTokenField(value: unknown): value is TokenField {
  return typeof value === 'string' && TOKEN_FIELDS.includes(value as TokenField);
}

function isEventFilter(value: unknown): value is EventFilter {
  return typeof value === 'string' && EVENT_FILTERS.includes(value as EventFilter);
}

/** A positive integer, accepted as either a number or a digit string. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function toPositiveInteger(value: unknown): number | undefined {
  if (isPositiveInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function validateSearch(search: Record<string, unknown>): SessionProfileSearch {
  return {
    field: isTokenField(search.field) ? search.field : 'output',
    filter: isEventFilter(search.filter) ? search.filter : 'signals',
    page: toPositiveInteger(search.page) ?? 1,
  };
}

const PAGE_SIZE = 50;

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8 p-4 lg:p-6">
      <TopBar id={null} />
      <HeaderSkeleton />
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[240px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

function TopBar({ id, onRefresh }: { id: string | null; onRefresh?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        to="/sessions"
      >
        ← Back to sessions
      </Link>
      {id !== null ? (
        <div className="flex items-center gap-3">
          <Button onClick={onRefresh} size="sm" type="button">
            Refresh
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SessionProfileRoute() {
  const { id } = Route.useParams();
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const session = useSession(id);
  const [refresh, setRefresh] = useState(0);
  // Whole-tree subagent count, reported by AgentGraph once its full `spawns`
  // node list is loaded (design.md "Signals accordion (G5)": nodes.length -
  // 1, shared from the graph's own already-fetched data, not a second
  // reader). Reset to null on id/refresh change (compared during render, per
  // React's "adjusting state when a prop changes" pattern, rather than an
  // effect) so a stale count from a previous session is never shown mid-load
  // — SignalsAccordion already renders null as "—".
  const [subagentCount, setSubagentCount] = useState<number | null>(null);
  const subagentResetKey = `${id}:${refresh}`;
  const lastSubagentResetKey = useRef(subagentResetKey);
  if (lastSubagentResetKey.current !== subagentResetKey) {
    lastSubagentResetKey.current = subagentResetKey;
    if (subagentCount !== null) setSubagentCount(null);
  }
  const search = {
    field: rawSearch.field ?? 'output',
    filter: rawSearch.filter ?? 'signals',
    page: rawSearch.page ?? 1,
  } satisfies Required<SessionProfileSearch>;

  // Some panels (the events table's filter Select) fire more than one search
  // update from a single user gesture (filter change + page reset). Each
  // `updateSearch` call would otherwise read the same stale `search` closure
  // and clobber the other's change with a second `navigate`; batching every
  // synchronous call into one merged patch, flushed on the next microtask,
  // keeps them atomic without needing to know which caller fired first.
  const pendingRef = useRef<Partial<SessionProfileSearch>>({});
  function updateSearch(partial: Partial<SessionProfileSearch>) {
    const isFirstInBatch = Object.keys(pendingRef.current).length === 0;
    pendingRef.current = { ...pendingRef.current, ...partial };
    if (!isFirstInBatch) return;
    queueMicrotask(() => {
      const merged = pendingRef.current;
      pendingRef.current = {};
      void navigate({ search: { ...search, ...merged } });
    });
  }

  function openNode(nodeId: string) {
    void navigate({ params: { id: nodeId }, search: {}, to: '/sessions/$id' });
  }

  if (session.isPending) {
    return <PageSkeleton />;
  }

  if (session.isError) {
    const notFound = session.error instanceof ApiError && session.error.status === 404;
    return (
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <TopBar id={null} />
        {notFound ? (
          <p className="text-destructive text-sm">Session not found.</p>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <p className="text-destructive">
              Failed to load session:{' '}
              {session.error instanceof Error ? session.error.message : 'unknown error'}
            </p>
            <Button onClick={() => void session.refetch()} size="sm" type="button">
              Retry
            </Button>
          </div>
        )}
      </div>
    );
  }

  const rootSession = {
    agentType: session.data.agentType,
    endedAt: session.data.endedAt,
    id: session.data.id,
    startedAt: session.data.startedAt,
  };
  return (
    <div className="flex flex-col gap-8 p-4 lg:p-6">
      <TopBar id={id} onRefresh={() => setRefresh((value) => value + 1)} />

      <Header session={session.data} />

      <AgentGraph
        onNodeCount={setSubagentCount}
        onOpenNode={openNode}
        refresh={refresh}
        rootSession={rootSession}
        sessionId={id}
      />

      <TokenChart
        field={search.field}
        onFieldChange={(field) => updateSearch({ field })}
        refresh={refresh}
        sessionId={id}
      />

      <EventsTable
        filter={search.filter}
        onFilterChange={(filter) => updateSearch({ filter })}
        onPageChange={(page) => updateSearch({ page })}
        page={search.page}
        pageSize={PAGE_SIZE}
        refresh={refresh}
        sessionId={id}
      />

      <SignalsAccordion
        field={search.field}
        refresh={refresh}
        session={session.data}
        sessionId={id}
        subagentCount={subagentCount}
      />
    </div>
  );
}
