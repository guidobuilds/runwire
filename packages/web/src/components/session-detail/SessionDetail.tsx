import { Link, useNavigate } from '@tanstack/react-router';
import { ApiError } from '../../api/client';
import { useAdapterCapabilities, useAdapterDisplayName, useSession } from '../../api/queries';
import { buildAgentTree } from '../../lib/tree';
import { QueryState } from '../ui/QueryState';
import { AgentTree } from './AgentTree';
import { CountsPanel } from './CountsPanel';
import { DiagnosticsList } from './DiagnosticsList';
import { SessionHeader } from './SessionHeader';
import { TokenBreakdown } from './TokenBreakdown';

function NotFound({ id }: { id: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Session not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {`No session with id ${id} is in the current scan.`}
      </p>
      <Link
        to="/projects"
        className="text-sm underline decoration-zinc-300 underline-offset-2 dark:decoration-zinc-600"
      >
        Back to projects
      </Link>
    </div>
  );
}

/**
 * Session detail: the operational review from PRODUCT.md, never a transcript.
 *
 * `useAdapterCapabilities`/`useAdapterDisplayName` are called exactly once here
 * and handed down as props (design.md §5/§6/§7), so the whole view holds two
 * `['status']` observers rather than two per metric cell. `ConnectedMetricCell`
 * is deliberately not used anywhere below.
 */
export function SessionDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const query = useSession(id);
  const harness = query.data?.summary.harness ?? '';
  const capabilities = useAdapterCapabilities(harness);
  const displayName = useAdapterDisplayName(harness);

  if (query.error instanceof ApiError && query.error.status === 404) {
    return <NotFound id={id} />;
  }

  const tree = query.data
    ? buildAgentTree(query.data.summary.id, query.data.subtree.summaries)
    : undefined;

  return (
    <QueryState isPending={query.isPending} error={query.error} refetch={query.refetch}>
      {query.data ? (
        <div className="space-y-8">
          <SessionHeader
            summary={query.data.summary}
            capabilities={capabilities}
            displayName={displayName}
          />
          <TokenBreakdown
            summary={query.data.summary}
            rollup={query.data.rollup}
            capabilities={capabilities}
            displayName={displayName}
          />
          <CountsPanel
            summary={query.data.summary}
            rollup={query.data.rollup}
            capabilities={capabilities}
            displayName={displayName}
          />
          {tree ? (
            <AgentTree
              root={tree}
              rollups={query.data.subtree.rollups}
              capabilities={capabilities}
              displayName={displayName}
              onOpen={(childId) => {
                void navigate({ to: '/sessions/$id', params: { id: childId } });
              }}
            />
          ) : null}
          <DiagnosticsList diagnostics={query.data.diagnostics} />
        </div>
      ) : null}
    </QueryState>
  );
}
