import type { HarnessAdapter } from '../adapter/types';
import type { SessionSummary } from '../model/session';
import { COUNT_FIELDS, type Counts, USAGE_FIELDS, type Usage } from '../model/usage';

export type ComparabilityFlag = 'ok' | 'missing' | 'not-provided' | 'derived' | 'incomparable';

export type ComparabilityCell = { flag: ComparabilityFlag; note?: string };

export type ComparabilityMatrix = {
  sessionIds: string[];
  rows: Array<{ field: keyof Usage | keyof Counts; cells: ComparabilityCell[] }>;
};

const COMPARE_FIELDS: ReadonlyArray<keyof Usage | keyof Counts> = [
  ...USAGE_FIELDS,
  ...COUNT_FIELDS,
];

/**
 * A field requires SOME usage capability (per-call or cumulative) unless it
 * has a more specific one. apiCalls specifically needs per-call usage,
 * since a cumulative total alone cannot yield a call count.
 */
function requiredCapabilities(field: keyof Usage | keyof Counts): Array<string> {
  switch (field) {
    case 'cacheWrite':
      return ['usage.cacheWrite'];
    case 'reasoningOutput':
      return ['usage.reasoning'];
    case 'uncachedInput':
    case 'cachedInput':
    case 'output':
    case 'totalInput':
      return ['usage.perCall', 'usage.cumulative']; // either suffices
    case 'apiCalls':
      return ['usage.perCall'];
    case 'turns':
      return ['turns'];
    case 'toolCalls':
      return ['toolCalls'];
    case 'compactions':
      return ['compactions'];
    case 'subagents':
      return ['subagents'];
    default:
      return [];
  }
}

function hasAnyCapability(adapter: HarnessAdapter, needed: string[]): boolean {
  return needed.some((c) =>
    adapter.capabilities.includes(c as HarnessAdapter['capabilities'][number]),
  );
}

function metricOf(summary: SessionSummary, field: keyof Usage | keyof Counts) {
  if ((USAGE_FIELDS as readonly string[]).includes(field))
    return summary.usage[field as keyof Usage];
  return summary.counts[field as keyof Counts];
}

/**
 * For each comparable metric row, flags whether it is safely comparable
 * across the given sessions (docs/ARCHITECTURE.md §8). The API computes
 * this so the UI never has to re-derive the same judgment.
 */
export function comparability(
  sessions: SessionSummary[],
  adapters: Map<string, HarnessAdapter>,
): ComparabilityMatrix {
  const rows: ComparabilityMatrix['rows'] = [];

  for (const field of COMPARE_FIELDS) {
    const explanationsByHarness = new Map<string, string | undefined>();
    for (const s of sessions) {
      if (!explanationsByHarness.has(s.harness)) {
        explanationsByHarness.set(s.harness, adapters.get(s.harness)?.explain(field));
      }
    }
    const distinctExplanations = new Set(
      [...explanationsByHarness.values()].filter((e): e is string => e !== undefined),
    );
    const rowIsIncomparable = distinctExplanations.size > 1;

    const cells: ComparabilityCell[] = sessions.map((s) => {
      const adapter = adapters.get(s.harness);
      const needed = requiredCapabilities(field);
      const provided = !adapter || needed.length === 0 || hasAnyCapability(adapter, needed);
      if (!provided) return { flag: 'not-provided' };

      const metric = metricOf(s, field);
      if (!metric) return { flag: 'missing' };

      if (rowIsIncomparable) {
        return {
          flag: 'incomparable',
          note: 'Harnesses in this comparison define this metric differently',
        };
      }
      if (metric.confidence !== 'high') {
        return { flag: 'derived', note: metric.note };
      }
      return { flag: 'ok' };
    });

    rows.push({ field, cells });
  }

  return { sessionIds: sessions.map((s) => s.id), rows };
}
