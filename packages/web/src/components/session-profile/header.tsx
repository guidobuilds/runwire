import type { ApiSessionDetail, ApiSessionSummary } from '@scout/core';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { HarnessIdentity } from '@/components/harness-identity';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  FIELD_LABELS,
  formatCompact,
  formatCurrency,
  formatDateTime,
  formatDuration,
  TOKEN_FIELDS,
} from './format';

export type HeaderProps = {
  session: ApiSessionDetail;
};

const DEFINITION_SKELETON_KEYS = [
  'harness',
  'project',
  'started',
  'ended',
  'duration',
  'cost',
] as const;

/** Parent/child navigation uses the typed router `Link` — no manual
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

/** Header: name/title, harness, project, timing, cost, own+inclusive totals.
 * No tool-call/turn/API-call counts here — those live in the signals accordion
 * or the agent graph (G9). */
export function Header({ session }: HeaderProps) {
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

        {session.parent ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">Parent session</span>
            <SessionRefLink session={session.parent} />
          </div>
        ) : null}

        {session.children.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">Child sessions</span>
            <ul className="flex flex-col gap-1">
              {session.children.map((child) => (
                <li key={child.id}>
                  <SessionRefLink session={child} />
                </li>
              ))}
            </ul>
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
