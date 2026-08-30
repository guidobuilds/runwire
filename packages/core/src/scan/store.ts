import type { AdapterContext, HarnessAdapter, SourceRef } from '../adapter/types';
import type { HarnessAggregate, ProjectAggregate } from '../model/aggregate';
import type { SessionRollup } from '../model/rollup';
import type { SessionSummary } from '../model/session';
import type { SessionTrace } from '../model/trace';
import { USAGE_NUMBER_FIELDS, type Usage, zeroUsageNumbers } from '../model/usage';
import { buildTrace } from '../trace/trace';
import {
  createScanState,
  type ScanOptions,
  type ScanReport,
  type ScanState,
  scan,
} from './pipeline';

const DEFAULT_TRACE_LRU_SIZE = 16;

type TraceCacheEntry = { key: string; trace: SessionTrace };

/**
 * The in-memory store behind Scout's API (docs/ARCHITECTURE.md §5, §8). No
 * durable state: `rescan()` rebuilds summaries/rollups from source data,
 * reusing unchanged sources via the incremental cache.
 */
export class ScoutStore {
  private state: ScanState = createScanState();
  private adaptersById = new Map<string, HarnessAdapter>();
  private traceCache: TraceCacheEntry[] = [];
  private lastReport?: ScanReport;

  constructor(
    private adapters: HarnessAdapter[],
    private ctx: AdapterContext,
    private opts: ScanOptions = {},
    private traceLruSize = DEFAULT_TRACE_LRU_SIZE,
  ) {
    for (const a of adapters) this.adaptersById.set(a.id, a);
  }

  async rescan(): Promise<ScanReport> {
    this.lastReport = await scan(this.adapters, this.ctx, this.state, this.opts);
    this.traceCache = []; // a rescan may change source (size, mtime); drop stale traces
    return this.lastReport;
  }

  getLastReport(): ScanReport | undefined {
    return this.lastReport;
  }

  getAdapters(): HarnessAdapter[] {
    return this.adapters;
  }

  getSummaries(): SessionSummary[] {
    return this.state.summaries;
  }

  getRoots(): SessionSummary[] {
    return this.state.summaries.filter((s) => !s.parentId);
  }

  getSession(id: string): SessionSummary | undefined {
    return this.state.summaries.find((s) => s.id === id);
  }

  getRollup(id: string): SessionRollup | undefined {
    return this.state.rollups.get(id);
  }

  getSubtree(rootId: string): SessionSummary[] {
    const byId = new Map(this.state.summaries.map((s) => [s.id, s]));
    const root = byId.get(rootId);
    if (!root) return [];
    const out: SessionSummary[] = [root];
    const stack = [...root.children];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) continue;
      const s = byId.get(id);
      if (!s) continue;
      out.push(s);
      stack.push(...s.children);
    }
    return out;
  }

  getDiagnostics(): import('../model/diagnostic').Diagnostic[] {
    return this.state.summaries.flatMap((s) => s.diagnostics);
  }

  getProjects(): ProjectAggregate[] {
    const roots = this.getRoots();
    const byKey = new Map<string, ProjectAggregate>();
    for (const root of roots) {
      const rollup = this.state.rollups.get(root.id);
      const existing = byKey.get(root.project.key);
      const latest = latestOf(
        existing?.latestActivityAt,
        root.timing.endedAt?.value ?? root.timing.startedAt?.value,
      );
      if (!existing) {
        byKey.set(root.project.key, {
          project: root.project,
          sessionCount: 1,
          harnesses: [root.harness],
          latestActivityAt: latest,
          aggregateUsage: rollup ? { ...rollup.inclusive.usage } : {},
        });
      } else {
        existing.sessionCount++;
        if (!existing.harnesses.includes(root.harness)) existing.harnesses.push(root.harness);
        existing.latestActivityAt = latest;
        if (rollup)
          existing.aggregateUsage = sumUsage(existing.aggregateUsage, rollup.inclusive.usage);
      }
    }
    return [...byKey.values()];
  }

  getHarnesses(): HarnessAggregate[] {
    const roots = this.getRoots();
    const byHarness = new Map<string, HarnessAggregate>();
    for (const root of roots) {
      const rollup = this.state.rollups.get(root.id);
      const existing = byHarness.get(root.harness);
      const latest = latestOf(
        existing?.latestActivityAt,
        root.timing.endedAt?.value ?? root.timing.startedAt?.value,
      );
      if (!existing) {
        byHarness.set(root.harness, {
          harness: root.harness,
          sessionCount: 1,
          projects: [root.project.key],
          latestActivityAt: latest,
          aggregateUsage: rollup ? { ...rollup.inclusive.usage } : {},
        });
      } else {
        existing.sessionCount++;
        if (!existing.projects.includes(root.project.key)) existing.projects.push(root.project.key);
        existing.latestActivityAt = latest;
        if (rollup)
          existing.aggregateUsage = sumUsage(existing.aggregateUsage, rollup.inclusive.usage);
      }
    }
    return [...byHarness.values()];
  }

  /**
   * Builds a session's timeline on demand (docs/ARCHITECTURE.md §5): traces
   * are never part of the scan or the incremental cache, only a small LRU.
   */
  async getTrace(id: string): Promise<SessionTrace | undefined> {
    const cached = this.state.cache.get(id);
    if (!cached) return undefined;
    const cacheKey = `${id}#${cached.ref.sizeBytes}#${cached.ref.mtimeMs}`;

    const hit = this.traceCache.find((e) => e.key === cacheKey);
    if (hit) {
      this.traceCache = [hit, ...this.traceCache.filter((e) => e !== hit)]; // move to front
      return hit.trace;
    }

    const [harness] = splitId(id);
    const adapter = this.adaptersById.get(harness);
    if (!adapter) return undefined;

    const trace = await buildTrace(id, adapter.parse(cached.ref, this.ctx));
    fillChildIds(trace, id, this.state.summaries);

    this.traceCache = [{ key: cacheKey, trace }, ...this.traceCache].slice(0, this.traceLruSize);
    return trace;
  }
}

function splitId(id: string): [string, string] {
  const i = id.indexOf(':');
  return i === -1 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)];
}

function fillChildIds(trace: SessionTrace, parentId: string, summaries: SessionSummary[]): void {
  // viaCallId is link-only metadata, not stored on SessionSummary itself;
  // child linkage is therefore matched by parentId + emission order against
  // `agent` category tool steps that have no childId yet. Exact per-call
  // matching via viaCallId is a documented later refinement (docs/ARCHITECTURE.md §13).
  const children = summaries.filter((s) => s.parentId === parentId);
  const agentSteps = trace.steps.filter(
    (s): s is Extract<(typeof trace.steps)[number], { kind: 'tool' }> =>
      s.kind === 'tool' && s.category === 'agent',
  );
  for (let idx = 0; idx < Math.min(children.length, agentSteps.length); idx++) {
    const child = children[idx];
    const step = agentSteps[idx];
    if (child && step) step.childId = child.id;
  }
}

function sumUsage(a: Usage, b: Usage): Usage {
  const out: Usage = { ...a };
  for (const field of USAGE_NUMBER_FIELDS) {
    const av = a[field];
    const bv = b[field];
    if (!av && !bv) continue;
    out[field] = {
      value: (av?.value ?? 0) + (bv?.value ?? 0),
      confidence: weakerOf(av?.confidence, bv?.confidence),
      source: 'core/store#aggregate',
    };
  }
  return out;
}

function weakerOf(
  a: 'high' | 'medium' | 'low' | undefined,
  b: 'high' | 'medium' | 'low' | undefined,
): 'high' | 'medium' | 'low' {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const av = a ?? 'high';
  const bv = b ?? 'high';
  return rank[av] <= rank[bv] ? av : bv;
}

function latestOf(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export type { SourceRef };
export { zeroUsageNumbers };
