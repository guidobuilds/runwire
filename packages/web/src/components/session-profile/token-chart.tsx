import type { Scope, TokenField } from '@scout/core';
import { Line, ComposedChart as RechartsComposedChart, ReferenceDot, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSessionProfileTimeline } from '@/queries/session-profile';
import { FIELD_LABELS, formatCompact, readableModel, TOKEN_FIELDS } from './format';
import { buildTimeDomain, toMs } from './time-scale';

export type TokenChartProps = {
  sessionId: string;
  field: TokenField;
  onFieldChange: (field: TokenField) => void;
  refresh?: number;
};

const CHART_TOKEN_COUNT = 5;
const scope: Scope = 'tree';

function seriesKey(index: number) {
  return `series-${index}`;
}

function seriesColor(index: number) {
  return `var(--chart-${(index % CHART_TOKEN_COUNT) + 1})`;
}

/** True when every point's `delta`/`cumulative` vector matches `series.length`
 * — F-7 guard from verification.md#f3. A mismatch means the response cannot
 * be trusted to attribute values to the right model, so no chart is drawn. */
function seriesLengthsConsistent(
  series: readonly { model: string }[],
  points: readonly { delta: readonly (number | null)[]; cumulative: readonly (number | null)[] }[],
): boolean {
  return points.every(
    (point) => point.delta.length === series.length && point.cumulative.length === series.length,
  );
}

type ChartDatum = Record<string, number | string | null> & { x: number; at: string };

/** Finds the running total known at or before `x` — used to place a spawn
 * marker on the total line at a plausible y, never fabricating a value beyond
 * what the line already shows. */
function totalAtOrBefore(data: readonly ChartDatum[], x: number): number | null {
  let value: number | null = null;
  for (const datum of data) {
    if (datum.x > x) break;
    const total = datum.total;
    value = typeof total === 'number' ? total : value;
  }
  return value;
}

export function TokenChart({ sessionId, field, onFieldChange, refresh = 0 }: TokenChartProps) {
  const timeline = useSessionProfileTimeline(sessionId, { scope, field, refresh });

  const fieldPicker = (
    <Select value={field} onValueChange={(value) => value && onFieldChange(value as TokenField)}>
      <SelectTrigger aria-label="Token field" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TOKEN_FIELDS.map((item) => (
          <SelectItem key={item} value={item}>
            {FIELD_LABELS[item]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token usage</CardTitle>
        <CardDescription>
          Cumulative {FIELD_LABELS[field].toLowerCase()} across the whole tree
        </CardDescription>
        <CardAction>{fieldPicker}</CardAction>
      </CardHeader>
      <CardContent>
        {timeline.isLoading ? <Skeleton className="h-[300px] w-full" /> : null}
        {timeline.isError ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-sm">
            <p className="text-muted-foreground">Token usage could not be loaded.</p>
            <Button onClick={() => void timeline.refetch()} size="sm" type="button">
              Retry
            </Button>
          </div>
        ) : null}
        {timeline.data ? <TokenChartBody data={timeline.data} field={field} /> : null}
      </CardContent>
    </Card>
  );
}

function TokenChartBody({
  data,
  field,
}: {
  data: NonNullable<ReturnType<typeof useSessionProfileTimeline>['data']>;
  field: TokenField;
}) {
  const { series, points, spawns, excludedNullAtCount } = data;

  if (!seriesLengthsConsistent(series, points)) {
    return (
      <div
        className="flex h-[300px] items-center justify-center text-destructive text-sm"
        role="alert"
      >
        Timeline data is inconsistent.
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center gap-1 text-sm">
        <p className="text-muted-foreground">No timed calls in this tree.</p>
        {excludedNullAtCount > 0 ? (
          <p className="text-muted-foreground text-xs">
            {excludedNullAtCount} call{excludedNullAtCount === 1 ? '' : 's'} without timestamp not
            shown.
          </p>
        ) : null}
      </div>
    );
  }

  const domainInputs = [
    { start: data.timeDomain.start, end: data.timeDomain.end },
    ...spawns.map((spawn) => ({ start: spawn.at, end: spawn.at })),
  ];
  const domain = buildTimeDomain(domainInputs);
  const usesIndex = domain === null;

  const chartData: ChartDatum[] = points.map((point, index) => {
    const x = usesIndex ? index : (toMs(point.at) ?? index);
    const datum: ChartDatum = { x, at: point.at, total: point.totalCumulative };
    for (let i = 0; i < series.length; i += 1) {
      datum[seriesKey(i)] = point.cumulative[i] ?? null;
    }
    return datum;
  });

  const config = Object.fromEntries(
    series.map((item, index) => [
      seriesKey(index),
      { label: readableModel(item.model), color: seriesColor(index) },
    ]),
  ) satisfies ChartConfig;
  config.total = { label: `Total ${FIELD_LABELS[field]}`, color: 'var(--foreground)' };

  const spawnDots = spawns
    .map((spawn) => {
      const spawnX = usesIndex
        ? chartData.findIndex((datum) => datum.at >= spawn.at)
        : (toMs(spawn.at) ?? null);
      if (spawnX === null || spawnX === -1) return null;
      const y = totalAtOrBefore(chartData, spawnX);
      if (y === null) return null;
      return { key: `${spawn.parentId}-${spawn.childId}-${spawn.at}`, x: spawnX, y, spawn };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer className="aspect-auto h-[300px] w-full" config={config}>
        <RechartsComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <XAxis
            axisLine={false}
            dataKey="x"
            domain={['dataMin', 'dataMax']}
            tickLine={false}
            type="number"
          />
          <YAxis
            axisLine={false}
            tickFormatter={(value) => formatCompact(value)}
            tickLine={false}
            width={48}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend />
          {series.map((item, index) => (
            <Line
              connectNulls={false}
              dataKey={seriesKey(index)}
              dot={false}
              key={item.model}
              name={readableModel(item.model)}
              stroke={seriesColor(index)}
              type="stepAfter"
            />
          ))}
          <Line
            connectNulls={false}
            dataKey="total"
            dot={false}
            name={`Total ${FIELD_LABELS[field]}`}
            stroke="var(--foreground)"
            strokeWidth={2}
            type="stepAfter"
          />
          {spawnDots.map(({ key, x, y, spawn }) => (
            <ReferenceDot
              key={key}
              r={4}
              shape={(dotProps) => (
                <g>
                  <title>Spawned {spawn.childId.slice(-8)}</title>
                  <circle
                    cx={dotProps.cx}
                    cy={dotProps.cy}
                    fill="var(--background)"
                    r={4}
                    stroke="var(--foreground)"
                    strokeWidth={2}
                  />
                </g>
              )}
              x={x}
              y={y}
            />
          ))}
        </RechartsComposedChart>
      </ChartContainer>
      {usesIndex ? (
        <p className="text-muted-foreground text-xs">
          Showing call order — timestamps unavailable for this tree.
        </p>
      ) : null}
      {excludedNullAtCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {excludedNullAtCount} call{excludedNullAtCount === 1 ? '' : 's'} without timestamp not
          shown.
        </p>
      ) : null}
    </div>
  );
}
