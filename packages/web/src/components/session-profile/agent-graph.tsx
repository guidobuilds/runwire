import type { Event, ProfileNode, ProfileSpawnsResponse, SpawnItem } from '@scout/core';
import { useEffect, useMemo, useRef } from 'react';
import {
  Bar,
  ComposedChart as RechartsComposedChart,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { useSessionProfileMergedEvents, useSessionProfileSpawns } from '@/queries/session-profile';
import { AgentGraphConnectors } from './agent-graph-connectors';
import { buildTimeDomain, tickFormatter, toMs } from './time-scale';

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
    isRoot: true,
  };
  const rows: Row[] = [rootRow];
  // Also guards a malformed parent cycle from recursing forever via a
  // visible-ancestor-set guard.
  const visited = new Set<string>([rootSession.id]);

  function walk(parentRowId: string, depth: number) {
    for (const item of childrenByParent.get(parentRowId) ?? []) {
      const child = item.child as ProfileNode;
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      rows.push({
        id: child.id,
        label: labelFor(child),
        startedAt: child.startedAt,
        endedAt: child.endedAt,
        callAt: item.callAt,
        parentRowId,
        depth,
        isRoot: false,
      });
      walk(child.id, depth + 1);
    }
  }
  walk(rootSession.id, 1);

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
        isRoot: false,
      });
    }
  }

  return rows;
}

const HEIGHT_STEPS: readonly { maxRows: number; className: string }[] = [
  { maxRows: 5, className: 'h-[160px]' },
  { maxRows: 8, className: 'h-[240px]' },
  { maxRows: 11, className: 'h-[340px]' },
  { maxRows: 15, className: 'h-[440px]' },
  { maxRows: 19, className: 'h-[520px]' },
];
const MAX_HEIGHT_CLASS = 'h-[600px]';

function chartHeightClass(rowCount: number): string {
  const step = HEIGHT_STEPS.find((candidate) => rowCount <= candidate.maxRows);
  return step ? step.className : MAX_HEIGHT_CLASS;
}

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

  const chartRows = rows.map((row) => {
    const startMs = toMs(row.startedAt) ?? toMs(row.callAt) ?? domain.start;
    const endMsRaw = toMs(row.endedAt);
    const openEnded = endMsRaw === null;
    const endMs = endMsRaw ?? domain.end;
    return {
      id: row.id,
      label: row.label,
      isRoot: row.isRoot,
      parentRowId: row.parentRowId,
      offset: startMs - domain.start,
      duration: Math.max(0, endMs - startMs),
      openEnded,
      callAtRel: row.callAt !== null ? (toMs(row.callAt) ?? null) : null,
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

  const markers = markerEvents
    .filter((event) => rowsById.has(event.sessionId) && event.at !== null)
    .map((event) => {
      const ms = toMs(event.at);
      if (ms === null) return null;
      return {
        key: `${event.streamId}-${event.seq}`,
        x: ms - domain.start,
        y: event.sessionId,
        kind: markerKind(event),
        detail: markerDetail(event),
        at: event.at as string,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const presentKinds = Array.from(new Set(markers.map((marker) => marker.kind)));
  const format = tickFormatter(domain);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-y-auto">
        <ChartContainer
          className={`aspect-auto w-full ${chartHeightClass(rows.length)}`}
          config={{}}
        >
          <RechartsComposedChart
            data={chartRows}
            layout="vertical"
            margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
          >
            <XAxis
              axisLine={false}
              domain={[0, Math.max(1, domain.end - domain.start)]}
              tickFormatter={(value: number) => format(domain.start + value)}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="id"
              tick={(props) => <RowTick {...props} onOpenNode={onOpenNode} rowsById={rowsById} />}
              tickLine={false}
              type="category"
              width={110}
            />
            <Bar dataKey="offset" fill="transparent" isAnimationActive={false} stackId="lifespan" />
            <Bar
              dataKey="duration"
              isAnimationActive={false}
              shape={(props: BarShapeProps) => <LifespanBar {...props} onOpenNode={onOpenNode} />}
              stackId="lifespan"
            />
            <AgentGraphConnectors connectors={connectors} />
            <AgentGraphMarkers markers={markers} />
          </RechartsComposedChart>
        </ChartContainer>
      </div>
      {presentKinds.length > 0 ? (
        <ul aria-label="Signal legend" className="flex flex-wrap gap-1.5">
          {presentKinds.map((kind) => (
            <li key={kind}>
              <Badge variant="outline">{MARKER_LABEL[kind]}</Badge>
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
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: bar is a supplementary mouse-only click target; the row label (RowTick) is the keyboard-reachable control for the same action
    <rect
      className="cursor-pointer"
      data-open-ended={payload.openEnded}
      data-row-id={payload.id}
      fill={payload.isRoot ? 'var(--foreground)' : 'var(--chart-2)'}
      height={barHeight}
      onClick={() => onOpenNode(payload.id)}
      rx={2}
      strokeDasharray={payload.openEnded ? '3 2' : undefined}
      width={Math.max(1, width)}
      x={x}
      y={barY}
    />
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
  // Visual depth cue (F-11, optional): each level beyond a direct child
  // nudges the label right with non-breaking spaces (an SVG text glyph, not
  // an inline style) — direct children (depth 1) are unindented, matching
  // the original flat layout. A <title> discloses the full label when
  // `shortId` has elided a long id, since row height shrinks at scale and
  // labels can't grow to fit.
  const indent = '  '.repeat(Math.max(0, row.depth - 1));
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG text node inside a Recharts axis tick — a real <button> cannot be nested in this position; role="button" + tabIndex + onKeyDown is the closest reachable equivalent
    <text
      aria-label={`Open profile for ${row.label}`}
      className="cursor-pointer fill-foreground text-xs"
      data-row-depth={row.depth}
      dy={4}
      onClick={() => onOpenNode(row.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenNode(row.id);
        }
      }}
      role="button"
      tabIndex={0}
      textAnchor="end"
      x={x}
      y={y}
    >
      <title>{row.label}</title>
      {indent}
      {row.label}
    </text>
  );
}
