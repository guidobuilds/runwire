import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useProjectSessions } from '../api/queries';
import { QueryState } from '../components/primitives/QueryState';
import { useHarnessDirectory } from '../components/session-table/harness-directory';
import { SessionTable } from '../components/session-table/SessionTable';

function ProjectSessionsRoute() {
  const { key } = Route.useParams();
  const navigate = useNavigate();
  const harnesses = useHarnessDirectory();

  // TanStack Router percent-encodes path params on the way out and hands the
  // RAW key back here (measured: href `/projects/github.com%2Forg%2Frepo`,
  // params `{ key: 'github.com/org/repo' }`), so `key` is the real project key.
  // Pass it through raw: `api/queries.ts` owns the percent-encoding that
  // `hono/client` does not do for path params. Encoding it again here would
  // reach the server as `github.com%2Forg%2Frepo`, a project that does not
  // exist — pinned by `routes/param-encoding.test.tsx`, which drives this
  // route through the real route tree with 19 hostile keys.
  const { data, isPending, error, refetch } = useProjectSessions(key);

  const name = data?.summaries[0]?.project.name ?? key;

  return (
    <QueryState isPending={isPending} error={error} refetch={refetch}>
      {data ? (
        <section className="space-y-4">
          <header className="space-y-1">
            <Link
              to="/projects"
              className="text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              ← All projects
            </Link>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{name}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {data.summaries.length} sessions · {key}
            </p>
          </header>

          <SessionTable
            scope="project"
            summaries={data.summaries}
            rollups={data.rollups}
            harnesses={harnesses}
            hiddenAutomated={data.hiddenAutomated}
            onOpen={(id) => {
              void navigate({ to: '/sessions/$id', params: { id } });
            }}
          />
        </section>
      ) : null}
    </QueryState>
  );
}

export const Route = createFileRoute('/projects/$key')({ component: ProjectSessionsRoute });
