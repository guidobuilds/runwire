import type { SourceRef } from '../adapter/types';
import { makeDiagnostic } from '../model/diagnostic';
import type { HarnessId } from '../model/harness';
import { type Metric, minConfidence } from '../model/metric';
import type { SessionRollup } from '../model/rollup';
import type { SessionSummary } from '../model/session';
import { COUNT_FIELDS, type Counts, USAGE_NUMBER_FIELDS, type Usage } from '../model/usage';
import type { ReducedSession } from '../reduce/reduce';

export type SourcedReducedSession = { ref: SourceRef; reduced: ReducedSession };

export type LinkResult = { summaries: SessionSummary[]; rollups: Map<string, SessionRollup> };

/**
 * Builds SessionSummary ids, resolves parent/child links within each
 * harness, computes tree depth, and produces exclusive+inclusive rollups
 * (docs/ARCHITECTURE.md §3.4, §2.4). Never mutates its input.
 */
export function link(
  items: SourcedReducedSession[],
  buildProject: (
    harness: HarnessId,
    cwd: { first: string; all: string[] },
  ) => SessionSummary['project'],
): LinkResult {
  const byId = new Map<string, SessionSummary>();
  const idBySourceKey = new Map<string, string>(); // `${harness}:${sourceId}` for lookup by parentSourceId

  for (const { reduced } of items) {
    const id = `${reduced.harness}:${reduced.sourceId}`;
    idBySourceKey.set(id, id);
  }

  // Pass 1: build every summary with parentId unresolved (children empty).
  const parentSourceKeyOf = new Map<string, string | undefined>();
  for (const { ref, reduced } of items) {
    const id = `${reduced.harness}:${reduced.sourceId}`;
    const diagnostics = [...reduced.diagnostics];

    let parentId: string | undefined;
    const parentSourceKey = reduced.parentSourceId
      ? `${reduced.harness}:${reduced.parentSourceId}`
      : undefined;
    parentSourceKeyOf.set(id, parentSourceKey);

    if (parentSourceKey) {
      const resolved = idBySourceKey.get(parentSourceKey);
      if (resolved) {
        parentId = resolved;
      } else {
        diagnostics.push(
          makeDiagnostic({
            level: 'warn',
            code: 'orphan-child',
            message: 'Parent source was not found; keeping this session as a root',
            harness: reduced.harness,
            path: ref.path,
          }),
        );
      }
    }

    const summary: SessionSummary = {
      id,
      harness: reduced.harness,
      harnessVersion: reduced.harnessVersion,
      parentId,
      // Kept even for an orphan child (parentId unresolved) so its relation
      // is still visible - see the orphan-child diagnostic above.
      relation: reduced.relation,
      depth: 0, // filled in pass 2
      agentType: reduced.agentType,
      title: reduced.title,
      project: buildProject(reduced.harness, reduced.cwd),
      cwd: reduced.cwd,
      git:
        reduced.git?.branch || reduced.git?.commit
          ? { branch: reduced.git.branch, commit: reduced.git.commit }
          : undefined,
      timing: reduced.timing,
      model: reduced.model,
      mode: reduced.mode,
      effort: reduced.effort,
      flags: reduced.flags,
      usage: reduced.usage,
      counts: reduced.counts,
      cost: reduced.cost,
      children: [],
      source: { path: ref.path, sizeBytes: ref.sizeBytes, mtimeMs: ref.mtimeMs },
      diagnostics,
    };
    byId.set(id, summary);
  }

  // Pass 2: children arrays + depth via BFS from roots. Guards against cycles.
  for (const summary of byId.values()) {
    if (summary.parentId) byId.get(summary.parentId)?.children.push(summary.id);
  }

  const depthOf = new Map<string, number>();
  const queue: string[] = [];
  for (const summary of byId.values()) {
    if (!summary.parentId) {
      depthOf.set(summary.id, 0);
      queue.push(summary.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const depth = depthOf.get(id) ?? 0;
    const summary = byId.get(id);
    if (!summary) continue;
    for (const childId of summary.children) {
      if (depthOf.has(childId)) continue; // cycle guard
      depthOf.set(childId, depth + 1);
      queue.push(childId);
    }
  }
  for (const summary of byId.values()) {
    summary.depth = depthOf.get(summary.id) ?? 0;
  }

  // Rollups: walk each node's full subtree.
  const rollups = new Map<string, SessionRollup>();
  for (const summary of byId.values()) {
    const descendants = collectDescendants(summary.id, byId);
    const inclusive = rollUsageAndCounts(
      [summary.usage, ...descendants.map((d) => d.usage)],
      [summary.counts, ...descendants.map((d) => d.counts)],
    );
    rollups.set(summary.id, {
      id: summary.id,
      exclusive: { usage: summary.usage, counts: summary.counts },
      inclusive: {
        usage: inclusive.usage,
        counts: {
          ...inclusive.counts,
          subagents: {
            value: descendants.length,
            confidence: 'high',
            source: 'core/link#descendants',
          },
        },
      },
      descendants: descendants.length,
    });
  }

  return { summaries: [...byId.values()], rollups };
}

function collectDescendants(id: string, byId: Map<string, SessionSummary>): SessionSummary[] {
  const out: SessionSummary[] = [];
  const stack = [...(byId.get(id)?.children ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const childId = stack.pop();
    if (childId === undefined || seen.has(childId)) continue;
    seen.add(childId);
    const child = byId.get(childId);
    if (!child) continue;
    out.push(child);
    stack.push(...child.children);
  }
  return out;
}

function rollUsageAndCounts(usages: Usage[], counts: Counts[]): { usage: Usage; counts: Counts } {
  const usage: Usage = {};
  for (const field of USAGE_NUMBER_FIELDS) {
    usage[field] = sumMetricField(usages, field);
  }
  // totalInput is re-derived from the rolled-up components rather than summed directly.
  if (usage.uncachedInput || usage.cachedInput || usage.cacheWrite) {
    const parts = [usage.uncachedInput, usage.cachedInput, usage.cacheWrite].filter(
      (m): m is Metric => m !== undefined,
    );
    if (parts.length > 0) {
      usage.totalInput = {
        value: parts.reduce((sum, m) => sum + m.value, 0),
        confidence: minConfidence(parts.map((m) => m.confidence)),
        source: 'core/link#rollup-totalInput',
        note: 'derived: uncachedInput + cachedInput + cacheWrite',
      };
    }
  }

  const countsOut: Counts = {};
  for (const field of COUNT_FIELDS) {
    if (field === 'turns' || field === 'subagents') continue; // turns copied from root only; subagents set by caller
    countsOut[field] = sumMetricField(counts, field);
  }
  if (counts[0]?.turns) countsOut.turns = counts[0].turns;

  return { usage, counts: countsOut };
}

function sumMetricField<K extends string>(
  items: Array<Partial<Record<K, Metric>>>,
  field: K,
): Metric | undefined {
  const present = items.map((it) => it[field]).filter((m): m is Metric => m !== undefined);
  if (present.length === 0) return undefined;
  const value = present.reduce((sum, m) => sum + m.value, 0);
  const confidences = present.map((m) => m.confidence);
  const partial = present.length < items.length;
  const confidence = partial
    ? weakenToAtMostMedium(minConfidence(confidences))
    : minConfidence(confidences);
  return {
    value,
    confidence,
    source: 'core/link#rollup',
    note: partial ? `partial: ${present.length} of ${items.length} agents reported` : undefined,
  };
}

function weakenToAtMostMedium(c: Metric['confidence']): Metric['confidence'] {
  return c === 'high' ? 'medium' : c;
}
