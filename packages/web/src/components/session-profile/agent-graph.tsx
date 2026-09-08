import type { Event, ProfileNode, ProfileSpawnsResponse, SpawnItem } from '@scout/core';
import { Clock3, GitBranch, HelpCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  ComposedChart as RechartsComposedChart,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { useSessionProfileMergedEvents, useSessionProfileSpawns } from '@/queries/session-profile';
import { AgentGraphConnectors } from './agent-graph-connectors';
import { formatDuration } from './format';
import { buildTimeDomain, toMs } from './time-scale';

export type AgentGraphRootSession = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  agentType?: string | null;
};

export type AgentGraphProps = {
  sessionId: string;
  rootSession: AgentGraphRootSession;
  refresh?: number;
  onOpenNode: (nodeId: string) => void;
  /** Reports the whole tree's subagent count (`nodes.length - 1`, root
   * excluded) once every `spawns` page has been fetched and the node list is
   * therefore complete — never called while loading, still paging, or
   * errored, and never called twice in a row with the same value (design.md
   * "Signals accordion (G5)": the signals panel's subagent count is derived
   * from this already-fetched node list, not a second reader). */
  onNodeCount?: (count: number) => void;
};

type Row = {
  id: string;
  label: string;
  startedAt: string | null;
  endedAt: string | null;
  /** This row's own spawn instant, from its own `SpawnItem.callAt` — null
   * for the root and for a row with no linked spawn instant (unlinked child
   * or orphan: G4 hangs from root, unlabelled, no connector). */
  callAt: string | null;
  /** The row this row's connector originates from — the actual
   * `SpawnItem.parent.id` it was reached through (never hardcoded to the
   * root), or null for the root and for an orphan node reached through no
   * edge at all. */
  parentRowId: string | null;
  /** Tree depth from the root (root = 0); used only for the optional visual
   * indent cue (F-11), never for row inclusion. */
  depth: number;
  /** For each ancestor level, whether that ancestor has a following sibling.
   * Used to continue the vertical tree guide through this row. */
  ancestorHasNextSibling: readonly boolean[];
  /** Whether this node is the final child of its parent. */
  isLastSibling: boolean;
  isRoot: boolean;
};

const SIGNALS_LIMIT = 200;

function shortId(id: string): string {
  const tail = id.split(/[/:]/).pop() ?? id;
  return tail.length > 14 ? `…${tail.slice(-12)}` : tail;
}

function labelFor(node: ProfileNode | AgentGraphRootSession): string {
  return node.agentType ?? shortId(node.id);
}

function spawnItemSortKeyMs(item: SpawnItem): number {
  const ms = toMs(item.callAt ?? item.child?.startedAt ?? null);
  return ms ?? Number.POSITIVE_INFINITY;
}

/** Builds one row per node reachable from the root by any chain of
 * `SpawnItem`s — a transitive walk of the parent→child adjacency, not
 * limited to direct children of the root. `readProfileSpawns` (core) already
 * returns every parent→child edge in scope depth-agnostically (a subagent
 * branches off its own parent, not necessarily the root — G6); this walk
 * follows that adjacency so `scope=tree` genuinely covers the whole subtree
 * (G2), including a depth-2+ nested spawn (e.g. an OpenCode-style nested
 * agent). A node present in `nodes` but unreachable through any edge (an
 * orphan, or a session with no `SpawnItem` at all) still gets a row,
 * appended after the tree, hanging from the root unlabelled with no
 * connector (G4) — so `rows.length` always equals the in-scope node count.
 * Row order: root, then depth-first pre-order with siblings ordered by
 * `callAt ?? child.startedAt`. */
function buildRows(
  rootSession: AgentGraphRootSession,
  pages: readonly ProfileSpawnsResponse[],
): Row[] {
  const nodeById = new Map<string, ProfileNode>();
  for (const page of pages) {
    for (const n of page.nodes) nodeById.set(n.id, n);
  }

  // One edge per child, deduped by child id (a node has exactly one
  // parent), grouped by the item's own parent — never hardcoded to root.
  const childrenByParent = new Map<string, SpawnItem[]>();
  const seenChild = new Set<string>();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.child === null || !nodeById.has(item.child.id)) continue;
      if (seenChild.has(item.child.id)) continue;
      seenChild.add(item.child.id);
      const group = childrenByParent.get(item.parent.id);
      if (group) group.push(item);
      else childrenByParent.set(item.parent.id, [item]);
    }
  }
  for (const group of childrenByParent.values()) {
    group.sort((a, b) => spawnItemSortKeyMs(a) - spawnItemSortKeyMs(b));
  }

  const rootRow: Row = {
    id: rootSession.id,
    label: labelFor(rootSession),
    startedAt: rootSession.startedAt,
    endedAt: rootSession.endedAt,
    callAt: null,
    parentRowId: null,
    depth: 0,
    ancestorHasNextSibling: [],
    isLastSibling: true,
    isRoot: true,
  };
  const rows: Row[] = [rootRow];
  // Also guards a malformed parent cycle from recursing forever via a
  // visible-ancestor-set guard.
  const visited = new Set<string>([rootSession.id]);

  function walk(parentRowId: string, depth: number, ancestorHasNextSibling: readonly boolean[]) {
    const children = childrenByParent.get(parentRowId) ?? [];
    for (const [index, item] of children.entries()) {
      const child = item.child as ProfileNode;
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const isLastSibling = index === children.length - 1;
      rows.push({
        id: child.id,
        label: labelFor(child),
        startedAt: child.startedAt,
        endedAt: child.endedAt,
        callAt: item.callAt,
        parentRowId,
        depth,
        ancestorHasNextSibling,
        isLastSibling,
        isRoot: false,
      });
      walk(child.id, depth + 1, [...ancestorHasNextSibling, !isLastSibling]);
    }
  }
  walk(rootSession.id, 1, []);

  for (const page of pages) {
    for (const n of page.nodes) {
      if (visited.has(n.id)) continue;
      visited.add(n.id);
      rows.push({
        id: n.id,
        label: labelFor(n),
        startedAt: n.startedAt,
        endedAt: n.endedAt,
        callAt: null,
        parentRowId: null,
        depth: 1,
        ancestorHasNextSibling: [],
        isLastSibling: true,
        isRoot: false,
      });
    }
  }

  return rows;
}

const ROW_HEIGHT = 36;
const TREE_LEVEL_INDENT = 20;
const MIN_CHART_HEIGHT = 150;
const MAX_VIEWPORT_HEIGHT = 560;
const MIN_GAP_MS = 30 * 60 * 1000;
const GAP_MULTIPLIER = 5;
const COMPRESSED_GAPS_SHARE = 0.1;

type TimelineMode = 'compressed' | 'wall-clock';

type TimelineGap = {
  start: number;
  end: number;
  duration: number;
  displayDuration: number;
};

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/** Compresses only unusually long periods with no recorded start, end, spawn,
 * or signal. It deliberately calls these "timeline gaps", not inactivity:
 * the profile data cannot prove that an agent did no work during the gap. */
function findTimelineGaps(timesInput: readonly number[]): TimelineGap[] {
  const times = [...new Set(timesInput)].sort((a, b) => a - b);
  const intervals = times.slice(1).map((time, index) => time - (times[index] ?? time));
  if (intervals.length === 0) return [];
  const baseline = intervals.filter((duration) => duration <= MIN_GAP_MS);
  const typical = baseline.length > 0 ? median(baseline) : MIN_GAP_MS / 5;
  const threshold = Math.max(MIN_GAP_MS, typical * GAP_MULTIPLIER);
  const gaps = intervals.flatMap((duration, index) => {
    const start = times[index];
    const end = times[index + 1];
    return duration > threshold && start !== undefined && end !== undefined
      ? [{ start, end, duration, displayDuration: 0 }]
      : [];
  });
  if (gaps.length === 0) return [];
  const fullDuration = (times.at(-1) ?? 0) - (times[0] ?? 0);
  const removedDuration = gaps.reduce((sum, gap) => sum + gap.duration, 0);
  const observedDuration = Math.max(fullDuration - removedDuration, 60_000);
  const displayDuration =
    (observedDuration * COMPRESSED_GAPS_SHARE) / ((1 - COMPRESSED_GAPS_SHARE) * gaps.length);
  return gaps.map((gap) => ({ ...gap, displayDuration }));
}

function compressTime(value: number, gaps: readonly TimelineGap[]): number {
  let removed = 0;
  for (const gap of gaps) {
    if (value >= gap.end) {
      removed += gap.duration - gap.displayDuration;
      continue;
    }
    if (value > gap.start) {
      return gap.start - removed + ((value - gap.start) / gap.duration) * gap.displayDuration;
    }
    break;
  }
  return value - removed;
}

function expandTime(value: number, gaps: readonly TimelineGap[]): number {
  let removed = 0;
  for (const gap of gaps) {
    const displayStart = gap.start - removed;
    const displayEnd = displayStart + gap.displayDuration;
    if (value > displayEnd) {
      removed += gap.duration - gap.displayDuration;
      continue;
    }
    if (value >= displayStart) {
      return gap.start + ((value - displayStart) / gap.displayDuration) * gap.duration;
    }
    break;
  }
  return value + removed;
}

const axisDateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  month: 'short',
});

const tooltipDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

type MarkerKind = 'error' | 'compaction' | 'model-change' | 'mcp' | 'skill' | 'agent' | 'other';

const MARKER_COLOR: Record<MarkerKind, string> = {
  error: 'var(--destructive)',
  compaction: 'var(--chart-1)',
  'model-change': 'var(--chart-2)',
  mcp: 'var(--chart-3)',
  skill: 'var(--chart-4)',
  agent: 'var(--chart-5)',
  other: 'var(--muted-foreground)',
};

const MARKER_LABEL: Record<MarkerKind, string> = {
  error: 'Error',
  compaction: 'Compaction',
  'model-change': 'Model change',
  mcp: 'MCP call',
  skill: 'Skill call',
  agent: 'Agent call',
  other: 'Other',
};

function markerKind(event: Event): MarkerKind {
  if (event.error === true) return 'error';
  if (event.kind === 'compaction') return 'compaction';
  if (event.kind === 'model-change') return 'model-change';
  if (event.kind === 'tool') {
    if (event.category === 'mcp') return 'mcp';
    if (event.category === 'skill') return 'skill';
    if (event.category === 'agent') return 'agent';
  }
  return 'other';
}

/** Metadata-only detail string — tool identity/category/trigger, never
 * tool input/output or free text. */
function markerDetail(event: Event): string {
  switch (event.kind) {
    case 'compaction':
      return `trigger: ${event.trigger ?? 'unknown'}`;
    case 'model-change':
      return `${event.from ?? '?'} → ${event.to ?? '?'}`;
    case 'tool':
      return event.toolName ?? event.category ?? 'unknown tool';
    default:
      return event.kind;
  }
}

/** Agent git-graph: one horizontal lifespan bar per agent on a shared
 * wall-clock axis, branches drawn from the parent row at the spawn call's
 * instant to the child row at its own start, and signal events as markers on
 * the owning row. */
export function AgentGraph({
  sessionId,
  rootSession,
  refresh = 0,
  onOpenNode,
  onNodeCount,
}: AgentGraphProps) {
  const spawns = useSessionProfileSpawns(sessionId, { scope: 'tree', refresh });
  const signals = useSessionProfileMergedEvents(sessionId, {
    scope: 'tree',
    filter: 'signals',
    limit: SIGNALS_LIMIT,
    offset: 0,
    refresh,
  });

  // Exhausts every page client-side: the graph needs the whole tree, not a
  // partial page. Runs on every render (no dependency array) since
  // `fetchNextPage`'s identity is not guaranteed stable across renders;
  // `hasNextPage`/`isFetchingNextPage` guard it from looping once exhausted.
  useEffect(() => {
    if (spawns.hasNextPage && !spawns.isFetchingNextPage) void spawns.fetchNextPage();
  });

  const stillPaging = spawns.hasNextPage === true;
  const loading = spawns.isLoading || (stillPaging && spawns.data === undefined);

  // The whole-tree node count is only meaningful once every page has been
  // fetched (not loading, not still paging, no error) — matches design.md's
  // "Signals accordion (G5)" contract (`nodes.length - 1`), sourced from this
  // component's own already-fetched pages rather than a second reader.
  const nodeCount = useMemo(() => {
    if (loading || stillPaging || spawns.isError || !spawns.data) return null;
    const ids = new Set<string>();
    for (const page of spawns.data.pages) {
      for (const n of page.nodes) ids.add(n.id);
    }
    return ids.size;
  }, [loading, stillPaging, spawns.isError, spawns.data]);

  const lastReportedNodeCount = useRef<number | null>(null);
  // A session/refresh change starts a fresh fetch (nodeCount briefly becomes
  // null again); reset the "already reported" guard during render (not an
  // effect keyed on sessionId/refresh, which those values would only be
  // read for, never used to compute anything) so the next real count — even
  // if it happens to equal the previous session's count — is still reported,
  // instead of silently staying stuck on a stale value.
  const resetKey = `${sessionId}:${refresh}`;
  const lastResetKey = useRef(resetKey);
  if (lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey;
    lastReportedNodeCount.current = null;
  }
  useEffect(() => {
    if (nodeCount === null) return;
    if (lastReportedNodeCount.current === nodeCount) return;
    lastReportedNodeCount.current = nodeCount;
    onNodeCount?.(nodeCount - 1);
  }, [nodeCount, onNodeCount]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>
          One line per agent on a shared clock; branches mark where a subagent was spawned.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-[240px] w-full" /> : null}
        {!loading && spawns.isError ? (
          <div className="flex h-[160px] flex-col items-center justify-center gap-2 text-sm">
            <p className="text-muted-foreground">Agent relationships could not be loaded.</p>
            <Button onClick={() => void spawns.refetch()} size="sm" type="button">
              Retry
            </Button>
          </div>
        ) : null}
        {!loading && !spawns.isError && spawns.data ? (
          <AgentGraphBody
            markerEvents={signals.data?.items ?? []}
            markerTotal={signals.data?.total ?? 0}
            onOpenNode={onOpenNode}
            pages={spawns.data.pages}
            rootSession={rootSession}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function AgentGraphBody({
  pages,
  rootSession,
  markerEvents,
  markerTotal,
  onOpenNode,
}: {
  pages: readonly ProfileSpawnsResponse[];
  rootSession: AgentGraphRootSession;
  markerEvents: readonly Event[];
  markerTotal: number;
  onOpenNode: (nodeId: string) => void;
}) {
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('compressed');
  const [hiddenKinds, setHiddenKinds] = useState<Set<MarkerKind>>(() => new Set());
  const rows = buildRows(rootSession, pages);
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const domain = buildTimeDomain([
    ...rows.map((row) => ({ start: row.startedAt, end: row.endedAt })),
    ...rows
      .filter((row) => row.callAt !== null)
      .map((row) => ({ start: row.callAt, end: row.callAt })),
  ]);

  if (domain === null) {
    return (
      <p className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
        No timing data is available for this tree.
      </p>
    );
  }

  const rawMarkers = markerEvents
    .filter((event) => rowsById.has(event.sessionId) && event.at !== null)
    .map((event) => {
      const ms = toMs(event.at);
      if (ms === null) return null;
      return {
        key: `${event.streamId}-${event.seq}`,
        absoluteX: ms,
        y: event.sessionId,
        kind: markerKind(event),
        detail: markerDetail(event),
        at: event.at as string,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const observationTimes = [
    ...rows.flatMap((row) => [toMs(row.startedAt), toMs(row.endedAt), toMs(row.callAt)]),
    ...rawMarkers.map((marker) => marker.absoluteX),
  ].filter((value): value is number => value !== null);
  const timelineGaps = findTimelineGaps(observationTimes);
  const compressesGaps = timelineMode === 'compressed' && timelineGaps.length > 0;
  const displayTime = (value: number) =>
    compressesGaps ? compressTime(value, timelineGaps) : value;
  const displayDomainStart = displayTime(domain.start);
  const displayDomainEnd = displayTime(domain.end);

  const chartRows = rows.map((row) => {
    const startMs = toMs(row.startedAt) ?? toMs(row.callAt) ?? domain.start;
    const endMsRaw = toMs(row.endedAt);
    const openEnded = endMsRaw === null;
    // A missing end is uncertainty, not evidence that the agent ran until the
    // tree's last timestamp. Render it as a start marker with zero duration.
    const endMs = endMsRaw ?? startMs;
    return {
      id: row.id,
      label: row.label,
      isRoot: row.isRoot,
      parentRowId: row.parentRowId,
      offset: displayTime(startMs) - displayDomainStart,
      duration: Math.max(0, displayTime(endMs) - displayTime(startMs)),
      openEnded,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationMs: endMsRaw === null ? null : Math.max(0, endMsRaw - startMs),
      callAtRel:
        row.callAt !== null
          ? (() => {
              const callAt = toMs(row.callAt);
              return callAt === null ? null : displayTime(callAt) - displayDomainStart;
            })()
          : null,
    };
  });

  // Each row's connector originates from its own SpawnItem.parent's row
  // (`parentRowId`, set by buildRows) — never hardcoded to root — so a
  // depth-2+ nested spawn branches from its real parent's row, not the
  // root's.
  const connectors = chartRows
    .filter(
      (row): row is typeof row & { parentRowId: string; callAtRel: number } =>
        row.parentRowId !== null && row.callAtRel !== null,
    )
    .map((row) => ({
      parentId: row.parentRowId,
      childId: row.id,
      parentXRel: row.callAtRel,
      childXRel: row.offset,
    }));

  const markers = rawMarkers.map(({ absoluteX, ...marker }) => ({
    ...marker,
    x: displayTime(absoluteX) - displayDomainStart,
  }));

  const presentKinds = Array.from(new Set(markers.map((marker) => marker.kind)));
  const kindCounts = new Map<MarkerKind, number>();
  for (const marker of markers) kindCounts.set(marker.kind, (kindCounts.get(marker.kind) ?? 0) + 1);
  const visibleMarkers = markers.filter((marker) => !hiddenKinds.has(marker.kind));
  const chartHeight = Math.max(MIN_CHART_HEIGHT, rows.length * ROW_HEIGHT + 44);
  const viewportHeight = Math.min(chartHeight, MAX_VIEWPORT_HEIGHT);
  const elapsedMs = Math.max(0, domain.end - domain.start);
  const unknownEndCount = rows.filter((row) => row.endedAt === null).length;

  const formatAxisTick = (relativeValue: number) => {
    const displayAbsolute = displayDomainStart + relativeValue;
    const absolute = compressesGaps ? expandTime(displayAbsolute, timelineGaps) : displayAbsolute;
    const date = new Date(absolute);
    if (elapsedMs < 60 * 60_000) {
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    return axisDateTime.format(date);
  };

  function toggleKind(kind: MarkerKind) {
    setHiddenKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/25 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            <GitBranch aria-hidden="true" size={14} />
            {rows.length - 1} subagent{rows.length - 1 === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock3 aria-hidden="true" size={14} />
            {formatDuration(elapsedMs)} elapsed
          </span>
          {unknownEndCount > 0 ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <HelpCircle aria-hidden="true" size={14} />
              {unknownEndCount} unknown end{unknownEndCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        {timelineGaps.length > 0 ? (
          <fieldset className="flex rounded-md border bg-background p-0.5">
            <legend className="sr-only">Timeline scale</legend>
            <Button
              aria-pressed={timelineMode === 'compressed'}
              className="h-6 px-2 text-xs"
              onClick={() => setTimelineMode('compressed')}
              size="sm"
              type="button"
              variant={timelineMode === 'compressed' ? 'secondary' : 'ghost'}
            >
              Compress gaps
            </Button>
            <Button
              aria-pressed={timelineMode === 'wall-clock'}
              className="h-6 px-2 text-xs"
              onClick={() => setTimelineMode('wall-clock')}
              size="sm"
              type="button"
              variant={timelineMode === 'wall-clock' ? 'secondary' : 'ghost'}
            >
              Wall clock
            </Button>
          </fieldset>
        ) : null}
      </div>
      <div className="overflow-y-auto rounded-md border" style={{ height: viewportHeight }}>
        <ChartContainer
          className="aspect-auto w-full min-w-[680px]"
          config={{}}
          style={{ height: chartHeight }}
        >
          <RechartsComposedChart
            data={chartRows}
            layout="vertical"
            margin={{ left: 8, right: 20, top: 8, bottom: 8 }}
          >
            <XAxis
              axisLine={false}
              domain={[0, Math.max(1, displayDomainEnd - displayDomainStart)]}
              minTickGap={48}
              tickFormatter={formatAxisTick}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="id"
              tick={(props) => <RowTick {...props} onOpenNode={onOpenNode} rowsById={rowsById} />}
              tickLine={false}
              type="category"
              width={190}
            />
            <Bar dataKey="offset" fill="transparent" isAnimationActive={false} stackId="lifespan" />
            <Bar
              dataKey="duration"
              isAnimationActive={false}
              shape={(props: BarShapeProps) => <LifespanBar {...props} onOpenNode={onOpenNode} />}
              stackId="lifespan"
            />
            <AgentGraphConnectors connectors={connectors} />
            <AgentGraphMarkers markers={visibleMarkers} />
          </RechartsComposedChart>
        </ChartContainer>
      </div>
      {compressesGaps ? (
        <p className="text-muted-foreground text-xs">
          {timelineGaps.length} long timeline gap{timelineGaps.length === 1 ? '' : 's'} compressed.
          This means no starts, ends, spawns, or signals were recorded—not necessarily that agents
          were idle.
        </p>
      ) : null}
      {presentKinds.length > 0 ? (
        <ul aria-label="Signal filters" className="flex flex-wrap gap-1.5">
          {presentKinds.map((kind) => (
            <li key={kind}>
              <Toggle
                aria-label={`${hiddenKinds.has(kind) ? 'Show' : 'Hide'} ${MARKER_LABEL[kind]} signals`}
                onPressedChange={() => toggleKind(kind)}
                pressed={!hiddenKinds.has(kind)}
                size="sm"
                variant="outline"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: MARKER_COLOR[kind] }}
                />
                {MARKER_LABEL[kind]} {kindCounts.get(kind)}
              </Toggle>
            </li>
          ))}
        </ul>
      ) : null}
      {markerTotal > SIGNALS_LIMIT ? (
        <p className="text-muted-foreground text-xs">
          Showing the first {SIGNALS_LIMIT} signals of {markerTotal}.
        </p>
      ) : null}
    </div>
  );
}

type BarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: {
    id: string;
    label: string;
    isRoot: boolean;
    openEnded: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
  };
};

function LifespanBar({
  x,
  y,
  width,
  height,
  payload,
  onOpenNode,
}: BarShapeProps & { onOpenNode: (id: string) => void }) {
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !payload
  ) {
    return null;
  }
  const barHeight = Math.max(4, height * 0.6);
  const barY = y + (height - barHeight) / 2;
  const title = payload.openEnded
    ? `${payload.label} — started ${payload.startedAt ? tooltipDateTime.format(new Date(payload.startedAt)) : 'at an unknown time'} — end not reported`
    : `${payload.label} — ${formatDuration(payload.durationMs)} — ${payload.startedAt ? tooltipDateTime.format(new Date(payload.startedAt)) : '?'} to ${payload.endedAt ? tooltipDateTime.format(new Date(payload.endedAt)) : '?'}`;

  if (payload.openEnded) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: supplementary mouse target; the matching row label remains the keyboard-reachable control
      <g
        className="cursor-pointer"
        data-open-ended="true"
        data-row-id={payload.id}
        onClick={() => onOpenNode(payload.id)}
      >
        <title>{title}</title>
        <rect
          data-open-ended="true"
          data-row-id={payload.id}
          fill="transparent"
          height={height}
          width={24}
          x={x - 8}
          y={y}
        />
        <circle
          cx={x + 3}
          cy={y + height / 2}
          fill="var(--background)"
          r={3.5}
          stroke="var(--chart-3)"
          strokeWidth={2}
        />
        <path
          d={`M ${x + 7} ${y + height / 2} L ${x + 14} ${y + height / 2}`}
          stroke="var(--chart-3)"
          strokeDasharray="2 2"
          strokeWidth={2}
        />
      </g>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: bar is a supplementary mouse-only click target; the row label (RowTick) is the keyboard-reachable control for the same action
    <rect
      className="cursor-pointer"
      data-open-ended={payload.openEnded}
      data-row-id={payload.id}
      fill={payload.isRoot ? 'var(--token-model-1)' : 'var(--chart-3)'}
      height={barHeight}
      onClick={() => onOpenNode(payload.id)}
      rx={2}
      width={Math.max(3, width)}
      x={x}
      y={barY}
    >
      <title>{title}</title>
    </rect>
  );
}

type MarkerDatum = {
  key: string;
  x: number;
  y: string;
  kind: MarkerKind;
  detail: string;
  at: string;
};

/** Signal markers, positioned with `useXAxisScale`/`useYAxisScale` rather
 * than Recharts' own `<Scatter>`: in this recharts@3.8.0 build, a `<Scatter>`
 * sibling of the stacked lifespan `Bar`s resets the categorical y-axis
 * domain to empty (reproduced in isolation — a static 3-row vertical
 * ComposedChart with two stacked `Bar`s renders correctly, and stops
 * rendering any bar as soon as a `<Scatter>` is added, regardless of its
 * `data`/axis-id props), so markers use the same documented scale-hook
 * escape hatch as the connectors layer instead. */
function AgentGraphMarkers({ markers }: { markers: readonly MarkerDatum[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale) return null;

  return (
    <g className="agent-graph-markers">
      {markers.map((marker) => {
        const cx = xScale(marker.x);
        const cy = yScale(marker.y, { position: 'middle' });
        if (cx === undefined || cy === undefined) return null;
        return (
          <g className="agent-graph-marker" data-marker-kind={marker.kind} key={marker.key}>
            <title>
              {MARKER_LABEL[marker.kind]} — {marker.detail} — {marker.at}
            </title>
            <circle
              cx={cx}
              cy={cy}
              fill={MARKER_COLOR[marker.kind]}
              r={4}
              stroke="var(--background)"
              strokeWidth={1}
            />
          </g>
        );
      })}
    </g>
  );
}

function RowTick({
  x,
  y,
  payload,
  rowsById,
  onOpenNode,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
  rowsById: Map<string, Row>;
  onOpenNode: (id: string) => void;
}) {
  if (x === undefined || y === undefined || !payload) return null;
  const row = rowsById.get(payload.value);
  if (!row) return null;
  const axisRight = Number(x);
  const rowY = Number(y);
  if (!Number.isFinite(axisRight) || !Number.isFinite(rowY)) return null;
  const gutterLeft = Math.max(8, axisRight - 182);
  const treeRootX = gutterLeft + 4;
  const visibleDepth = Math.min(row.depth, 6);
  const branchX = treeRootX + visibleDepth * TREE_LEVEL_INDENT;
  const labelX = row.isRoot ? treeRootX + 10 : branchX + 12;
  const rowHalfHeight = ROW_HEIGHT / 2;
  const ancestorGuides = row.ancestorHasNextSibling.flatMap((hasNextSibling, index) =>
    hasNextSibling ? [{ depth: index + 1, id: `${row.id}:ancestor-${index + 1}` }] : [],
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG group inside a Recharts axis tick; HTML button elements cannot be nested here
    <g
      aria-label={`Open profile for ${row.label}`}
      className="group cursor-pointer outline-none"
      data-parent-row-id={row.parentRowId ?? undefined}
      data-row-depth={row.depth}
      data-tree-row-id={row.id}
      onClick={() => onOpenNode(row.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenNode(row.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <title>{row.label}</title>
      <rect
        className="fill-transparent transition-colors group-hover:fill-muted/60 group-focus-visible:fill-muted group-focus-visible:stroke-ring"
        height={30}
        rx={5}
        stroke="transparent"
        width={Math.max(24, axisRight - gutterLeft - 2)}
        x={gutterLeft - 4}
        y={rowY - 15}
      />
      {ancestorGuides.map((guide) => (
        <line
          className="stroke-muted-foreground/45"
          data-tree-guide-depth={guide.depth}
          key={guide.id}
          strokeWidth={1.25}
          x1={treeRootX + guide.depth * TREE_LEVEL_INDENT}
          x2={treeRootX + guide.depth * TREE_LEVEL_INDENT}
          y1={rowY - rowHalfHeight}
          y2={rowY + rowHalfHeight}
        />
      ))}
      {row.isRoot ? (
        <circle cx={treeRootX} cy={rowY} fill="var(--token-model-1)" r={3} />
      ) : row.parentRowId === null ? (
        <circle
          cx={branchX}
          cy={rowY}
          fill="var(--background)"
          r={3}
          stroke="var(--muted-foreground)"
          strokeWidth={1.25}
        />
      ) : (
        <path
          className="stroke-muted-foreground"
          d={
            row.isLastSibling
              ? `M ${branchX} ${rowY - rowHalfHeight} V ${rowY} H ${branchX + 8}`
              : `M ${branchX} ${rowY - rowHalfHeight} V ${rowY + rowHalfHeight} M ${branchX} ${rowY} H ${branchX + 8}`
          }
          data-tree-branch={row.isLastSibling ? 'last' : 'middle'}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.25}
        />
      )}
      <text
        className={row.isRoot ? 'fill-foreground font-medium text-xs' : 'fill-foreground text-xs'}
        dominantBaseline="middle"
        textAnchor="start"
        x={labelX}
        y={rowY}
      >
        {row.label}
      </text>
    </g>
  );
}
