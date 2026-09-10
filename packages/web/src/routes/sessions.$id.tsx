import { createFileRoute, Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { AgentGraph } from '@/components/session-profile/agent-graph';
import { EventsTable } from '@/components/session-profile/events-table';
import { Header, HeaderSkeleton } from '@/components/session-profile/header';
import { SignalsAccordion } from '@/components/session-profile/signals-accordion';
import { TokenChart } from '@/components/session-profile/token-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/queries/sessions';

export const Route = createFileRoute('/sessions/$id')({
  component: SessionProfileRoute,
});

const DEFAULT_PAGE_SIZE = 50;

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

      <Header refresh={refresh} session={session.data} />

      <AgentGraph
        onNodeCount={setSubagentCount}
        onOpenNode={openNode}
        refresh={refresh}
        rootSession={rootSession}
        sessionId={id}
      />

      <TokenChart refresh={refresh} sessionId={id} />

      <EventsTable pageSize={DEFAULT_PAGE_SIZE} refresh={refresh} sessionId={id} />

      <SignalsAccordion
        refresh={refresh}
        session={session.data}
        sessionId={id}
        subagentCount={subagentCount}
      />
    </div>
  );
}
