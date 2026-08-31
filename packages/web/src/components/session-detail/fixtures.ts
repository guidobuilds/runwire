import type { Capability, Metric, SessionRollup, SessionSummary } from '../../api/types';

/**
 * Every capability a harness can declare, so an absent value in a test means
 * the session lacks it rather than the adapter being unable to report it.
 * Trace capabilities are irrelevant to the detail view and left out.
 */
export const FULL_CAPS: readonly Capability[] = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
  'timing',
  'model',
  'mode',
  'effort',
  'version',
  'turns',
  'toolCalls',
  'compactions',
  'subagents',
  'cost',
  'title',
  'git',
];

export function metric<T>(value: T, extra: Partial<Metric<T>> = {}): Metric<T> {
  return { value, confidence: 'high', source: 'fake/usage#req1', ...extra };
}

export function makeSummary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    harness: 'fake',
    depth: 0,
    project: { key: 'github.com/acme/app', name: 'app', identity: 'remote' },
    cwd: { first: '/w/app', all: ['/w/app'] },
    timing: {},
    model: { all: [], changes: 0 },
    flags: {},
    usage: {},
    counts: {},
    children: [],
    source: { path: '/w/app/a.jsonl', sizeBytes: 1, mtimeMs: 0 },
    diagnostics: [],
    ...overrides,
  };
}

export function makeRollup(overrides: Partial<SessionRollup> & { id: string }): SessionRollup {
  return {
    exclusive: { usage: {}, counts: {} },
    inclusive: { usage: {}, counts: { subagents: metric(0) } },
    descendants: 0,
    ...overrides,
  };
}
