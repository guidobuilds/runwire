import { useSession, useTrace, useTraces } from '../../api/queries';
import type { SessionDetailResponse, SessionTrace } from '../../api/types';
import {
  type AgentSpan,
  buildAgentSpans,
  buildComponentEvents,
  buildHarnessEvents,
  buildTokenSeries,
  type ComponentEvent,
  type HarnessEvent,
  resolveRootAnchor,
  type TokenPoint,
} from '../../lib/timeline';

/**
 * Composition hook for `SessionTimeline` (design.md §3.3): wires
 * `useSession`/`useTrace`/`useTraces` (all already used elsewhere in
 * `packages/web`, so React Query dedupes/shares cache — no new fetching
 * primitive) into the four derived event arrays `lib/timeline.ts`'s pure
 * builders produce, anchored to one shared `rootAnchor`.
 *
 * `rootAnchor === undefined` is the caller's signal to render the "No
 * timing data available" empty state (f7-t2) instead of an empty/misleading
 * chart — every derived array is empty in that case rather than partially
 * populated, since none of the builders can run without an anchor.
 */
export type SessionTimelineData = {
  /** The full session-detail fetch (`summary`/`rollup`/`subtree`/`diagnostics`); `undefined` while `useSession` is still resolving or the session was not found. */
  summary: SessionDetailResponse | undefined;
  rootAnchor: string | undefined;
  agentSpans: readonly AgentSpan[];
  tokenSeries: readonly TokenPoint[];
  harnessEvents: readonly HarnessEvent[];
  componentEvents: readonly ComponentEvent[];
  isPending: boolean;
};

const EMPTY: readonly never[] = [];

export function useSessionTimelineData(sessionId: string): SessionTimelineData {
  const query = useSession(sessionId);
  const rootTrace = useTrace(sessionId);
  const subtreeIds = query.data?.subtree.summaries.map((s) => s.id) ?? [];
  const subtreeTraces = useTraces(subtreeIds);

  const isPending =
    query.isPending || rootTrace.isPending || subtreeTraces.some((t) => t.isPending);

  if (!query.data) {
    return {
      summary: undefined,
      rootAnchor: undefined,
      agentSpans: EMPTY,
      tokenSeries: EMPTY,
      harnessEvents: EMPTY,
      componentEvents: EMPTY,
      isPending,
    };
  }

  const rootAnchor = resolveRootAnchor(query.data.summary, rootTrace.data);

  if (!rootAnchor) {
    return {
      summary: query.data,
      rootAnchor: undefined,
      agentSpans: EMPTY,
      tokenSeries: EMPTY,
      harnessEvents: EMPTY,
      componentEvents: EMPTY,
      isPending,
    };
  }

  // Merge every subtree member's own trace (root included — `subtree.summaries`
  // already carries the root, per `SessionDetailResponse`'s shape), keyed by
  // session id for `buildTokenSeries`/`buildHarnessEvents`/`buildComponentEvents`.
  // A member whose own trace fetch hasn't resolved (or errored) is simply
  // absent from the map, not a fake empty trace.
  const tracesById = new Map<string, SessionTrace>();
  subtreeIds.forEach((id, index) => {
    const data = subtreeTraces[index]?.data;
    if (data) tracesById.set(id, data);
  });

  return {
    summary: query.data,
    rootAnchor,
    agentSpans: buildAgentSpans(rootAnchor, query.data.subtree.summaries),
    tokenSeries: buildTokenSeries(rootAnchor, tracesById),
    harnessEvents: buildHarnessEvents(rootAnchor, tracesById).events,
    componentEvents: buildComponentEvents(rootAnchor, tracesById).events,
    isPending,
  };
}
