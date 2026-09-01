import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAllSessions } from '../api/queries';
import { PageHeading } from '../components/PageHeading';
import { QueryState } from '../components/primitives/QueryState';
import { useHarnessDirectory } from '../components/session-table/harness-directory';
import { SessionTable } from '../components/session-table/SessionTable';

/**
 * Sessions landing (brief §4.1, design.md §5) -- the app's default view:
 * every session, across every project and harness, unscoped. Replaces the M4
 * placeholder `beforeLoad` redirect to `/projects`.
 *
 * Reuses `SessionTable` with `scope="all"` (design.md §2's reuse contract --
 * one table component for the unscoped landing and both scoped views), fed
 * by `useAllSessions()` (`GET /api/sessions` with no `ids`, f5).
 */
function SessionsRoute() {
  const navigate = useNavigate();
  const harnesses = useHarnessDirectory();
  const { data, isPending, error, refetch } = useAllSessions();

  return (
    <section className="space-y-4">
      <PageHeading
        eyebrow="Scout"
        title="Sessions"
        description="Every session, across every project and harness."
      />

      <QueryState isPending={isPending} error={error} refetch={refetch}>
        {data ? (
          <SessionTable
            scope="all"
            summaries={data.summaries}
            rollups={data.rollups}
            harnesses={harnesses}
            onOpen={(id) => {
              void navigate({ to: '/sessions/$id', params: { id } });
            }}
          />
        ) : null}
      </QueryState>
    </section>
  );
}

export const Route = createFileRoute('/')({ component: SessionsRoute });
