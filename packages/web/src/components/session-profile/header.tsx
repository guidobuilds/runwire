import type { ApiSessionDetail, ApiSessionSummary, ContextMetrics } from '@runwire/core';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { HarnessIdentity } from '@/components/harness-identity';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSessionProfileContext } from '@/queries/session-profile';
import {
  FIELD_LABELS,
  formatCompact,
  formatCurrency,
  formatDateTime,
  formatDuration,
  TOKEN_FIELDS,
} from './format';
import { ModelUsage } from './model-usage';

export type HeaderProps = {
  session: ApiSessionDetail;
  refresh?: number;
};

const DEFINITION_SKELETON_KEYS = [
  'harness',
  'project',
  'started',
  'ended',
  'duration',
  'cost',
] as const;

/** Parent navigation uses the typed router `Link` — no manual
 * percent-encoding, the router's own params-based encoding handles an id
 * containing a literal '/' or ':'. */
function SessionRefLink({ session }: { session: ApiSessionSummary }) {
  return (
    <Link
      className="font-medium text-primary underline-offset-4 hover:underline"
      params={{ id: session.id }}
      to="/sessions/$id"
    >
      {session.name}
    </Link>
  );
}

/** `hint` (when given) is shown on hover — used for the project's repo/path,
 * which is kept out of the always-visible line to keep it to the plain name. */
function DefinitionField({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium text-sm">
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="cursor-help underline decoration-dotted underline-offset-4" />
              }
            >
              {value}
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/** Inclusive on top, own below (G3/G9); a single figure when there is nothing
 * to distinguish (no children means own === inclusive). */
function TokenFieldStack({ session }: { session: ApiSessionDetail }) {
  const hasChildren = session.children.length > 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {TOKEN_FIELDS.map((field) => (
        <div className="border-primary/50 border-l-2 pl-2" key={field}>
          <p className="text-muted-foreground text-xs">{FIELD_LABELS[field]}</p>
          {hasChildren ? (
            <div className="flex flex-col">
              <span className="font-mono text-sm tabular-nums">
                {formatCompact(session.tokensInclusive[field])}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                own {formatCompact(session.tokensOwn[field])}
              </span>
            </div>
          ) : (
            <span className="font-mono text-sm tabular-nums">
              {formatCompact(session.tokensOwn[field])}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const COUNT_FORMATTER = new Intl.NumberFormat();
const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
});

/** `null` means the source never reported this prompt input; render an em dash. */
function formatPromptMetric(value: number | null): string {
  return value === null ? '—' : formatCompact(value);
}

function formatCacheShare(value: number | null): string {
  return value === null ? '—' : PERCENT_FORMATTER.format(value);
}

type ContextField = { label: string; read: (metrics: ContextMetrics) => string };

const CONTEXT_FIELDS: readonly ContextField[] = [
  { label: 'Avg prompt/call', read: (metrics) => formatPromptMetric(metrics.avgPromptInput) },
  { label: 'P95 prompt/call', read: (metrics) => formatPromptMetric(metrics.p95PromptInput) },
  { label: 'Peak prompt/call', read: (metrics) => formatPromptMetric(metrics.peakPromptInput) },
  { label: 'Cache read share', read: (metrics) => formatCacheShare(metrics.cacheReadShare) },
  { label: 'Observed calls', read: (metrics) => COUNT_FORMATTER.format(metrics.observedCalls) },
];

/** Prompt-context pressure (tree primary; own secondary only when descendants
 * exist, mirroring the token stack). Loads and errors in isolation so it can
 * never hide the rest of the header. */
function ContextPressure({ sessionId, refresh }: { sessionId: string; refresh: number }) {
  const query = useSessionProfileContext(sessionId, { refresh });

  if (query.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {CONTEXT_FIELDS.map((field) => (
          <Skeleton className="h-9 w-full" key={field.label} />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <p className="text-muted-foreground">Context metrics unavailable</p>
        <Button onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;
  const showOwn = data.descendants.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium text-sm">Context pressure</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {CONTEXT_FIELDS.map((field) => (
          <div className="border-primary/50 border-l-2 pl-2" key={field.label}>
            <p className="text-muted-foreground text-xs">{field.label}</p>
            {showOwn ? (
              <div className="flex flex-col">
                <span className="font-mono text-sm tabular-nums">{field.read(data.tree)}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  own {field.read(data.own)}
                </span>
              </div>
            ) : (
              <span className="font-mono text-sm tabular-nums">{field.read(data.tree)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Header: name/title, harness, project, timing, cost, own+inclusive totals.
 * No tool-call/turn/API-call counts here — those live in the signals accordion
 * or the agent graph (G9). */
export function Header({ session, refresh = 0 }: HeaderProps) {
  const showTitle = session.title !== null && session.title !== session.name;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-semibold text-lg">{session.name}</h2>
        </CardTitle>
        {showTitle ? <CardDescription>{session.title}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <DefinitionField
            label="Harness"
            value={<HarnessIdentity harness={session.harness} showId />}
          />
          <DefinitionField
            hint={session.project?.key}
            label="Project"
            value={session.project ? session.project.name : 'no project'}
          />
          <DefinitionField label="Started" value={formatDateTime(session.startedAt)} />
          <DefinitionField label="Ended" value={formatDateTime(session.endedAt)} />
          <DefinitionField label="Duration" value={formatDuration(session.durationMs)} />
          <DefinitionField label="Cost" value={formatCurrency(session.costUsd)} />
        </dl>

        <TokenFieldStack session={session} />

        <ContextPressure refresh={refresh} sessionId={session.id} />

        <ModelUsage refresh={refresh} sessionId={session.id} />

        {session.parent ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">Parent session</span>
            <SessionRefLink session={session.parent} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HeaderSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {DEFINITION_SKELETON_KEYS.map((key) => (
            <Skeleton className="h-9 w-full" key={key} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {TOKEN_FIELDS.map((field) => (
            <Skeleton className="h-9 w-full" key={field} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
