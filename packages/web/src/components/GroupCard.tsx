import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useStatus } from '../api/queries';
import type { Confidence, SessionRollup, SessionSummary, Usage } from '../api/types';
import { formatRelative, formatTokens } from '../lib/format';
import { cn } from '../lib/utils';
import { Sparkline } from './charts/Sparkline';
import { Badge } from './primitives/Badge';
import { ConfidenceMarker } from './primitives/MetricCell';
import { Tooltip } from './primitives/Tooltip';

/*
 * Aggregate-token helpers, moved here from the M4 `ProjectsList.tsx` (which
 * f6 deletes -- `GroupCard` is the new one-component reuse contract for both
 * Projects and Harnesses, design.md §2/§5). Behavior is byte-for-byte the
 * same as the table version these replace: sum both halves, cap confidence at
 * `low` when a half is missing (the number is then a floor, not a
 * measurement), name both halves in the hover text.
 */

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export type AggregateTokenSummary = {
  /** `undefined` when the harness reported neither half. */
  total: number | undefined;
  confidence: Confidence;
  /** Hover provenance: one line per half, absent halves named as such. */
  title: string;
};

export function aggregateTokens(usage: Usage): AggregateTokenSummary {
  const parts = [
    { label: 'Input', metric: usage.totalInput },
    { label: 'Output', metric: usage.output },
  ];

  const title = parts
    .map(({ label, metric }) =>
      metric
        ? `${label} ${formatTokens(metric.value)} · ${metric.confidence} confidence · ${metric.source}`
        : `${label} — not reported`,
    )
    .join('\n');

  const present = parts.flatMap(({ metric }) => (metric ? [metric] : []));
  if (present.length === 0) return { total: undefined, confidence: 'low', title };

  const total = present.reduce((sum, metric) => sum + metric.value, 0);
  let confidence: Confidence = present.length === parts.length ? 'high' : 'low';
  for (const metric of present) {
    if (CONFIDENCE_RANK[metric.confidence] < CONFIDENCE_RANK[confidence]) {
      confidence = metric.confidence;
    }
  }
  return { total, confidence, title };
}

/** One aggregate-token cell: value, confidence marker, hover breakdown. */
export function AggregateTokens({ usage }: { usage: Usage }) {
  const { total, confidence, title } = aggregateTokens(usage);
  if (total === undefined) {
    return (
      <Tooltip content={title}>
        <span className="text-zinc-500 dark:text-zinc-400">—</span>
      </Tooltip>
    );
  }
  const tone =
    confidence === 'high' ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400';
  return (
    <Tooltip content={title}>
      <span className={tone}>
        <ConfidenceMarker confidence={confidence} />
        {formatTokens(total)}
      </span>
    </Tooltip>
  );
}

/** Absent values sort last in both directions; they are unknown, not smallest. */
export function compareOptional(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}

/**
 * Newest activity first, matching the M4 table's default sort -- absent
 * values (never scanned yet) sort last regardless of direction, not first.
 */
export function sortByLatestActivityDesc<T extends { latestActivityAt?: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.latestActivityAt === b.latestActivityAt) return 0;
    if (a.latestActivityAt === undefined) return 1;
    if (b.latestActivityAt === undefined) return -1;
    return a.latestActivityAt < b.latestActivityAt ? 1 : -1;
  });
}

/**
 * Adapter id → display name, resolved once from `useStatus()` and handed to
 * every card as a plain function (moved from `ProjectsList.tsx`, same
 * contract). Hoisted deliberately: a per-card hook would open one status
 * observer per rendered card.
 */
export function useDisplayNames(): (harnessId: string) => string {
  const { data } = useStatus();
  return useMemo(() => {
    const byId = new Map<string, string>(
      (data?.adapters ?? []).map((adapter) => [adapter.id, adapter.displayName]),
    );
    return (harnessId: string) => byId.get(harnessId) ?? harnessId;
  }, [data]);
}

/**
 * One point per root session, chronological (oldest first), y = that
 * session's inclusive aggregate tokens (via `aggregateTokens`, so a session
 * missing one usage half is still counted honestly). This is the "bucketed by
 * time + token volume" series design.md §4/§5 asks `GroupCard`'s Sparkline
 * for -- no server endpoint exists for a true time-bucketed histogram, and
 * the brief only asks for "recent activity" at a glance, so one point per
 * session (the same unit `sessionCount`/`aggregateUsage` already use) is the
 * lightest honest reading rather than an invented bucket width.
 */
export function sparklineSeriesFromSessions(
  summaries: readonly SessionSummary[],
  rollups: Record<string, SessionRollup>,
): number[] {
  const sortKey = (summary: SessionSummary): string =>
    summary.timing.startedAt?.value ?? summary.timing.endedAt?.value ?? '';
  return [...summaries]
    .sort((a, b) => {
      const at = sortKey(a);
      const bt = sortKey(b);
      if (at === bt) return 0;
      return at < bt ? -1 : 1;
    })
    .map((summary) => aggregateTokens(rollups[summary.id]?.inclusive.usage ?? {}).total ?? 0);
}

export type GroupCardDirection = 'project' | 'harness';

const CROSS_DIMENSION_LABEL: Record<GroupCardDirection, string> = {
  project: 'Harnesses',
  harness: 'Projects',
};

/**
 * Cap on visible cross-dimension badges before an overflow indicator takes
 * over. A single harness can honestly touch hundreds of projects (373 real
 * sessions / 204 real projects observed against local Claude Code data), and
 * every prior fixture only ever exercised 2-3 items, so the unbounded
 * `.map()` this replaces was invisible to the full green test suite until a
 * real-data manual pass blew a `GroupCard` out to the whole page. 4 matches
 * the density other capped affordances in this codebase use (see
 * `ModelChangesPopover` in `session-detail/SessionHeader.tsx`, which reveals
 * its full list on demand instead of always inline) -- full data stays
 * reachable via the overflow indicator's `title`, just not always rendered.
 */
const CROSS_DIMENSION_VISIBLE_CAP = 4;

const AVATAR_TONES = [
  'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
] as const;

/** Deterministic avatar tone from whatever `avatarLabel` the caller passes. */
function avatarTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? AVATAR_TONES[0];
}

function initial(label: string): string {
  return label.trim().charAt(0).toUpperCase() || '?';
}

export type GroupCardProps = {
  /** Which side of the Project/Harness pair this card represents. */
  direction: GroupCardDirection;
  name: string;
  /** Seeds the avatar letter + tone -- the project name or harness display name. */
  avatarLabel: string;
  sessionCount: number;
  /** Harness names for a project card, project names for a harness card. */
  crossDimension: readonly string[];
  latestActivityAt?: string;
  /** Inclusive, summed across this project's/harness's root sessions. */
  aggregateUsage: Usage;
  /** One point per root session, oldest first; `Sparkline` renders its own empty state below 2 points. */
  sparklineSeries: readonly number[];
  /**
   * A harness that is installed but has parsed zero sessions (brief §4.3) --
   * a real, distinct state, not an error. Never set for a project card: every
   * `ProjectAggregate` the server returns already has `sessionCount > 0`.
   */
  emptyVariant?: 'installed-no-sessions';
  /** Extra inline content next to the name (e.g. a project's identity/worktree badges). */
  meta?: ReactNode;
  onOpen: () => void;
  /** Injected for deterministic relative times in tests. */
  now?: number;
  className?: string;
};

/**
 * One shared card for both Projects and Harnesses (design.md §2's reuse
 * contract -- the `scout.zip` reference duplicated this per-view, we do not).
 * `direction` only ever changes the cross-dimension label and which empty
 * variant is reachable; every other prop and all of the markup is identical
 * for both call directions.
 */
export function GroupCard({
  direction,
  name,
  avatarLabel,
  sessionCount,
  crossDimension,
  latestActivityAt,
  aggregateUsage,
  sparklineSeries,
  emptyVariant,
  meta,
  onOpen,
  now,
  className,
}: GroupCardProps) {
  const nowMs = now ?? Date.now();
  const crossDimensionLabel = CROSS_DIMENSION_LABEL[direction];
  const isEmpty = emptyVariant === 'installed-no-sessions';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40',
        className,
      )}
    >
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 text-left">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            avatarTone(avatarLabel),
          )}
        >
          {initial(avatarLabel)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium text-foreground" title={name}>
              {name}
            </span>
            {meta}
          </span>
          <span className="block text-xs text-muted-foreground">
            {isEmpty
              ? 'Installed · no sessions'
              : `${sessionCount} session${sessionCount === 1 ? '' : 's'}`}
          </span>
        </span>
      </button>

      {isEmpty ? null : (
        <>
          <div className="space-y-1">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {crossDimensionLabel}
            </p>
            <div className="flex flex-wrap gap-1">
              {crossDimension.length > 0 ? (
                <>
                  {crossDimension.slice(0, CROSS_DIMENSION_VISIBLE_CAP).map((label) => (
                    <Badge key={label}>{label}</Badge>
                  ))}
                  {crossDimension.length > CROSS_DIMENSION_VISIBLE_CAP ? (
                    <span title={crossDimension.join(', ')}>
                      <Badge tone="neutral">
                        {`+${crossDimension.length - CROSS_DIMENSION_VISIBLE_CAP} more`}
                      </Badge>
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">None yet</span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {latestActivityAt ? formatRelative(latestActivityAt, nowMs) : 'unknown'}
            </span>
            <AggregateTokens usage={aggregateUsage} />
          </div>

          <Sparkline data={sparklineSeries} label={`${name} recent activity`} />
        </>
      )}
    </div>
  );
}
