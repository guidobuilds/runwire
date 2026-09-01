import type { Capability, Metric, SessionRollup, SessionSummary, Usage } from '../../api/types';
import type { FieldKey } from '../../lib/capabilities';
import { formatTokens } from '../../lib/format';
import { usePrefs } from '../../state/prefs';
import { TokenCompositionBar } from '../charts/TokenCompositionBar';
import { Badge } from '../primitives/Badge';
import { MetricCell } from '../primitives/MetricCell';
import { Table, Tbody, Td, Th, Thead, Tr } from '../primitives/Table';
import { CardDescription, CardHeader, CardTitle } from '../ui/card';

/**
 * Mirrors `USAGE_FIELDS` in `packages/core/src/model/usage.ts` (web imports
 * core types only, never its runtime — see `.dependency-cruiser.cjs`).
 */
const USAGE_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
  'totalInput',
] as const satisfies readonly (keyof Usage & FieldKey)[];

const USAGE_LABELS: Record<(typeof USAGE_FIELDS)[number], string> = {
  uncachedInput: 'Uncached input',
  cachedInput: 'Cached input',
  cacheWrite: 'Cache write',
  output: 'Output',
  reasoningOutput: 'Reasoning output',
  totalInput: 'Total input',
};

/**
 * The 5 fields a "total tokens" figure sums over. `totalInput` is excluded on
 * purpose: it is itself derived/display-only (see the `USAGE_FIELDS` comment
 * above), so folding it into a sum alongside the fields it is derived from
 * would double count.
 */
const TOTAL_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const satisfies readonly (keyof Usage & FieldKey)[];

/**
 * Sums whichever metrics are actually present in `usage`, over `TOTAL_FIELDS`
 * only. Returns `undefined` — not `0` — when nothing is present, so the caller
 * can tell "no usage data at all" apart from "usage summed to zero", the same
 * absence-must-differ-from-a-real-value discipline `MetricCell` already
 * follows for a single field.
 */
export function sumPresentUsage(usage: Usage): number | undefined {
  let sum = 0;
  let any = false;
  for (const field of TOTAL_FIELDS) {
    const value = usage[field]?.value;
    if (value === undefined) continue;
    any = true;
    sum += value;
  }
  return any ? sum : undefined;
}

export type TokenBreakdownProps = {
  summary: SessionSummary;
  rollup: SessionRollup | undefined;
  capabilities: readonly Capability[] | undefined;
  displayName: string;
};

type Note = { confidence: string; note: string; source: string };

/**
 * Distinct provenance notes across every metric rendered above, keyed by
 * confidence + note + source so the same caveat reported by both columns is
 * listed once.
 *
 * The confidence word is part of the on-screen line on purpose. It was written
 * when `ConfidenceMarker` was `aria-hidden` and `~` / `?` reached nobody using
 * assistive technology; BL-3 has since been closed in the shared cell, which now
 * carries `role="img"` + `aria-label="medium confidence" | "low confidence"`.
 * The two are additive rather than duplicated: the marker grades the cell you
 * are on, this list gives the provenance once for the whole block, and the
 * de-duplication above is what keeps the note from being read out per cell.
 */
function collectNotes(metrics: readonly (Metric | undefined)[]): Note[] {
  const seen = new Set<string>();
  const notes: Note[] = [];
  for (const metric of metrics) {
    if (!metric?.note) continue;
    const key = `${metric.confidence}|${metric.note}|${metric.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ confidence: metric.confidence, note: metric.note, source: metric.source });
  }
  return notes;
}

/** Token usage, exclusive beside inclusive; the shell toggle only marks which one is active. */
export function TokenBreakdown({
  summary,
  rollup,
  capabilities,
  displayName,
}: TokenBreakdownProps) {
  const prefs = usePrefs();
  const activeClass = 'bg-zinc-50 dark:bg-zinc-900';
  const exclusiveMetrics = USAGE_FIELDS.map((field) => summary.usage[field]);
  const inclusiveMetrics = USAGE_FIELDS.map((field) => rollup?.inclusive.usage[field]);
  const notes = collectNotes([...exclusiveMetrics, ...inclusiveMetrics]);
  const activeUsage: Usage = prefs.inclusive ? (rollup?.inclusive.usage ?? {}) : summary.usage;
  const activeTotal = sumPresentUsage(activeUsage);
  const totalLabel = prefs.inclusive ? 'Total (inclusive)' : 'Total (exclusive)';

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Token breakdown</h2>
      <Table>
        <Thead>
          <Tr>
            <Th>Field</Th>
            <Th className={prefs.inclusive ? undefined : activeClass}>
              Exclusive {prefs.inclusive ? null : <Badge tone="info">active</Badge>}
            </Th>
            <Th className={prefs.inclusive ? activeClass : undefined}>
              Inclusive {prefs.inclusive ? <Badge tone="info">active</Badge> : null}
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {USAGE_FIELDS.map((field, index) => (
            <Tr key={field}>
              <Td>{USAGE_LABELS[field]}</Td>
              <Td numeric className={prefs.inclusive ? undefined : activeClass}>
                <MetricCell
                  field={field}
                  harness={summary.harness}
                  metric={exclusiveMetrics[index]}
                  capabilities={capabilities}
                  displayName={displayName}
                  align="right"
                />
              </Td>
              <Td numeric className={prefs.inclusive ? activeClass : undefined}>
                <MetricCell
                  field={field}
                  harness={summary.harness}
                  metric={inclusiveMetrics[index]}
                  capabilities={capabilities}
                  displayName={displayName}
                  align="right"
                />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <TokenCompositionBar
          usage={activeUsage}
          harness={summary.harness}
          capabilities={capabilities}
        />
        {activeTotal !== undefined ? (
          // The equivalent of scout.zip's `.big-number` intent (D44):
          // shadcn's own CardTitle scale instead of a bespoke large-text
          // class. `role="status"`/`aria-label` moved up to CardHeader so
          // toggling inclusive/exclusive still announces label + value
          // together as one live-region update, matching the prior markup's
          // accessible name exactly.
          <CardHeader
            role="status"
            aria-label={`${totalLabel}: ${formatTokens(activeTotal)}`}
            className="gap-0.5 p-0"
          >
            <CardDescription>{totalLabel}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {formatTokens(activeTotal)}
            </CardTitle>
          </CardHeader>
        ) : null}
      </div>
      {notes.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Confidence notes
          </h3>
          <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
            {notes.map((entry) => (
              <li key={`${entry.confidence}|${entry.note}|${entry.source}`}>
                {`${entry.confidence} confidence — ${entry.note} (${entry.source})`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
