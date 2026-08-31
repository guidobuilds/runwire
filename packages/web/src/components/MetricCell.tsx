import { useAdapterCapabilities, useAdapterDisplayName } from '../api/queries';
import type { Capability, Confidence, HarnessId, Metric } from '../api/types';
import { absenceKind, type FieldKey } from '../lib/capabilities';
import {
  formatDate,
  formatDuration,
  formatGit,
  formatTokens,
  formatUnknownValue,
  formatUsd,
  formatVersionRange,
  type GitFacts,
  UNFORMATTED,
} from '../lib/format';
import { Tooltip } from './ui/Tooltip';

const USAGE_FIELDS = new Set<FieldKey>([
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
  'totalInput',
]);

/**
 * Both absence states share one legible tone: zinc-500 is 4.83:1 on white and
 * zinc-400 is 7.56:1 on zinc-950, i.e. both clear WCAG AA (4.5:1). The two
 * states are told apart by their glyph (`n/a` vs `—`), never by colour or by
 * hover alone — design.md §5.
 */
const ABSENCE_TONE = 'text-zinc-500 dark:text-zinc-400';

export type MetricCellProps<T = unknown> = {
  metric?: Metric<T>;
  field: FieldKey;
  harness: HarnessId;
  format?: (value: T) => string;
  align?: 'left' | 'right';
  /**
   * Capabilities for `harness`, supplied by the caller (design.md §4 — props
   * in, never fetch inside primitives). The cell opens **zero** query observers
   * and renders with no `QueryClientProvider` mounted, always.
   *
   * Required, but explicitly nullable: pass `undefined` while `useStatus()` is
   * still loading. `absenceKind` treats `undefined` as `missing`, its
   * documented loading behaviour, and — unlike the dispatcher this replaced —
   * handing over a value later re-renders the cell instead of remounting it
   * (BL-2). Callers that want the lookup done for them use
   * `ConnectedMetricCell`.
   */
  capabilities: readonly Capability[] | undefined;
  /** Adapter display name; falls back to the harness id. */
  displayName?: string;
};

/**
 * The `~` / `?` grading glyph. `role="img"` + `aria-label` because the glyph is
 * a picture of the grade, not a word: assistive technology reads "medium
 * confidence" where a sighted user sees `~`, and the rendered markup is
 * otherwise unchanged. It was `aria-hidden` until BL-3 — the number and the
 * provenance note reached assistive technology, the grading did not, which is
 * the one signal this marker exists to carry.
 */
export function ConfidenceMarker({ confidence }: { confidence: Confidence }) {
  if (confidence === 'high') return null;
  return (
    <span
      className="mr-0.5 select-none"
      role="img"
      aria-label={confidence === 'medium' ? 'medium confidence' : 'low confidence'}
    >
      {confidence === 'medium' ? '~' : '?'}
    </span>
  );
}

function defaultFormat(field: FieldKey, value: unknown): string {
  // The try wraps the whole routing decision, not just the JSON fallback: every
  // type guard below reads properties off `value`, and a property read can
  // throw (a getter, a Proxy). The `String(value)` fallback this replaced could
  // not throw, so guarding only `JSON.stringify` would have turned a cosmetic
  // defect into a render-time crash — nothing above a cell is an error
  // boundary (ADV-2).
  try {
    if (field === 'durationMs' && typeof value === 'number') return formatDuration(value);
    if ((field === 'startedAt' || field === 'endedAt') && typeof value === 'string') {
      return formatDate(value);
    }
    if (field === 'cost' && isUsd(value)) return formatUsd(value);
    if (field === 'git' && isGitFacts(value)) return formatGit(value);
    if (field === 'title' && isTitleFacts(value)) return value.value;
    if (field === 'harnessVersion' && isVersionRange(value)) return formatVersionRange(value);
    if (USAGE_FIELDS.has(field) && typeof value === 'number') return formatTokens(value);
    // Never `String(value)`: every non-primitive would render as the literal text
    // `[object Object]` — wrong output with no error and no failing test (BL-1).
    return formatUnknownValue(value);
  } catch {
    return UNFORMATTED;
  }
}

function isUsd(value: unknown): value is { usd: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'usd' in value &&
    typeof (value as { usd: unknown }).usd === 'number'
  );
}

const GIT_KEYS = ['branch', 'commit', 'repoName'] as const;

/**
 * `SessionSummary.git` shape: every present key is a string, and at least one
 * carries content. An object that fails either half is not git facts and falls
 * through to `formatUnknownValue` rather than rendering as an empty cell.
 */
function isGitFacts(value: unknown): value is GitFacts {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const wellTyped = GIT_KEYS.every(
    (key) => candidate[key] === undefined || typeof candidate[key] === 'string',
  );
  const hasContent = GIT_KEYS.some(
    (key) => typeof candidate[key] === 'string' && (candidate[key] as string).trim() !== '',
  );
  return wellTyped && hasContent;
}

/**
 * `SessionSummary.title` shape: a non-empty `value` string, and `contentDerived`
 * — when present — a boolean. Same discipline as `isGitFacts`: content is
 * required, not just well-typed keys, so a foreign object with an empty `value`
 * falls through to `formatUnknownValue` instead of rendering an empty cell.
 * Narrowed to what the formatter reads rather than to `TitleFacts`, whose
 * `contentDerived` is non-optional.
 */
function isTitleFacts(value: unknown): value is { value: string } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const derived = candidate.contentDerived;
  if (derived !== undefined && typeof derived !== 'boolean') return false;
  const text = candidate.value;
  return typeof text === 'string' && text.trim() !== '';
}

const VERSION_KEYS = ['first', 'last'] as const;

/**
 * `SessionSummary.harnessVersion` shape: every present end is a string and at
 * least one carries content. Narrowed to a partial rather than to
 * `VersionRange` (both ends non-optional there) because a half-populated range
 * is still formattable.
 */
function isVersionRange(value: unknown): value is { first?: string; last?: string } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const wellTyped = VERSION_KEYS.every(
    (key) => candidate[key] === undefined || typeof candidate[key] === 'string',
  );
  const hasContent = VERSION_KEYS.some(
    (key) => typeof candidate[key] === 'string' && (candidate[key] as string).trim() !== '',
  );
  return wellTyped && hasContent;
}

function provenanceTitle(metric: Metric<unknown>): string {
  if (metric.confidence === 'high' || !metric.note) return metric.source;
  return `${metric.source}\n${metric.note}`;
}

/**
 * Renders from props only — no hooks, no query subscription, no provider
 * required. This is the whole component: there is deliberately **no** branch
 * that swaps in a different component type, because doing so remounted every
 * cell the moment a hoisted `capabilities` value resolved (BL-2).
 */
export function MetricCell<T = unknown>({
  metric,
  field,
  harness,
  format,
  align = 'left',
  capabilities,
  displayName,
}: MetricCellProps<T>) {
  const alignClass = align === 'right' ? 'text-right tabular-nums' : 'text-left';

  if (!metric) {
    const notProvided = absenceKind(field, capabilities) === 'not-provided';
    const title = notProvided
      ? `Not provided by ${displayName ?? harness}`
      : 'Missing in this session';
    return (
      <Tooltip content={title} className={`inline-block ${alignClass}`}>
        <span className={ABSENCE_TONE}>{notProvided ? 'n/a' : '—'}</span>
      </Tooltip>
    );
  }

  const formatted = format ? format(metric.value) : defaultFormat(field, metric.value);
  const muted = metric.confidence !== 'high';
  const low = metric.confidence === 'low';
  const valueClass = [
    muted ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-800 dark:text-zinc-100',
    low ? 'underline decoration-dashed decoration-zinc-400 dark:decoration-zinc-500' : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tooltip content={provenanceTitle(metric)} className={`inline-block ${alignClass}`}>
      <span className={valueClass}>
        <ConfidenceMarker confidence={metric.confidence} />
        {formatted}
      </span>
    </Tooltip>
  );
}

export type ConnectedMetricCellProps<T = unknown> = Omit<
  MetricCellProps<T>,
  'capabilities' | 'displayName'
>;

/**
 * Convenience wrapper for a one-off cell: resolves `capabilities` and
 * `displayName` from `useStatus()` itself, at the cost of 2 `QueryObserver`s
 * per instance and a mounted `QueryClientProvider`.
 *
 * **Never use this inside session tables, compare matrices or detail panels.**
 * Bulk callers hoist `useAdapterCapabilities`/`useAdapterDisplayName` once and
 * pass the results to `MetricCell` as props — ~4400 observers across 2200 cells
 * otherwise (design.md §5/§6).
 */
export function ConnectedMetricCell<T = unknown>(props: ConnectedMetricCellProps<T>) {
  const capabilities = useAdapterCapabilities(props.harness);
  const displayName = useAdapterDisplayName(props.harness);
  return <MetricCell<T> {...props} capabilities={capabilities} displayName={displayName} />;
}
