import { useMemo } from 'react';
import { useTraces } from '../../api/queries';
import { TraceRibbon } from '../charts/TraceRibbon';

export type CompareRibbonsRow = {
  id: string;
  /** The column's on-screen label (design.md §5's row/column anatomy). */
  label: string;
};

export type CompareRibbonsProps = {
  rows: readonly CompareRibbonsRow[];
  width?: number;
};

/**
 * Stacks one compact `TraceRibbon` per compared session (design.md §4,
 * DECISIONS.md D33: "the compare view stacks one timeline per selected
 * session on a shared axis"). The shared part is the whole point: every
 * ribbon here is handed the SAME `domainMax` -- the largest step index across
 * every compared session's own trace -- so two sessions' shapes are visually
 * diffable by position, not independently auto-scaled per session (which
 * would make an identical step index land at different x positions in each
 * row and make the "diff by eye" premise false).
 *
 * Each trace is fetched independently via `useTraces` (one query per id, all
 * in parallel) so a slow or 404-ing session's trace never blocks the others
 * from rendering their own ribbon.
 */
export function CompareRibbons({ rows, width = 480 }: CompareRibbonsProps) {
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const traceQueries = useTraces(ids);

  const domainMax = useMemo(() => {
    let max = 0;
    for (const query of traceQueries) {
      const steps = query.data?.steps;
      if (!steps || steps.length === 0) continue;
      for (const step of steps) {
        if (step.i > max) max = step.i;
      }
    }
    return max;
  }, [traceQueries]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2" data-shared-domain-max={domainMax}>
      {rows.map((row, index) => {
        const query = traceQueries[index];
        return (
          <div key={row.id} className="flex items-center gap-2">
            <span
              className="w-32 shrink-0 truncate text-xs text-muted-foreground"
              title={row.label}
            >
              {row.label}
            </span>
            <div className="min-w-0 flex-1">
              <TraceRibbon trace={query?.data} width={width} compact domainMax={domainMax} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
