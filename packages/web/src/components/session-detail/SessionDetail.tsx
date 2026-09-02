import { Link, useNavigate } from '@tanstack/react-router';
import { ApiError } from '../../api/client';
import {
  useAdapterCapabilities,
  useAdapterDisplayName,
  useSession,
  useTrace,
} from '../../api/queries';
import type { SessionSummary } from '../../api/types';
import { buildAgentTree } from '../../lib/tree';
import { TraceRibbon } from '../charts/TraceRibbon';
import { QueryState } from '../primitives/QueryState';
import { SessionTimeline } from '../session-timeline/SessionTimeline';
import { AgentTree } from './AgentTree';
import { CountsPanel } from './CountsPanel';
import { DiagnosticsList } from './DiagnosticsList';
import { SessionHeader } from './SessionHeader';
import { sumPresentUsage, TokenBreakdown } from './TokenBreakdown';

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
 * Recent token-volume trend for `CountsPanel`'s mini sparkline (design.md
 * §5), derived client-side from the subtree's own summaries — no new
 * endpoint. Ordered by `startedAt` (absent-timing sessions last, matching
 * `lib/tree.ts`'s own ordering convention); a session with no present usage
 * metric at all is dropped rather than turned into an invented `0` — the
 * same absence discipline `sumPresentUsage` already applies per-session.
 */
function deriveTokenSeries(summaries: readonly SessionSummary[]): number[] {
  const ordered = [...summaries].sort((a, b) => {
    const at = a.timing.startedAt?.value;
    const bt = b.timing.startedAt?.value;
    if (at === bt) return 0;
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    return at < bt ? -1 : 1;
  });
  const series: number[] = [];
  for (const summary of ordered) {
    const total = sumPresentUsage(summary.usage);
    if (total !== undefined) series.push(total);
  }
  return series;
}

/**
 * Session detail: the operational review from PRODUCT.md, never a transcript.
 *
 * `useAdapterCapabilities`/`useAdapterDisplayName` are called exactly once here
 * and handed down as props (design.md §5/§6/§7), so the whole view holds two
 * `['status']` observers rather than two per metric cell. `ConnectedMetricCell`
 * is deliberately not used anywhere below.
 *
 * Section order (design.md §5): header/meta band, diagnostics banner
 * (surfaced right under the header so it is visible before anything else —
 * brief §4.4 — rather than buried at the bottom where M4 originally put it),
 * token breakdown, counts + trend, agent tree, trace ribbon, session timeline
 * (session-timeline slug design.md §1.1: appended after Trace, no reordering
 * of the sections above it — a new, separate elapsed-real-time view rather
 * than a replacement for the trace ribbon's step-index axis). No skill/mcp
 * event-log card anywhere (D38).
 */
export function SessionDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const query = useSession(id);
  const trace = useTrace(id);
  const harness = query.data?.summary.harness ?? '';
  const capabilities = useAdapterCapabilities(harness);
  const displayName = useAdapterDisplayName(harness);

  if (query.error instanceof ApiError && query.error.status === 404) {
    return <NotFound id={id} />;
  }

  const tree = query.data
    ? buildAgentTree(query.data.summary.id, query.data.subtree.summaries)
    : undefined;
  const series = query.data ? deriveTokenSeries(query.data.subtree.summaries) : [];

  return (
    <QueryState isPending={query.isPending} error={query.error} refetch={query.refetch}>
      {query.data ? (
        <div className="space-y-8">
          <SessionHeader
            summary={query.data.summary}
            capabilities={capabilities}
            displayName={displayName}
          />
          <DiagnosticsList diagnostics={query.data.diagnostics} />
          <TokenBreakdown
            summary={query.data.summary}
            rollup={query.data.rollup}
            capabilities={capabilities}
            displayName={displayName}
          />
          <div className="rounded-lg border border-border bg-card p-3">
            <CountsPanel
              summary={query.data.summary}
              rollup={query.data.rollup}
              capabilities={capabilities}
              displayName={displayName}
              series={series}
            />
          </div>
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
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Trace</h2>
            <div className="rounded-lg border border-border bg-card p-3">
              <TraceRibbon trace={trace.data} />
            </div>
          </section>
          <SessionTimeline id={id} />
        </div>
      ) : null}
    </QueryState>
  );
}
