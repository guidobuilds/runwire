import type { Capability, HarnessId, Metric } from '../../api/types';
import { absenceKind, type FieldKey } from '../../lib/capabilities';
import { formatDuration, formatTokens } from '../../lib/format';
import { cn } from '../../lib/utils';
import { MetricCell } from '../primitives/MetricCell';

const USAGE_FIELDS = new Set<FieldKey>([
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
  'totalInput',
]);

/**
 * Formats a raw metric value for Compare's own "derived" treatment below.
 * Deliberately narrow, not a copy of `MetricCell`'s private `defaultFormat`:
 * Compare's row set is fixed (model, mode, duration, the three usage fields
 * shown elsewhere, subagent count), never `git`/`title`/`harnessVersion`/
 * `cost`, so it needs none of that formatter's object-shape guards.
 */
function defaultCompareFormat(field: FieldKey, value: unknown): string {
  if (field === 'durationMs' && typeof value === 'number') return formatDuration(value);
  if (USAGE_FIELDS.has(field) && typeof value === 'number') return formatTokens(value);
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return '';
}

export type CompareCellProps<T = unknown> = {
  metric?: Metric<T>;
  field: FieldKey;
  harness: HarnessId;
  /**
   * Capabilities for `harness`, hoisted by the caller exactly like
   * `MetricCell.capabilities` (design.md §4/§6) -- required but explicitly
   * nullable, `undefined` while `useStatus()` is still loading.
   */
  capabilities: readonly Capability[] | undefined;
  displayName?: string;
  format?: (value: T) => string;
};

/**
 * One Compare-matrix cell. Exactly the two D40 special treatments beyond
 * plain (docs/DECISIONS.md D40: "Compare has exactly two special
 * treatments: missing, derived. No separate 'genuinely incomparable' flag"):
 *
 * - **missing** -- no metric for this session/field. Diagonal-stripe
 *   background (a Tailwind arbitrary-value `repeating-linear-gradient`
 *   against `--border`, never a hex literal) + the literal text
 *   "Not reported". `absenceKind` (already used by `MetricCell`, reused
 *   rather than reinvented) still distinguishes capability-absent from
 *   field-absent for the tooltip/title text, exactly as `MetricCell` does
 *   for its own `n/a` vs `—` -- Compare just renders one visual treatment
 *   for both, per D40's "exactly two", rather than a third bucket.
 * - **derived** -- a metric is present but `confidence !== 'high'`: the
 *   harness's number was computed, not read off directly, so it may not be
 *   safely comparable to a plainly-reported peer. Amber text (the
 *   `--confidence-medium` token family, D36 -- confidence is a provenance
 *   color, never framed as good/bad) plus the metric's own `note`, rendered
 *   as visible text alongside the value, never color alone.
 * - anything else (a present, high-confidence metric) is **normal** and
 *   renders through `MetricCell` unchanged -- the same absence/provenance
 *   contract every other screen uses, no "winner" styling of any kind.
 *
 * Classification is read straight off the existing `Metric` shape
 * (`confidence`/`source`/`note`) and `capabilities` -- there is no new
 * comparison logic invented here, per this feature's own build guidance.
 */
export function CompareCell<T = unknown>({
  metric,
  field,
  harness,
  capabilities,
  displayName,
  format,
}: CompareCellProps<T>) {
  if (!metric) {
    const notProvided = absenceKind(field, capabilities) === 'not-provided';
    const title = notProvided
      ? `Not provided by ${displayName ?? harness}`
      : 'Missing in this session';
    return (
      <span
        data-compare-cell="missing"
        role="note"
        aria-label={`${title}. Not reported.`}
        title={title}
        className={cn(
          'inline-block rounded px-1.5 py-0.5 text-xs text-muted-foreground',
          'bg-[repeating-linear-gradient(135deg,var(--border),var(--border)_4px,transparent_4px,transparent_8px)]',
        )}
      >
        Not reported
      </span>
    );
  }

  if (metric.confidence !== 'high') {
    const formatted = format ? format(metric.value) : defaultCompareFormat(field, metric.value);
    const note = metric.note ?? 'Computed differently from a directly reported value.';
    return (
      <span
        data-compare-cell="derived"
        role="note"
        aria-label={`Derived value, ${formatted}: ${note}`}
        title={`${metric.source}${metric.note ? ` — ${metric.note}` : ''}`}
        // `bg-card` chip (f9 integration-hardening fix): the sibling "missing"
        // treatment above already renders on its own self-contained
        // background; this one used to render bare on whatever the row
        // happened to be showing behind it. `--confidence-medium` text
        // measured only 4.05-4.11:1 against this table's real
        // `hover:bg-muted/50` row state (independently recomputed WCAG
        // contrast) and 3.89:1 against a `data-[state=selected]:bg-muted`
        // row -- both below the 4.5:1 AA text bar the token passes cleanly
        // against `--card` (4.59:1). An opaque `bg-card` chip fixes the
        // surface this text sits on regardless of the row's hover/selected
        // state, the same way the "missing" chip above is self-contained.
        className="inline-flex flex-col gap-0.5 rounded bg-card px-1.5 py-0.5 text-[var(--confidence-medium)]"
      >
        <span className="tabular-nums">{formatted}</span>
        <span className="text-[10px] leading-tight">{note}</span>
      </span>
    );
  }

  return (
    <MetricCell<T>
      metric={metric}
      field={field}
      harness={harness}
      capabilities={capabilities}
      displayName={displayName}
      format={format}
    />
  );
}
