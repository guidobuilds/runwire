import { useAdapterCapabilities, useAdapterDisplayName } from '../api/queries';
import type { Capability, Confidence, HarnessId, Metric } from '../api/types';
import { absenceKind, type FieldKey } from '../lib/capabilities';
import { formatDate, formatDuration, formatTokens, formatUsd } from '../lib/format';
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
   * Capabilities for `harness`, supplied by the caller. Passing this makes the
   * cell provider-free: it opens **zero** query observers and renders with no
   * `QueryClientProvider` mounted (design.md §4 — props in, never fetch inside
   * primitives). Tables with many cells should hoist the lookup and pass this.
   */
  capabilities?: readonly Capability[];
  /** Adapter display name; only read when `capabilities` is supplied. */
  displayName?: string;
};

type MetricCellViewProps<T> = Omit<MetricCellProps<T>, 'capabilities' | 'displayName'> & {
  capabilities: readonly Capability[] | undefined;
  displayName: string;
};

export function ConfidenceMarker({ confidence }: { confidence: Confidence }) {
  if (confidence === 'high') return null;
  return (
    <span className="mr-0.5 select-none" aria-hidden="true">
      {confidence === 'medium' ? '~' : '?'}
    </span>
  );
}

function defaultFormat(field: FieldKey, value: unknown): string {
  if (field === 'durationMs' && typeof value === 'number') return formatDuration(value);
  if ((field === 'startedAt' || field === 'endedAt') && typeof value === 'string') {
    return formatDate(value);
  }
  if (field === 'cost' && isUsd(value)) return formatUsd(value);
  if (USAGE_FIELDS.has(field) && typeof value === 'number') return formatTokens(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return String(value);
}

function isUsd(value: unknown): value is { usd: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'usd' in value &&
    typeof (value as { usd: unknown }).usd === 'number'
  );
}

function provenanceTitle(metric: Metric<unknown>): string {
  if (metric.confidence === 'high' || !metric.note) return metric.source;
  return `${metric.source}\n${metric.note}`;
}

/**
 * Renders from props only — no hooks, no query subscription. Every branch of
 * `MetricCell` ends here.
 */
function MetricCellView<T>({
  metric,
  field,
  format,
  align = 'left',
  capabilities,
  displayName,
}: MetricCellViewProps<T>) {
  const alignClass = align === 'right' ? 'text-right tabular-nums' : 'text-left';

  if (!metric) {
    const notProvided = absenceKind(field, capabilities) === 'not-provided';
    const title = notProvided ? `Not provided by ${displayName}` : 'Missing in this session';
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

/** The status-subscribing path, used only when no `capabilities` prop is given. */
function ConnectedMetricCell<T>(props: Omit<MetricCellProps<T>, 'capabilities' | 'displayName'>) {
  const capabilities = useAdapterCapabilities(props.harness);
  const displayName = useAdapterDisplayName(props.harness);
  return <MetricCellView<T> {...props} capabilities={capabilities} displayName={displayName} />;
}

/**
 * Calls no hooks itself: it picks between a provider-free view and the
 * status-subscribing wrapper, so supplying `capabilities` really does open zero
 * query observers. Callers must not flip a cell between the two modes — the
 * component type changes, which remounts it.
 */
export function MetricCell<T = unknown>({
  capabilities,
  displayName,
  ...rest
}: MetricCellProps<T>) {
  if (capabilities !== undefined) {
    return (
      <MetricCellView<T>
        {...rest}
        capabilities={capabilities}
        displayName={displayName ?? rest.harness}
      />
    );
  }
  return <ConnectedMetricCell<T> {...rest} />;
}
