import type { Scope, TokenField } from '@scout/core';
import { Bot, ZoomIn } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Brush,
  Line,
  ComposedChart as RechartsComposedChart,
  ReferenceArea,
  ReferenceDot,
  XAxis,
  YAxis,
} from 'recharts';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSessionProfileTimeline } from '@/queries/session-profile';
import { FIELD_LABELS, formatCompact, formatDuration, readableModel, TOKEN_FIELDS } from './format';
import { buildTimeDomain, toMs } from './time-scale';

export type TokenChartProps = {
  sessionId: string;
  initialField?: TokenField;
  refresh?: number;
};

const CHART_TOKEN_COUNT = 9;
const MIN_ACTIVITY_GAP_MS = 30 * 60 * 1000;
const ACTIVITY_GAP_MULTIPLIER = 5;
const COMPRESSED_GAPS_SHARE = 0.12;
const scope: Scope = 'tree';

type TimelineMode = 'compressed' | 'wall-clock';

type ActivityGap = {
  start: number;
  end: number;
  duration: number;
  displayDuration: number;
};

const timelineTickFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  month: 'short',
});

const timelineTooltipFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

function formatTimelineTick(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : timelineTickFormatter.format(date);
}

function formatTimelineTooltip(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : timelineTooltipFormatter.format(date);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/** Finds unusually long periods between token observations. Long intervals are
 * excluded from the baseline so a pause does not define itself as "normal". */
function findActivityGaps(data: readonly ChartDatum[]): ActivityGap[] {
  const times = [...new Set(data.map((datum) => datum.x))].sort((a, b) => a - b);
  const intervals = times.slice(1).map((time, index) => time - (times[index] ?? time));
  if (intervals.length === 0) return [];

  const baselineIntervals = intervals.filter((duration) => duration <= MIN_ACTIVITY_GAP_MS);
  const typicalInterval =
    baselineIntervals.length > 0 ? median(baselineIntervals) : MIN_ACTIVITY_GAP_MS / 5;
  const threshold = Math.max(MIN_ACTIVITY_GAP_MS, typicalInterval * ACTIVITY_GAP_MULTIPLIER);
  const gaps = intervals.flatMap((duration, index) => {
    const start = times[index];
    const end = times[index + 1];
    return duration > threshold && start !== undefined && end !== undefined
      ? [{ start, end, duration, displayDuration: 0 }]
      : [];
  });
  if (gaps.length === 0) return [];

  const fullDuration = (times.at(-1) ?? 0) - (times[0] ?? 0);
  const inactiveDuration = gaps.reduce((sum, gap) => sum + gap.duration, 0);
  const activeDuration = Math.max(fullDuration - inactiveDuration, 60 * 1000);
  const displayDuration =
    (activeDuration * COMPRESSED_GAPS_SHARE) / ((1 - COMPRESSED_GAPS_SHARE) * gaps.length);
  return gaps.map((gap) => ({ ...gap, displayDuration }));
}

function compressTime(value: number, gaps: readonly ActivityGap[]): number {
  let removed = 0;
  for (const gap of gaps) {
    if (value >= gap.end) {
      removed += gap.duration - gap.displayDuration;
      continue;
    }
    if (value > gap.start) {
      const progress = (value - gap.start) / gap.duration;
      return gap.start - removed + progress * gap.displayDuration;
    }
    break;
  }
  return value - removed;
}

function expandTime(value: number, gaps: readonly ActivityGap[]): number {
  let removed = 0;
  for (const gap of gaps) {
    const displayStart = gap.start - removed;
    const displayEnd = displayStart + gap.displayDuration;
    if (value > displayEnd) {
      removed += gap.duration - gap.displayDuration;
      continue;
    }
    if (value >= displayStart) {
      const progress = (value - displayStart) / gap.displayDuration;
      return gap.start + progress * gap.duration;
    }
    break;
  }
  return value + removed;
}

function nearestDataIndex(data: readonly ChartDatum[], value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || data.length === 0) return null;
  const first = data[0];
  if (!first) return null;
  let nearest = 0;
  let nearestDistance = Math.abs(first.x - value);
  for (let index = 1; index < data.length; index += 1) {
    const datum = data[index];
    if (!datum) continue;
    const distance = Math.abs(datum.x - value);
    if (distance >= nearestDistance) continue;
    nearest = index;
    nearestDistance = distance;
  }
  return nearest;
}

function seriesKey(index: number) {
  return `series-${index}`;
}

function seriesColor(index: number) {
  return `var(--token-model-${(index % CHART_TOKEN_COUNT) + 1})`;
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

export function TokenChart({ sessionId, initialField = 'output', refresh = 0 }: TokenChartProps) {
  const [field, setField] = useState<TokenField>(initialField);
  const timeline = useSessionProfileTimeline(sessionId, { scope, field, refresh });

  const fieldPicker = (
    <Select value={field} onValueChange={(value) => value && setField(value as TokenField)}>
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
        {timeline.data ? (
          <TokenChartBody data={timeline.data} field={field} key={`${sessionId}:${field}`} />
        ) : null}
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
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('compressed');
  const [zoomRange, setZoomRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [dragSelection, setDragSelection] = useState<{
    startIndex: number;
    currentIndex: number;
  } | null>(null);
  const { series, points, spawns, excludedNullAtCount } = data;

  const { usesIndex, rawChartData, activityGaps } = useMemo(() => {
    const domainInputs = [
      { start: data.timeDomain.start, end: data.timeDomain.end },
      ...spawns.map((spawn) => ({ start: spawn.at, end: spawn.at })),
    ];
    const domain = buildTimeDomain(domainInputs);
    const usesIndex = domain === null;
    const rawChartData: ChartDatum[] = points.map((point, index) => {
      const x = usesIndex ? index : (toMs(point.at) ?? index);
      const datum: ChartDatum = { x, at: point.at, total: point.totalCumulative };
      for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
        datum[seriesKey(seriesIndex)] = point.cumulative[seriesIndex] ?? null;
      }
      return datum;
    });
    return {
      usesIndex,
      rawChartData,
      activityGaps: usesIndex ? [] : findActivityGaps(rawChartData),
    };
  }, [data.timeDomain.end, data.timeDomain.start, points, series, spawns]);

  const compressesGaps = timelineMode === 'compressed' && activityGaps.length > 0;
  const chartData = useMemo(
    () =>
      compressesGaps
        ? rawChartData.map((datum) => ({ ...datum, x: compressTime(datum.x, activityGaps) }))
        : rawChartData,
    [activityGaps, compressesGaps, rawChartData],
  );

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

  const lastDataIndex = Math.max(chartData.length - 1, 0);
  const zoomStartIndex = Math.min(zoomRange?.startIndex ?? 0, lastDataIndex);
  const zoomEndIndex = Math.max(
    zoomStartIndex,
    Math.min(zoomRange?.endIndex ?? lastDataIndex, lastDataIndex),
  );
  const isZoomed = zoomStartIndex > 0 || zoomEndIndex < lastDataIndex;
  const brushGap = Math.max(1, Math.floor(chartData.length / 200));

  function finishDragSelection() {
    if (!dragSelection) return;
    const startIndex = Math.min(dragSelection.startIndex, dragSelection.currentIndex);
    const endIndex = Math.max(dragSelection.startIndex, dragSelection.currentIndex);
    if (startIndex !== endIndex) setZoomRange({ startIndex, endIndex });
    setDragSelection(null);
  }

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
      const displayX = compressesGaps ? compressTime(spawnX, activityGaps) : spawnX;
      const y = totalAtOrBefore(chartData, displayX);
      if (y === null) return null;
      return { key: `${spawn.parentId}-${spawn.childId}-${spawn.at}`, x: displayX, y, spawn };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <ZoomIn aria-hidden="true" size={14} />
          Drag across the chart or use the timeline handles to zoom
        </span>
        <div className="flex items-center gap-2">
          {isZoomed ? (
            <Button onClick={() => setZoomRange(null)} size="sm" type="button" variant="ghost">
              Reset zoom
            </Button>
          ) : null}
          {activityGaps.length > 0 ? (
            <ToggleGroup
              aria-label="Timeline scale"
              multiple={false}
              onValueChange={(value) => setTimelineMode((value[0] as TimelineMode) ?? 'compressed')}
              size="sm"
              value={[timelineMode]}
              variant="outline"
            >
              <ToggleGroupItem value="compressed">Compressed</ToggleGroupItem>
              <ToggleGroupItem value="wall-clock">Wall clock</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </div>
      </div>
      <ChartContainer className="aspect-auto h-[340px] w-full" config={config}>
        <RechartsComposedChart
          data={chartData}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
          onMouseDown={(state) => {
            const index = nearestDataIndex(chartData, state?.activeLabel);
            if (index !== null) setDragSelection({ startIndex: index, currentIndex: index });
          }}
          onMouseLeave={() => setDragSelection(null)}
          onMouseMove={(state) => {
            if (!dragSelection) return;
            const index = nearestDataIndex(chartData, state?.activeLabel);
            if (index !== null) setDragSelection({ ...dragSelection, currentIndex: index });
          }}
          onMouseUp={finishDragSelection}
          style={{ cursor: dragSelection ? 'col-resize' : 'crosshair', userSelect: 'none' }}
        >
          <XAxis
            axisLine={false}
            dataKey="x"
            domain={['dataMin', 'dataMax']}
            minTickGap={32}
            tickFormatter={(value: number) =>
              usesIndex
                ? `#${Math.round(value) + 1}`
                : formatTimelineTick(compressesGaps ? expandTime(value, activityGaps) : value)
            }
            tickLine={false}
            type="number"
          />
          <YAxis
            axisLine={false}
            tickFormatter={(value) => formatCompact(value)}
            tickLine={false}
            width={48}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  formatTimelineTooltip(payload[0]?.payload?.at ?? payload[0]?.payload?.x)
                }
              />
            }
          />
          <ChartLegend />
          {compressesGaps
            ? activityGaps.map((gap) => (
                <ReferenceArea
                  fill="var(--muted)"
                  fillOpacity={0.9}
                  key={`${gap.start}-${gap.end}`}
                  label={{
                    fill: 'var(--muted-foreground)',
                    fontSize: 11,
                    position: 'insideTop',
                    value: `No token activity · ${formatDuration(gap.duration)}`,
                  }}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                  x1={compressTime(gap.start, activityGaps)}
                  x2={compressTime(gap.end, activityGaps)}
                />
              ))
            : null}
          {dragSelection ? (
            <ReferenceArea
              fill="var(--token-model-1)"
              fillOpacity={0.12}
              ifOverflow="hidden"
              stroke="var(--token-model-1)"
              strokeOpacity={0.5}
              x1={chartData[dragSelection.startIndex]?.x}
              x2={chartData[dragSelection.currentIndex]?.x}
            />
          ) : null}
          {series.map((item, index) => (
            <Line
              connectNulls={false}
              dataKey={seriesKey(index)}
              dot={false}
              key={item.model}
              name={readableModel(item.model)}
              stroke={seriesColor(index)}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              type="monotone"
            />
          ))}
          <Line
            connectNulls={false}
            dataKey="total"
            dot={false}
            name={`Total ${FIELD_LABELS[field]}`}
            stroke="var(--foreground)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            type="monotone"
          />
          {spawnDots.map(({ key, x, y, spawn }) => (
            <ReferenceDot
              key={key}
              r={9}
              shape={(dotProps) => (
                <g>
                  <title>
                    Spawned subagent {spawn.childId.slice(-8)} at {formatTimelineTooltip(spawn.at)}
                  </title>
                  <circle
                    cx={dotProps.cx}
                    cy={dotProps.cy}
                    fill="var(--foreground)"
                    r={9}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                  <Bot
                    aria-hidden="true"
                    color="var(--background)"
                    height={12}
                    strokeWidth={2.5}
                    width={12}
                    x={(dotProps.cx ?? 0) - 6}
                    y={(dotProps.cy ?? 0) - 6}
                  />
                </g>
              )}
              x={x}
              y={y}
            />
          ))}
          <Brush
            dataKey="x"
            endIndex={zoomEndIndex}
            fill="var(--background)"
            gap={brushGap}
            height={28}
            onChange={(range) => {
              const startIndex = range.startIndex ?? 0;
              const endIndex = range.endIndex ?? lastDataIndex;
              setZoomRange(
                startIndex === 0 && endIndex === lastDataIndex ? null : { startIndex, endIndex },
              );
            }}
            startIndex={zoomStartIndex}
            stroke="var(--muted-foreground)"
            tickFormatter={(value: number) =>
              usesIndex
                ? `#${Math.round(value) + 1}`
                : formatTimelineTick(compressesGaps ? expandTime(value, activityGaps) : value)
            }
            travellerWidth={8}
          />
        </RechartsComposedChart>
      </ChartContainer>
      {spawnDots.length > 0 ? (
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
            <Bot aria-hidden="true" size={12} strokeWidth={2.5} />
          </span>
          <span>Subagent spawned at this point</span>
        </div>
      ) : null}
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
