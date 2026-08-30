import { describe, expect, test } from 'bun:test';
import type { SourceRef } from '../adapter/types';
import type { Metric } from '../model/metric';
import type { ProjectRef } from '../model/session';
import type { ReducedSession } from '../reduce/reduce';
import type { SourcedReducedSession } from './link';
import { link } from './link';

function metric(value: number, confidence: Metric['confidence'] = 'high'): Metric {
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
