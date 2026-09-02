import { describe, expect, test } from 'bun:test';
import type { SourceRef } from '../adapter/types';
import type { Metric } from '../model/metric';
import type { ProjectRef, SessionSummary } from '../model/session';
import type { ReducedSession } from '../reduce/reduce';
import type { SourcedReducedSession } from './link';
import { link } from './link';

function metric(value: number, confidence: Metric['confidence'] = 'high'): Metric {
  return { value, confidence, source: 'test' };
}

function labelMetric(value: string, confidence: Metric['confidence'] = 'high'): Metric<string> {
  return { value, confidence, source: 'test' };
}

const project: ProjectRef = { key: 'k', name: 'k', identity: 'cwd' };
function buildProject(): ProjectRef {
  return project;
}

function ref(sourceId: string, kind: 'root' | 'child' = 'root'): SourceRef {
  return { sourceId, path: `/x/${sourceId}.jsonl`, kind, sizeBytes: 1, mtimeMs: 0 };
}

function reduced(sourceId: string, overrides: Partial<ReducedSession> = {}): ReducedSession {
  return {
    sourceId,
    harness: 'claude-code',
    cwd: { first: '/home/u/x', all: ['/home/u/x'] },
    timing: {},
    model: { all: [], changes: 0 },
    flags: {},
    usage: {},
    counts: {},
    diagnostics: [],
    ...overrides,
  };
}

describe('link - parent resolution and depth', () => {
  test('a session with no parentSourceId is a root at depth 0', () => {
    const { summaries } = link([{ ref: ref('a'), reduced: reduced('a') }], buildProject);
    expect(summaries[0]?.parentId).toBeUndefined();
    expect(summaries[0]?.depth).toBe(0);
  });

  test('resolves parent/child ids and computes depth regardless of input order', () => {
    const items: SourcedReducedSession[] = [
      {
        ref: ref('child', 'child'),
        reduced: reduced('child', { parentSourceId: 'root', relation: 'subagent' }),
      },
      { ref: ref('root'), reduced: reduced('root') },
    ];
    const { summaries } = link(items, buildProject);
    const root = summaries.find((s) => s.id === 'claude-code:root');
    const child = summaries.find((s) => s.id === 'claude-code:child');
    expect(root?.children).toEqual(['claude-code:child']);
    expect(child?.parentId).toBe('claude-code:root');
    expect(child?.depth).toBe(1);
    expect(child?.relation).toBe('subagent');
  });

  test('depth is computed for a three-level tree via BFS from the root', () => {
    const items: SourcedReducedSession[] = [
      { ref: ref('root'), reduced: reduced('root') },
      {
        ref: ref('mid', 'child'),
        reduced: reduced('mid', { parentSourceId: 'root', relation: 'subagent' }),
      },
      {
        ref: ref('leaf', 'child'),
        reduced: reduced('leaf', { parentSourceId: 'mid', relation: 'subagent' }),
      },
    ];
    const { summaries } = link(items, buildProject);
    const depthById = new Map(summaries.map((s) => [s.id, s.depth]));
    expect(depthById.get('claude-code:root')).toBe(0);
    expect(depthById.get('claude-code:mid')).toBe(1);
    expect(depthById.get('claude-code:leaf')).toBe(2);
  });

  test('viaCallId survives from ReducedSession onto the built SessionSummary (ADR 0001)', () => {
    const items: SourcedReducedSession[] = [
      { ref: ref('root'), reduced: reduced('root') },
      {
        ref: ref('child', 'child'),
        reduced: reduced('child', {
          parentSourceId: 'root',
          relation: 'subagent',
          viaCallId: 'call-123',
        }),
      },
    ];
    const { summaries } = link(items, buildProject);
    const root = summaries.find((s) => s.id === 'claude-code:root');
    const child = summaries.find((s) => s.id === 'claude-code:child');
    expect(root?.viaCallId).toBeUndefined();
    expect(child?.viaCallId).toBe('call-123');
  });

  test('an unresolvable parent is kept as a root and produces an orphan-child diagnostic', () => {
    const items: SourcedReducedSession[] = [
      {
        ref: ref('orphan', 'child'),
        reduced: reduced('orphan', { parentSourceId: 'missing-parent', relation: 'subagent' }),
      },
    ];
    const { summaries } = link(items, buildProject);
    const s = summaries[0];
    expect(s?.parentId).toBeUndefined();
    expect(s?.depth).toBe(0);
    expect(s?.relation).toBe('subagent');
    expect(s?.diagnostics.some((d) => d.code === 'orphan-child')).toBe(true);
  });

  test('parent resolution is scoped per harness (same sourceId in a different harness does not match)', () => {
    const items: SourcedReducedSession[] = [
      { ref: ref('root'), reduced: reduced('root', { harness: 'codex' }) },
      {
        ref: ref('child', 'child'),
        reduced: reduced('child', {
          harness: 'claude-code',
          parentSourceId: 'root',
          relation: 'subagent',
        }),
      },
    ];
    const { summaries } = link(items, buildProject);
    const child = summaries.find((s) => s.id === 'claude-code:child');
    expect(child?.parentId).toBeUndefined();
    expect(child?.diagnostics.some((d) => d.code === 'orphan-child')).toBe(true);
  });
});

describe('link - rollups', () => {
  test('a childless root has zero descendants and identical exclusive/inclusive usage', () => {
    const { rollups } = link(
      [{ ref: ref('a'), reduced: reduced('a', { usage: { output: metric(100) } }) }],
      buildProject,
    );
    const r = rollups.get('claude-code:a');
    expect(r?.descendants).toBe(0);
    expect(r?.exclusive.usage.output?.value).toBe(100);
    expect(r?.inclusive.usage.output?.value).toBe(100);
    expect(r?.inclusive.counts.subagents.value).toBe(0);
  });

  test('inclusive usage sums the root and every descendant, at any depth', () => {
    const items: SourcedReducedSession[] = [
      { ref: ref('root'), reduced: reduced('root', { usage: { output: metric(100) } }) },
      {
        ref: ref('mid', 'child'),
        reduced: reduced('mid', {
          parentSourceId: 'root',
          relation: 'subagent',
          usage: { output: metric(20) },
        }),
      },
      {
        ref: ref('leaf', 'child'),
        reduced: reduced('leaf', {
          parentSourceId: 'mid',
          relation: 'subagent',
          usage: { output: metric(5) },
        }),
      },
    ];
    const { rollups } = link(items, buildProject);
    const rootRollup = rollups.get('claude-code:root');
    expect(rootRollup?.inclusive.usage.output?.value).toBe(125);
    expect(rootRollup?.descendants).toBe(2);
    expect(rootRollup?.inclusive.counts.subagents.value).toBe(2);

    const midRollup = rollups.get('claude-code:mid');
    expect(midRollup?.inclusive.usage.output?.value).toBe(25);
    expect(midRollup?.descendants).toBe(1);
  });

  test('a field missing on one contributor yields a partial rollup capped at medium confidence', () => {
    const items: SourcedReducedSession[] = [
      { ref: ref('root'), reduced: reduced('root', { usage: { output: metric(100) } }) },
      {
        ref: ref('child', 'child'),
        reduced: reduced('child', { parentSourceId: 'root', relation: 'subagent', usage: {} }),
      },
    ];
    const { rollups } = link(items, buildProject);
    const r = rollups.get('claude-code:root');
    expect(r?.inclusive.usage.output?.value).toBe(100);
    expect(r?.inclusive.usage.output?.confidence).toBe('medium');
    expect(r?.inclusive.usage.output?.note).toBe('partial: 1 of 2 agents reported');
  });

  test('turns are copied from the root, never summed with descendants', () => {
    const items: SourcedReducedSession[] = [
      { ref: ref('root'), reduced: reduced('root', { counts: { turns: metric(5) } }) },
      {
        ref: ref('child', 'child'),
        reduced: reduced('child', {
          parentSourceId: 'root',
          relation: 'subagent',
          counts: { turns: metric(50) },
        }),
      },
    ];
    const { rollups } = link(items, buildProject);
    expect(rollups.get('claude-code:root')?.inclusive.counts.turns?.value).toBe(5);
  });

  test('a low-confidence contributor pulls the rolled-up confidence down to low even without partial data', () => {
    const items: SourcedReducedSession[] = [
      { ref: ref('root'), reduced: reduced('root', { usage: { output: metric(100, 'high') } }) },
      {
        ref: ref('child', 'child'),
        reduced: reduced('child', {
          parentSourceId: 'root',
          relation: 'subagent',
          usage: { output: metric(10, 'low') },
        }),
      },
    ];
    const { rollups } = link(items, buildProject);
    expect(rollups.get('claude-code:root')?.inclusive.usage.output?.confidence).toBe('low');
  });
});

/*
 * Guard for the hand-written SessionSummary literal in link.ts.
 *
 * TypeScript already catches a dropped *required* SessionSummary field
 * (project, cwd, usage, ...). The silent-loss risk is the optional ones:
 * harnessVersion, relation, viaCallId, agentType, initiator, title, mode,
 * effort, cost - omitting any of them from the literal still compiles and
 * still type-checks. This block closes that hole from both ends:
 *
 *  - compile time: REDUCED_FIELD_DISPOSITION is total over keyof
 *    ReducedSession (mapped with -?), so a new reduced field that nobody
 *    classifies is a typecheck error, not a silent pass;
 *  - run time: every key classified passthrough is asserted generically
 *    against a fixture where that field has a distinctive value.
 *
 * The one remaining escape hatch is a human writing a false `reason` to
 * demote a real passthrough field to 'dropped'/'rebuilt'. That is a visible
 * lie in review, not a silent regression.
 */
type Disposition =
  /** Copied verbatim onto SessionSummary under the same key. */
  | { kind: 'passthrough' }
  /** Copied verbatim under the same key *and* used to derive something else. */
  | { kind: 'passthrough+derived'; reason: string }
  /** Reaches SessionSummary under a different key. */
  | { kind: 'renamed'; reason: string }
  /** Reaches SessionSummary under the same key but reshaped. */
  | { kind: 'rebuilt'; reason: string }
  /** Deliberately does not reach SessionSummary. */
  | { kind: 'dropped'; reason: string };

type NonPassthrough = Extract<Disposition, { reason: string }>;

/**
 * Total over ReducedSession's keys: `-?` strips optionality so an omitted
 * entry is a compile error. A reduced key SessionSummary does not declare
 * cannot claim to be a passthrough.
 */
type DispositionMap = {
  [K in keyof ReducedSession]-?: K extends keyof SessionSummary ? Disposition : NonPassthrough;
};

const REDUCED_FIELD_DISPOSITION: DispositionMap = {
  sourceId: {
    kind: 'renamed',
    reason: 'namespaced into SessionSummary.id as harness + ":" + sourceId',
  },
  harness: {
    kind: 'passthrough+derived',
    reason: 'also composes id and scopes parent lookup + buildProject',
  },
  harnessVersion: { kind: 'passthrough' },
  parentSourceId: {
    kind: 'renamed',
    reason: 'resolved within the harness into parentId; left undefined (orphan-child) when unknown',
  },
  relation: { kind: 'passthrough' },
  depthHint: {
    kind: 'dropped',
    reason:
      'link recomputes depth by BFS over the resolved tree; the adapter hint is never read here',
  },
  viaCallId: { kind: 'passthrough' },
  agentType: { kind: 'passthrough' },
  initiator: { kind: 'passthrough' },
  title: { kind: 'passthrough' },
  cwd: {
    kind: 'passthrough+derived',
    reason: 'also fed to buildProject to produce SessionSummary.project',
  },
  git: {
    kind: 'rebuilt',
    reason: 'remote is dropped and {branch, commit} rebuilt only when one of them is present',
  },
  timing: { kind: 'passthrough' },
  model: { kind: 'passthrough' },
  mode: { kind: 'passthrough' },
  effort: { kind: 'passthrough' },
  flags: { kind: 'passthrough' },
  usage: { kind: 'passthrough' },
  counts: { kind: 'passthrough' },
  cost: { kind: 'passthrough' },
  diagnostics: {
    kind: 'rebuilt',
    reason: 'copied into a fresh array that link may append an orphan-child diagnostic to',
  },
};

type PassthroughKey = keyof ReducedSession & keyof SessionSummary;

const PASSTHROUGH_KEYS: PassthroughKey[] = (
  Object.entries(REDUCED_FIELD_DISPOSITION) as Array<[keyof ReducedSession, Disposition]>
)
  .filter(([, d]) => d.kind === 'passthrough' || d.kind === 'passthrough+derived')
  .map(([key]) => key as PassthroughKey);

/**
 * Every field carries a distinctive, non-default, defined value so that a
 * dropped assignment in link.ts cannot coincidentally match. `Required<>`
 * makes a newly added reduced field a compile error here too.
 */
const EXHAUSTIVE_REDUCED: Required<ReducedSession> = {
  sourceId: 'exhaustive',
  harness: 'codex',
  harnessVersion: { first: '0.1.0', last: '0.9.9' },
  parentSourceId: 'exhaustive-parent',
  relation: 'teammate',
  depthHint: 3,
  viaCallId: 'call-exhaustive',
  agentType: 'forge-adversary',
  initiator: {
    value: { kind: 'machine', surface: 'sdk-py', automation: 'sdk' },
    confidence: 'medium',
    source: 'test/exhaustive',
  },
  title: { value: 'exhaustive fixture title', contentDerived: true },
  cwd: { first: '/repo/exhaustive', all: ['/repo/exhaustive', '/repo/exhaustive/pkg'] },
  git: { branch: 'feat/exhaustive', commit: 'deadbee', remote: 'git@example.com:acme/x.git' },
  timing: {
    startedAt: labelMetric('2026-01-01T00:00:00.000Z'),
    endedAt: labelMetric('2026-01-01T00:20:34.000Z'),
    durationMs: metric(1234),
  },
  model: {
    primary: labelMetric('claude-opus-5'),
    all: ['claude-opus-5', 'gpt-5-codex'],
    changes: 2,
  },
  mode: { primary: labelMetric('plan'), all: ['plan', 'build'], changes: 1 },
  effort: labelMetric('high'),
  flags: { resumed: true, forkedFrom: 'forked-from-src', versionChanged: true },
  usage: { uncachedInput: metric(11), output: metric(4242) },
  counts: { turns: metric(7), apiCalls: metric(8), toolCalls: metric(9), compactions: metric(1) },
  cost: { value: { usd: 3.5 }, confidence: 'low', source: 'test/exhaustive' },
  diagnostics: [],
};

describe('link - reduced -> summary field coverage', () => {
  test('carries every reduced field the summary declares', () => {
    const items: SourcedReducedSession[] = [
      {
        ref: ref('exhaustive-parent'),
        reduced: reduced('exhaustive-parent', { harness: 'codex' }),
      },
      { ref: ref('exhaustive', 'child'), reduced: EXHAUSTIVE_REDUCED },
    ];
    const { summaries } = link(items, buildProject);
    const summary = summaries.find((s) => s.id === 'codex:exhaustive');
    expect(summary).toBeDefined();
    if (!summary) return;

    expect(PASSTHROUGH_KEYS.length).toBeGreaterThan(0);
    for (const key of PASSTHROUGH_KEYS) {
      const expected = EXHAUSTIVE_REDUCED[key];
      // An undefined fixture value would make the next assertion vacuous.
      expect(expected).toBeDefined();
      expect(summary[key]).toEqual(expected);
    }
  });

  test('the provenance fields this guard was written for stay passthrough', () => {
    // Not a second hand-written copy of the check above: this only stops the
    // exceptions list from quietly absorbing the fields (ADR 0001, initiator)
    // whose silent loss motivated the guard.
    for (const key of ['initiator', 'agentType', 'viaCallId', 'title'] as const) {
      expect(REDUCED_FIELD_DISPOSITION[key].kind).toBe('passthrough');
    }
  });
});
