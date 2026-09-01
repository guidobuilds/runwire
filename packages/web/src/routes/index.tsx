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
    // `flex h-full min-h-0 flex-col`: fills AppShell's now-bounded
    // `app-content` region (fix-appshell-height-bounding) so the table below
    // can be the one piece that grows/scrolls internally, with the heading
    // and (via SessionTable itself) the pagination footer always visible.
    <section className="flex h-full min-h-0 flex-col gap-4">
      <PageHeading
        className="shrink-0"
        eyebrow="Scout"
        title="Sessions"
        description="Every session, across every project and harness."
      />

      {/* flex-1 min-h-0: the loading/error states from QueryState render as
          plain short content blocks here, but when data is ready this is
          what gives SessionTable's own `h-full` root a definite height to
          fill instead of growing to fit its (very tall) row content. */}
      <div className="min-h-0 flex-1">
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
      </div>
    </section>
  );
}

export const Route = createFileRoute('/')({ component: SessionsRoute });
