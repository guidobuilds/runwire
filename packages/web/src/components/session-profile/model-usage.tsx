import type { ModelUsageEntry, ModelUsageGroup } from '@runwire/core';
import { Cell, Pie, PieChart, type PieLabelRenderProps } from 'recharts';
import { type ChartConfig, ChartContainer } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { useSessionProfileModels } from '@/queries/session-profile';
import { readableModel } from './format';

export type ModelUsageProps = {
  sessionId: string;
  refresh?: number;
};

/** Same 9-slot `--token-model-N` palette the token chart uses (index.css). */
const MODEL_TOKEN_COUNT = 9;

/** Locale-safe percentage, one integer like `format.ts`'s number helpers. */
const shareFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
});

export function formatShare(share: number): string {
  return shareFormatter.format(share);
}

function sliceColor(index: number): string {
  return `var(--token-model-${(index % MODEL_TOKEN_COUNT) + 1})`;
}

/** Outside sector label: `readableModel(model) — NN%`. Recharts passes the
 * original datum through `payload`, so share-0 entries (never sliced) never
 * label either. */
function renderSliceLabel(props: PieLabelRenderProps): string {
  const entry = props.payload as ModelUsageEntry | undefined;
  if (!entry) return '';
  return `${readableModel(entry.model)} — ${formatShare(entry.share)}`;
}

function ModelDonut({ entries }: { entries: readonly ModelUsageEntry[] }) {
  const config = Object.fromEntries(
    entries.map((entry, index) => [
      entry.model,
      { label: readableModel(entry.model), color: sliceColor(index) },
    ]),
  ) satisfies ChartConfig;

  return (
    // Full-width (not a 200px square) so the SVG viewBox is as wide as the
    // cell; the old `aspect-square h-[200px]` left only ~100px on each side of
    // the center, which clipped the outside labels at the SVG edge. The pie
    // margins plus the reduced outerRadius keep the pie and its outside labels
    // inside that viewBox (f2-t7).
    <ChartContainer
      className="aspect-auto h-[220px] w-full [&_.recharts-pie-label-text]:text-[11px]"
      config={config}
    >
      <PieChart margin={{ top: 20, right: 84, bottom: 20, left: 84 }}>
        <Pie
          data={entries}
          dataKey="outputTokens"
          innerRadius={30}
          isAnimationActive={false}
          label={renderSliceLabel}
          labelLine
          nameKey="model"
          outerRadius={52}
          paddingAngle={2}
          stroke="var(--background)"
        >
          {entries.map((entry, index) => (
            <Cell fill={sliceColor(index)} key={entry.model} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

function ModelUsageGroupView({
  emptyLabel,
  group,
  label,
}: {
  emptyLabel: string;
  group: ModelUsageGroup;
  label: string;
}) {
  // Share-0 entries never become donut slices nor labels (f2-t6); a group with
  // no models at all is the only "empty" case, keeping the prior empty state.
  const slices = group.models.filter((entry) => entry.outputTokens > 0);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="font-medium text-sm">{label}</h3>
      {group.models.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      ) : slices.length > 0 ? (
        <ModelDonut entries={slices} />
      ) : null}
    </div>
  );
}

function ModelUsageSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

/** Per-model output-token shares for the session and its subagent descendants,
 * one labeled donut per group (f2's session details card). */
export function ModelUsage({ sessionId, refresh = 0 }: ModelUsageProps) {
  const query = useSessionProfileModels(sessionId, { refresh });

  if (query.isLoading) return <ModelUsageSkeleton />;

  if (query.isError) {
    return <p className="text-muted-foreground text-sm">Model usage unavailable</p>;
  }

  if (!query.data) return null;

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <ModelUsageGroupView
        emptyLabel="No model information recorded"
        group={query.data.session}
        label="Models in this session"
      />
      <ModelUsageGroupView
        emptyLabel="No subagent sessions"
        group={query.data.descendants}
        label="Models in subagent sessions"
      />
    </div>
  );
}
