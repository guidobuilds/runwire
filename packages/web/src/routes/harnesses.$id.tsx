import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useHarnessSessions } from '../api/queries';
import { QueryState } from '../components/primitives/QueryState';
import { useHarnessDirectory } from '../components/session-table/harness-directory';
import { SessionTable } from '../components/session-table/SessionTable';

function HarnessSessionsRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const harnesses = useHarnessDirectory();

  // Raw id, same as `/projects/$key`: `api/queries.ts` owns the percent-
  // encoding `hono/client` does not do for path params, so encoding it here as
  // well would double-encode — pinned by `routes/param-encoding.test.tsx`,
  // which drives this route through the real route tree with hostile ids.
  const { data, isPending, error, refetch } = useHarnessSessions(id);

  const displayName = harnesses?.[id]?.displayName ?? id;

  return (
    <QueryState isPending={isPending} error={error} refetch={refetch}>
      {data ? (
        <section className="space-y-4">
          <header className="space-y-1">
            <Link
              to="/harnesses"
              className="text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              ← All harnesses
            </Link>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{displayName}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {data.summaries.length} sessions
            </p>
          </header>

          <SessionTable
            scope="harness"
            summaries={data.summaries}
            rollups={data.rollups}
            harnesses={harnesses}
            hiddenAutomated={data.hiddenAutomated}
            onOpen={(sessionId) => {
              void navigate({ to: '/sessions/$id', params: { id: sessionId } });
            }}
          />
        </section>
      ) : null}
    </QueryState>
  );
}

export const Route = createFileRoute('/harnesses/$id')({ component: HarnessSessionsRoute });
