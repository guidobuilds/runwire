import { formatTokens } from '../../lib/format';
import type {
  AgentSpan,
  ComponentEvent,
  ComponentEventKind,
  HarnessEvent,
  HarnessEventKind,
  TokenPoint,
} from '../../lib/timeline';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { useTimeline } from './TimelineContext';

/**
 * Event Inspector (design.md §1.8/§3.1, f6-t1): a right-side `ui/sheet.tsx`
 * Sheet, unmodified (no vendored-file edits — the repo's binding shadcn
 * house rule), opened whenever `TimelineContext.selectedEventId` or
 * `selectedClusterIds` is non-null. Renders key-value fields for whichever
 * of the four event families the id resolves to, plus a collapsible
 * raw-metadata JSON block, and calls `closeInspector()` on close (Sheet's
 * own `onOpenChange`, not a bespoke close handler).
 *
 * Lookup mechanism (design.md leaves this open, "use your judgment"):
 * `EventInspector` takes the same four derived arrays every track already
 * renders from (`spans`/`tokenPoints`/`harnessEvents`/`componentEvents`) and
 * does its own `.find(e => e.id === selectedEventId)` search across them,
 * rather than requiring a composer (`SessionTimeline`, f7 — not built yet)
 * to pre-assemble a unified id->event map. Ids are safe to search this way
 * without collision: `TokenPoint.id` is prefixed `call:...`, `AgentSpan.id`
 * is a bare sessionId, and `HarnessEvent`/`ComponentEvent` ids
 * (`${sessionId}#${step.i}`) never collide with each other because
 * `buildHarnessEvents`/`buildComponentEvents` classify each `ToolCategory`
 * into exactly one of the two tracks (`lib/timeline.ts`).
 *
 * Clustered marker integration (f10-t3, revised): `HarnessTrack`/
 * `ComponentTrack`'s proximity-clustering (`clusterByProximity`,
 * `lib/timeline.ts`) used to set a merged marker's `data-*-id` to its
 * cluster's first (earliest) member's id and route the click straight into
 * `selectEvent`, so clicking a cluster silently jumped to one member and
 * dropped every other member the count badge counted. Clicking a cluster now
 * calls `TimelineContext.selectCluster` with every member's id, which opens
 * a list view here (`selectedClusterIds` set, `selectedEventId` still null)
 * — the same `findSelected` lookup, once per id — with a "Back to list" link
 * from the detail view once one is picked (`selectEvent(id)`, which never
 * touches `selectedClusterIds`).
 *
 * Raw-metadata block: no `<details>`/JSON-block precedent exists anywhere
 * else in this repo (grepped, zero hits), and none of the four derived
 * types carry a reference back to their originating `TraceStep` (the
 * builders in `lib/timeline.ts` only ever copy specific fields out, never
 * the step itself) — passing raw `TraceStep`/`SessionSummary` objects in
 * here would require new plumbing not owned by this task. The raw block
 * therefore shows the full derived event object itself (`AgentSpan` /
 * `TokenPoint` / `HarnessEvent` / `ComponentEvent`) — every field this
 * inspector's own key-value rows are computed from, verbatim — which is a
 * legitimate reading of design.md's "the underlying TraceStep/event object"
 * parenthetical for this stage of the slug.
 */

export type EventInspectorProps = {
  spans: readonly AgentSpan[];
  tokenPoints: readonly TokenPoint[];
  harnessEvents: readonly HarnessEvent[];
  componentEvents: readonly ComponentEvent[];
};

type SelectableEvent =
  | { source: 'agent'; data: AgentSpan }
  | { source: 'token'; data: TokenPoint }
  | { source: 'harness'; data: HarnessEvent }
  | { source: 'component'; data: ComponentEvent };

function findSelected(
  id: string,
  spans: readonly AgentSpan[],
  tokenPoints: readonly TokenPoint[],
  harnessEvents: readonly HarnessEvent[],
  componentEvents: readonly ComponentEvent[],
): SelectableEvent | undefined {
  const span = spans.find((s) => s.id === id);
  if (span) return { source: 'agent', data: span };
  const point = tokenPoints.find((p) => p.id === id);
  if (point) return { source: 'token', data: point };
  const harnessEvent = harnessEvents.find((e) => e.id === id);
  if (harnessEvent) return { source: 'harness', data: harnessEvent };
  const componentEvent = componentEvents.find((e) => e.id === id);
  if (componentEvent) return { source: 'component', data: componentEvent };
  return undefined;
}

/** "mm:ss" from an elapsed-ms value. Local copy, matching every track's own duplicate (no shared mm:ss formatter exists yet — that lands with `TimelineAxis`, a later task). */
function formatElapsed(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${sign}${min}:${String(sec).padStart(2, '0')}`;
}

/** Local copy, matching `HarnessTrack.tsx`/`ComponentTrack.tsx`'s own duplicate. */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const HARNESS_LABEL: Record<HarnessEventKind, string> = {
  read: 'Read',
  write: 'Write',
  exec: 'Exec',
};

const COMPONENT_LABEL: Record<ComponentEventKind, string> = {
  skill: 'Skill',
  mcp: 'MCP',
  agent: 'Agent',
  hook: 'Hook',
};

type FieldRow = readonly [label: string, value: string];

/** Agent fields per design.md/f6-t1: name/start-end/duration/tokens/model/parent (same set `AgentTrack`'s own tooltip already establishes). */
function agentFields(span: AgentSpan, spansById: ReadonlyMap<string, AgentSpan>): FieldRow[] {
  const startText = span.start !== undefined ? formatElapsed(span.start) : 'unknown';
  const endText = span.end !== undefined ? formatElapsed(span.end) : 'unknown';
  const durationText =
    span.start !== undefined && span.end !== undefined
      ? formatElapsed(span.end - span.start)
      : 'unknown';
  const tokensText =
    span.inputTokens !== undefined || span.outputTokens !== undefined
      ? `${formatTokens(span.inputTokens ?? 0)} in / ${formatTokens(span.outputTokens ?? 0)} out`
      : 'unknown';
  const parentName = span.parentAgentId
    ? (spansById.get(span.parentAgentId)?.name ?? span.parentAgentId)
    : 'none';
  return [
    ['Name', span.name],
    ['Start', startText],
    ['End', endText],
    ['Duration', durationText],
    ['Tokens', tokensText],
    ['Model', span.model ?? 'unknown'],
    ['Parent', parentName],
  ];
}

/** Token fields per design.md/f6-t1: timestamp/cumulative/delta/input/output/agent/model (same set `TokenTrack`'s own tooltip already establishes). */
function tokenFields(point: TokenPoint): FieldRow[] {
  return [
    ['Timestamp', formatElapsed(point.at)],
    ['Cumulative', formatTokens(point.cumulative)],
    ['Delta', formatTokens(point.delta)],
    ['Input', formatTokens(point.input)],
    ['Output', formatTokens(point.output)],
    ['Agent', point.agentId],
    ['Model', point.model],
  ];
}

/** Harness fields per design.md/f6-t1: type/start-end/duration/command-target/agent (same set `HarnessTrack`'s own tooltip already establishes). */
function harnessFields(event: HarnessEvent): FieldRow[] {
  const rows: FieldRow[] = [
    ['Type', HARNESS_LABEL[event.kind]],
    ['Start', formatElapsed(event.at)],
  ];
  if (event.durationMs !== undefined) {
    rows.push(['End', formatElapsed(event.at + event.durationMs)]);
    rows.push(['Duration', formatDurationMs(event.durationMs)]);
  } else {
    rows.push(['End', 'instant']);
    rows.push(['Duration', 'instant']);
  }
  rows.push(['Target', event.name]);
  rows.push(['Agent', event.agentId]);
  if (event.error) rows.push(['Error', 'yes']);
  return rows;
}

/** Component fields per design.md/f6-t1: agent/operation/server-tool-detail/duration (same set `ComponentTrack`'s own tooltip already establishes; no tokens line — `ComponentEvent` never carries usage, see `ComponentTrack.tsx`'s own documented layer-boundary note). */
function componentFields(event: ComponentEvent): FieldRow[] {
  return [
    ['Agent', event.agentId],
    ['Operation', `${COMPONENT_LABEL[event.kind]} — ${event.name}`],
    ['Detail', event.detail ?? 'none'],
    ['Duration', event.durationMs !== undefined ? formatDurationMs(event.durationMs) : 'unknown'],
  ];
}

function titleFor(selected: SelectableEvent): string {
  switch (selected.source) {
    case 'agent':
      return `Agent: ${selected.data.name}`;
    case 'token':
      return 'Token call';
    case 'harness':
      return `Harness: ${HARNESS_LABEL[selected.data.kind]}`;
    case 'component':
      return `Component: ${COMPONENT_LABEL[selected.data.kind]}`;
  }
}

function fieldsFor(
  selected: SelectableEvent,
  spansById: ReadonlyMap<string, AgentSpan>,
): FieldRow[] {
  switch (selected.source) {
    case 'agent':
      return agentFields(selected.data, spansById);
    case 'token':
      return tokenFields(selected.data);
    case 'harness':
      return harnessFields(selected.data);
    case 'component':
      return componentFields(selected.data);
  }
}

/**
 * Per-list-row label (cluster list view): unlike `titleFor` (which names
 * only the family/kind — e.g. "Harness: Read" — fine for a lone detail
 * header), a cluster's members are all the SAME kind by construction
 * (`clusterByProximity` buckets on `kind`), so every row would read
 * identically without also naming the specific target/name that actually
 * distinguishes one member from the next.
 */
function listLabelFor(selected: SelectableEvent): string {
  switch (selected.source) {
    case 'agent':
      return selected.data.name;
    case 'token':
      return `${formatTokens(selected.data.delta)} tokens`;
    case 'harness':
      return `${HARNESS_LABEL[selected.data.kind]} — ${selected.data.name}`;
    case 'component':
      return `${COMPONENT_LABEL[selected.data.kind]} — ${selected.data.name}`;
  }
}

/** The elapsed-ms moment a list row sorts/displays by — `undefined` only for an `AgentSpan` missing `start` entirely. */
function elapsedFor(selected: SelectableEvent): number | undefined {
  switch (selected.source) {
    case 'agent':
      return selected.data.start;
    case 'token':
      return selected.data.at;
    case 'harness':
      return selected.data.at;
    case 'component':
      return selected.data.at;
  }
}

export function EventInspector({
  spans,
  tokenPoints,
  harnessEvents,
  componentEvents,
}: EventInspectorProps) {
  const { selectedEventId, selectedClusterIds, selectEvent, closeInspector } = useTimeline();
  const spansById = new Map(spans.map((s) => [s.agentId, s]));
  const selected = selectedEventId
    ? findSelected(selectedEventId, spans, tokenPoints, harnessEvents, componentEvents)
    : undefined;
  // A cluster click opens the list first (`selectedClusterIds` set,
  // `selectedEventId` still null); picking a row narrows to that one event's
  // detail view without losing the list -- `selectEvent` never clears
  // `selectedClusterIds` (see TimelineContext), so "Back to list" below can
  // return to it.
  const showList = selectedClusterIds !== null && selectedEventId === null;
  const clusterMembers = selectedClusterIds
    ? selectedClusterIds
        .map((id) => ({ id, event: findSelected(id, spans, tokenPoints, harnessEvents, componentEvents) }))
        .filter(
          (row): row is { id: string; event: SelectableEvent } => row.event !== undefined,
        )
    : [];

  return (
    <Sheet
      open={selectedEventId !== null || selectedClusterIds !== null}
      onOpenChange={(open) => {
        if (!open) closeInspector();
      }}
    >
      <SheetContent side="right" data-slot="event-inspector">
        <SheetHeader>
          <SheetTitle>
            {showList
              ? `${clusterMembers.length} events`
              : selected
                ? titleFor(selected)
                : 'Event not found'}
          </SheetTitle>
          <SheetDescription>{showList ? 'Select one to inspect' : 'Event detail'}</SheetDescription>
        </SheetHeader>
        {showList && (
          <div className="flex flex-col px-4" data-slot="cluster-event-list">
            {clusterMembers.map(({ id, event }) => {
              const at = elapsedFor(event);
              return (
                <button
                  key={id}
                  type="button"
                  data-cluster-event-id={id}
                  className="flex items-center justify-between gap-4 border-b border-border py-2 text-left text-sm last:border-0 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => selectEvent(id)}
                >
                  <span className="truncate text-zinc-900 dark:text-zinc-50">
                    {listLabelFor(event)}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {at !== undefined ? formatElapsed(at) : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {!showList && selected && (
          <>
            {selectedClusterIds && (
              <button
                type="button"
                data-slot="back-to-list"
                className="px-4 text-left text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                onClick={() => selectEvent(null)}
              >
                ← Back to list ({selectedClusterIds.length})
              </button>
            )}
            <dl className="flex flex-col gap-2 px-4 text-sm">
              {fieldsFor(selected, spansById).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
                  <dd className="text-right text-zinc-900 dark:text-zinc-50">{value}</dd>
                </div>
              ))}
            </dl>
            <details className="px-4 pb-4" data-slot="raw-metadata">
              <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">
                Raw metadata
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                {JSON.stringify(selected.data, null, 2)}
              </pre>
            </details>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
