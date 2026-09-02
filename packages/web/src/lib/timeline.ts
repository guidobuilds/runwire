import type {
  Confidence,
  SessionSummary,
  SessionTrace,
  ToolCategory,
  TraceStep,
} from '../api/types';

/**
 * Pure client-side data-derivation layer for `SessionTimeline` (design.md
 * §3.3). Every function here is a reshape/re-accumulation over data already
 * fetched by `useSession`/`useTraces` — no new API endpoint, no core change.
 *
 * All four event families share one anchor: `rootAnchor`, the ISO timestamp
 * of the *root* session's own start (see `resolveRootAnchor`). Every step's
 * `elapsedMs` is computed against that single fixed anchor, never a
 * subagent's own local `axis.startedAt` — reusing a subagent's own anchor
 * per-session would misalign its spans/events against the root's Token/Agent
 * tracks (design.md §1.3).
 */

type CallStep = Extract<TraceStep, { kind: 'call' }>;

export type AgentSpan = {
  id: string; // sessionId
  agentId: string; // sessionId
  name: string; // agentType ?? relation ?? 'root'
  parentAgentId: string | null;
  depth: number;
  start: number | undefined; // elapsed ms; undefined = unknown start
  end: number | undefined; // elapsed ms; undefined = unknown end
  model: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  confidenceLevel: 'high' | 'medium' | 'low';
};

export type HarnessEventKind = 'read' | 'write' | 'exec';

export type HarnessEvent = {
  id: string; // `${sessionId}#${step.i}`
  agentId: string; // sessionId
  kind: HarnessEventKind;
  at: number; // elapsed ms
  durationMs: number | undefined;
  name: string; // tool name (metadata only)
  error: boolean | undefined;
};

export type ComponentEventKind = 'skill' | 'mcp' | 'agent' | 'hook';

export type ComponentEvent = {
  id: string;
  agentId: string;
  kind: ComponentEventKind;
  at: number;
  durationMs: number | undefined;
  name: string; // tool/hook name
  detail: string | undefined; // mcp: server/tool split of `mcp__server__tool`; agent: childId's agentType if resolvable
  childId: string | undefined; // agent kind only, for click-through to the spawned session (existing D35 pattern)
};

export type TokenPoint = {
  id: string; // `call:${sessionId}#${step.i}`
  agentId: string;
  at: number; // elapsed ms
  cumulative: number; // running total across the WHOLE merged stream
  delta: number; // this call's own usage, summed
  input: number;
  output: number;
  model: string;
};

/**
 * `Date.parse(at) - Date.parse(rootAnchor)`, or `undefined` when either input
 * is absent or fails to parse. Steps with no `at` (a real possibility — `at`
 * is optional on every `TraceStep` kind) are excluded from the time-axis
 * tracks by every builder below; they remain visible, unaffected, in
 * `TraceRibbon` (index axis, no timing dependency).
 */
export function elapsedMs(
  rootAnchor: string | undefined,
  at: string | undefined,
): number | undefined {
  if (rootAnchor === undefined || at === undefined) return undefined;
  const rootMs = Date.parse(rootAnchor);
  const atMs = Date.parse(at);
  if (Number.isNaN(rootMs) || Number.isNaN(atMs)) return undefined;
  return atMs - rootMs;
}

/**
 * Single shared reference for the whole merged timeline: the root session's
 * own trace-axis start, falling back to its own summary timing when the
 * trace has no axis start (e.g. trace unavailable/empty).
 */
export function resolveRootAnchor(
  rootSummary: SessionSummary,
  rootTrace: SessionTrace | undefined,
): string | undefined {
  return rootTrace?.axis.startedAt ?? rootSummary.timing.startedAt?.value;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** The weakest of the given confidences. Local to this module — web reads core types only, never its runtime helpers (see `.dependency-cruiser.cjs`). */
function weakestConfidence(confidences: readonly Confidence[]): Confidence {
  let min: Confidence = 'high';
  for (const c of confidences) {
    if (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[min]) min = c;
  }
  return min;
}

/**
 * Design.md §1.4: a span whose `startedAt`/`endedAt`/`durationMs` confidence
 * is medium/low renders at reduced opacity (`TraceRibbon`'s D36 convention,
 * extended per-span). A span with none of those three metrics present at all
 * has no timing signal whatsoever — treated as `low`, not defaulted to
 * `high`, so a fully-unknown span never looks as trustworthy as a
 * high-confidence one.
 */
function agentConfidenceLevel(summary: SessionSummary): Confidence {
  const confidences: Confidence[] = [];
  if (summary.timing.startedAt) confidences.push(summary.timing.startedAt.confidence);
  if (summary.timing.endedAt) confidences.push(summary.timing.endedAt.confidence);
  if (summary.timing.durationMs) confidences.push(summary.timing.durationMs.confidence);
  if (confidences.length === 0) return 'low';
  return weakestConfidence(confidences);
}

/** Sum of the three input-shaped `Usage` metrics actually present; `undefined` when none are. */
function sumInputUsage(usage: SessionSummary['usage']): number | undefined {
  let sum = 0;
  let any = false;
  for (const field of ['uncachedInput', 'cachedInput', 'cacheWrite'] as const) {
    const value = usage[field]?.value;
    if (value === undefined) continue;
    any = true;
    sum += value;
  }
  return any ? sum : undefined;
}

/** Sum of the two output-shaped `Usage` metrics actually present; `undefined` when none are. */
function sumOutputUsage(usage: SessionSummary['usage']): number | undefined {
  let sum = 0;
  let any = false;
  for (const field of ['output', 'reasoningOutput'] as const) {
    const value = usage[field]?.value;
    if (value === undefined) continue;
    any = true;
    sum += value;
  }
  return any ? sum : undefined;
}

/**
 * One `AgentSpan` per subtree summary, any depth (design.md §1.5: full depth
 * for MVP, no artificial depth-1 cap — `getSubtree()` is already unbounded).
 */
export function buildAgentSpans(
  rootAnchor: string,
  subtree: readonly SessionSummary[],
): AgentSpan[] {
  return subtree.map((summary) => ({
    id: summary.id,
    agentId: summary.id,
    name: summary.agentType ?? summary.relation ?? 'root',
    parentAgentId: summary.parentId ?? null,
    depth: summary.depth,
    start: elapsedMs(rootAnchor, summary.timing.startedAt?.value),
    end: elapsedMs(rootAnchor, summary.timing.endedAt?.value),
    model: summary.model.primary?.value,
    inputTokens: sumInputUsage(summary.usage),
    outputTokens: sumOutputUsage(summary.usage),
    confidenceLevel: agentConfidenceLevel(summary),
  }));
}

/**
 * A `call` step's own delta, split input/output. Mirrors `TraceRibbon.tsx`'s
 * `cumulativeTokensOf` five-field sum (input: uncachedInput+cachedInput+
 * cacheWrite, output: output+reasoningOutput — the same five raw
 * `UsageNumbers` fields, split in two instead of summed to one scalar).
 */
function usageInput(usage: CallStep['usage']): number {
  if (!usage) return 0;
  return (usage.uncachedInput ?? 0) + (usage.cachedInput ?? 0) + (usage.cacheWrite ?? 0);
}

function usageOutput(usage: CallStep['usage']): number {
  if (!usage) return 0;
  return (usage.output ?? 0) + (usage.reasoningOutput ?? 0);
}

/**
 * Cumulative-token gotcha (design.md §3.3): `TokenPoint.cumulative` is a
 * running sum over the merged, time-sorted stream of every fetched trace's
 * `call` steps — sorted by merged `elapsedMs`, then re-accumulated left to
 * right. It must NEVER reuse an individual `TraceStep.cum` value: each
 * subagent's own `cum` resets relative to that subagent's own trace, not the
 * root's, so reusing it naively would make the Token track's line drop every
 * time a subagent's calls end and the root's resume.
 */
export function buildTokenSeries(
  rootAnchor: string,
  tracesById: ReadonlyMap<string, SessionTrace>,
): TokenPoint[] {
  type Entry = { sessionId: string; step: CallStep; at: number };
  const entries: Entry[] = [];
  for (const [sessionId, trace] of tracesById) {
    for (const step of trace.steps) {
      if (step.kind !== 'call') continue;
      const at = elapsedMs(rootAnchor, step.at);
      if (at === undefined) continue;
      entries.push({ sessionId, step, at });
    }
  }

  // Sort by merged elapsed time first — never by (sessionId, step.i), which
  // would silently reconstruct per-trace concatenation order instead of the
  // real interleaved timeline. sessionId/step.i are tie-breaks only, for
  // determinism when two steps share one `at`.
  entries.sort(
    (a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId) || a.step.i - b.step.i,
  );

  let cumulative = 0;
  return entries.map(({ sessionId, step, at }) => {
    const input = usageInput(step.usage);
    const output = usageOutput(step.usage);
    const delta = input + output;
    cumulative += delta;
    return {
      id: `call:${sessionId}#${step.i}`,
      agentId: sessionId,
      at,
      cumulative,
      delta,
      input,
      output,
      model: step.model,
    };
  });
}

function isHarnessToolCategory(category: ToolCategory): category is HarnessEventKind {
  return category === 'read' || category === 'write' || category === 'exec';
}

/**
 * Harness track: exactly `read`/`write`/`exec` tool-category steps (design.md
 * §2 MVP boundary — `search`/`plan`/`web`/`other` are a disclosed fidelity
 * gap, not this track's job). Steps lacking `at` are counted in
 * `skippedNoTimestamp`, never silently dropped (design.md §1.3).
 */
export function buildHarnessEvents(
  rootAnchor: string,
  tracesById: ReadonlyMap<string, SessionTrace>,
): { events: HarnessEvent[]; skippedNoTimestamp: number } {
  const events: HarnessEvent[] = [];
  let skippedNoTimestamp = 0;
  for (const [sessionId, trace] of tracesById) {
    for (const step of trace.steps) {
      if (step.kind !== 'tool' || !isHarnessToolCategory(step.category)) continue;
      const at = elapsedMs(rootAnchor, step.at);
      if (at === undefined) {
        skippedNoTimestamp += 1;
        continue;
      }
      events.push({
        id: `${sessionId}#${step.i}`,
        agentId: sessionId,
        kind: step.category,
        at,
        durationMs: step.durationMs,
        name: step.name,
        error: step.error,
      });
    }
  }
  events.sort(
    (a, b) => a.at - b.at || a.agentId.localeCompare(b.agentId) || a.id.localeCompare(b.id),
  );
  return { events, skippedNoTimestamp };
}

function isComponentToolCategory(category: ToolCategory): category is 'skill' | 'mcp' | 'agent' {
  return category === 'skill' || category === 'mcp' || category === 'agent';
}

/**
 * MCP tool names are `mcp__<server>__<tool>` (`packages/adapter-claude-code/
 * src/tool-category.ts`'s `startsWith('mcp__')` branch). Splits into
 * `server/tool` for `ComponentEvent.detail`; `undefined` for a malformed name
 * that doesn't actually carry a `__`-separated tool part.
 */
function splitMcpName(name: string): string | undefined {
  const prefix = 'mcp__';
  if (!name.startsWith(prefix)) return undefined;
  const rest = name.slice(prefix.length);
  const idx = rest.indexOf('__');
  if (idx === -1) return undefined;
  const server = rest.slice(0, idx);
  const tool = rest.slice(idx + 2);
  if (!server || !tool) return undefined;
  return `${server}/${tool}`;
}

/**
 * Component track: `skill`/`mcp`/`agent` tool-category steps, plus every
 * `harness`-kind step (rendered as `kind: 'hook'`). `detail` is only ever
 * populated for `mcp` (server/tool split) — this function receives traces
 * only, not the subtree summaries needed to resolve an `agent` step's
 * `childId` to that child's `agentType`, so `agent`-kind events carry
 * `childId` through for the caller (`AgentTrack`/`EventInspector`, which do
 * have the subtree) to resolve, per design.md's "if resolvable" caveat.
 */
export function buildComponentEvents(
  rootAnchor: string,
  tracesById: ReadonlyMap<string, SessionTrace>,
): { events: ComponentEvent[]; skippedNoTimestamp: number } {
  const events: ComponentEvent[] = [];
  let skippedNoTimestamp = 0;
  for (const [sessionId, trace] of tracesById) {
    for (const step of trace.steps) {
      if (step.kind === 'tool' && isComponentToolCategory(step.category)) {
        const at = elapsedMs(rootAnchor, step.at);
        if (at === undefined) {
          skippedNoTimestamp += 1;
          continue;
        }
        events.push({
          id: `${sessionId}#${step.i}`,
          agentId: sessionId,
          kind: step.category,
          at,
          durationMs: step.durationMs,
          name: step.name,
          detail: step.category === 'mcp' ? splitMcpName(step.name) : undefined,
          childId: step.category === 'agent' ? step.childId : undefined,
        });
      } else if (step.kind === 'harness') {
        const at = elapsedMs(rootAnchor, step.at);
        if (at === undefined) {
          skippedNoTimestamp += 1;
          continue;
        }
        events.push({
          id: `${sessionId}#${step.i}`,
          agentId: sessionId,
          kind: 'hook',
          at,
          durationMs: undefined,
          name: step.name,
          detail: undefined,
          childId: undefined,
        });
      }
    }
  }
  events.sort(
    (a, b) => a.at - b.at || a.agentId.localeCompare(b.agentId) || a.id.localeCompare(b.id),
  );
  return { events, skippedNoTimestamp };
}

/**
 * Minimum shape `clusterByProximity` needs from an event: something with a
 * stable `id`, an elapsed-ms `at`, and a `kind` discriminant to bucket on
 * (`HarnessEventKind`/`ComponentEventKind` both satisfy this structurally).
 */
export type ClusterableEvent = { id: string; at: number; kind: string };

export type EventCluster<T extends ClusterableEvent> = {
  /**
   * The earliest (by `at`, ties broken by `id`) member of this cluster. This
   * is deliberately the id a caller should use for click-through
   * (`data-*-id`) and for the Event Inspector lookup — f10-t3's chosen
   * MVP-simple "representative event" — never a synthetic cluster id, so
   * `EventInspector`'s existing `findSelected` search resolves it with no
   * new plumbing and no risk of a lookup miss on an id that was never a real
   * event.
   */
  representative: T;
  /** Every original event folded into this cluster, sorted by `at` (length 1 = unclustered; render identically to the pre-clustering single-mark path). */
  members: readonly T[];
};

/**
 * Design.md's MVP explicitly deferred event clustering; f10 adds it once
 * dense real fixtures (e.g. `fixtures/claude-code/medium`, 153 Bash/exec
 * calls in one session) showed adjacent same-kind instant marks visually
 * fusing into solid blocks at full-session zoom.
 *
 * Buckets `events` by `kind`, then within each bucket walks them in `at`
 * order using chain-linkage: an event joins the current cluster when its
 * `xScale`-projected pixel position is within `thresholdPx` of the
 * *previous* event in that same bucket (so A and C can end up in one
 * cluster via a B between them, even though A and C alone might be further
 * apart than `thresholdPx`). A bucket with only one member (or a member with
 * no near neighbor) yields a single-member cluster — callers must render
 * that identically to the pre-clustering single-mark path, never as a
 * merged/badged marker.
 *
 * Deliberately takes `xScale` as a plain function (not `TimelineContext`'s
 * `LinearScale` type) so this module stays free of a `@visx/scale` import;
 * every `LinearScale` is directly callable as `(value: number) => number`,
 * so a track can pass its own `xScale` straight through. Callers must invoke
 * this fresh every render, never memoize it against a stored domain — the
 * "relieves itself as a user zooms in" property (f9 narrows `domain`, which
 * spreads real marks further apart in pixel space) falls entirely out of
 * always clustering against the *current* `xScale`, not out of anything this
 * function does with a zoom concept it has no knowledge of.
 */
export function clusterByProximity<T extends ClusterableEvent>(
  events: readonly T[],
  xScale: (value: number) => number,
  thresholdPx: number,
): EventCluster<T>[] {
  const byKind = new Map<string, T[]>();
  for (const event of events) {
    const bucket = byKind.get(event.kind);
    if (bucket) bucket.push(event);
    else byKind.set(event.kind, [event]);
  }

  const clusters: EventCluster<T>[] = [];
  for (const bucket of byKind.values()) {
    const sorted = [...bucket].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    let current: T[] = [];
    let lastPx: number | undefined;
    for (const event of sorted) {
      const px = xScale(event.at);
      if (current.length > 0 && lastPx !== undefined && px - lastPx <= thresholdPx) {
        current.push(event);
      } else {
        if (current.length > 0) {
          clusters.push({ representative: current[0] as T, members: current });
        }
        current = [event];
      }
      lastPx = px;
    }
    if (current.length > 0) {
      clusters.push({ representative: current[0] as T, members: current });
    }
  }

  // Stable left-to-right render order across every kind's clusters combined.
  clusters.sort((a, b) => a.representative.at - b.representative.at);
  return clusters;
}
