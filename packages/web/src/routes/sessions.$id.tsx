import type { ApiSessionSummary, ApiTokenTotals } from '@scout/core';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/queries/sessions';

// Minimal detail view for a single session (f5). Composed independently of the
// f4 dashboard -- reachable via a "View details" link added to data-table.tsx's
// TableCellViewer drawer (see build-log.md's f5 section for exactly where).
export const Route = createFileRoute('/sessions/$id')({
  component: SessionDetail,
});

function sumTokens(totals: ApiTokenTotals): number {
  return (
    totals.uncachedInput +
    totals.cachedInput +
    totals.cacheWrite +
    totals.output +
    totals.reasoningOutput
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SessionLink({ session }: { session: ApiSessionSummary }) {
  return (
    <Link
      to="/sessions/$id"
      params={{ id: session.id }}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {session.name}
    </Link>
  );
}

function SessionDetail() {
  const { id } = Route.useParams();
  const { data, isPending, isError, error } = useSession(id);

  if (isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Loading session…</p>;
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <p className="p-6 text-sm text-destructive">
        {notFound
          ? 'Session not found.'
          : `Failed to load session: ${error instanceof Error ? error.message : 'unknown error'}`}
      </p>
    );
  }

  const tokensInclusiveTotal = sumTokens(data.tokensInclusive);

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <Link
          to="/sessions"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to sessions
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        {data.title && data.title !== data.name ? (
          <p className="text-sm text-muted-foreground">{data.title}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <SummaryField label="Harness" value={`${data.harness.displayName} (${data.harness.id})`} />
        <SummaryField
          label="Project"
          value={data.project ? `${data.project.name} (${data.project.key})` : 'no project'}
        />
        <SummaryField label="Started" value={formatDateTime(data.startedAt)} />
        <SummaryField label="Ended" value={formatDateTime(data.endedAt)} />
        <SummaryField label="Duration" value={formatDuration(data.durationMs)} />
        <SummaryField label="Cost" value={formatCurrency(data.costUsd)} />
        <SummaryField
          label="Tokens (inclusive)"
          value={formatCompactNumber(tokensInclusiveTotal)}
        />
        <SummaryField label="Tool calls (inclusive)" value={String(data.toolCallsInclusive)} />
        <SummaryField label="Turns (own)" value={String(data.turnsOwn)} />
      </div>
      {data.parent ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Parent session</span>
          <SessionLink session={data.parent} />
        </div>
      ) : null}
      {data.children.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Child sessions</span>
          <ul className="flex flex-col gap-1">
            {data.children.map((child) => (
              <li key={child.id}>
                <SessionLink session={child} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
