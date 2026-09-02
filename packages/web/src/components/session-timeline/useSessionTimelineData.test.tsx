import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SessionTrace, TraceStep } from '../../api/types';
import { makeRollup, makeSummary, metric } from '../session-detail/fixtures';
import { useSessionTimelineData } from './useSessionTimelineData';

const shared = vi.hoisted(() => ({
  sessionResult: { isPending: false, error: null, data: undefined } as Record<string, unknown>,
  traceResult: { isPending: false, error: null, data: undefined } as Record<string, unknown>,
  tracesById: {} as Record<string, { isPending: boolean; error: null; data: unknown }>,
  tracesCalledWithIds: [] as string[][],
}));

vi.mock('../../api/queries', () => ({
  useSession: () => shared.sessionResult,
  useTrace: () => shared.traceResult,
  useTraces: (ids: readonly string[]) => {
    shared.tracesCalledWithIds.push([...ids]);
    return ids.map(
      (id) => shared.tracesById[id] ?? { isPending: false, error: null, data: undefined },
    );
  },
}));

const ROOT_START = '2026-08-31T09:00:00.000Z';

function iso(offsetMs: number): string {
  return new Date(Date.parse(ROOT_START) + offsetMs).toISOString();
}

function trace(steps: TraceStep[], axisStartedAt?: string): SessionTrace {
  return {
    id: 'fake:root',
    steps,
    models: ['sonnet-4'],
    axis: { steps: steps.length, startedAt: axisStartedAt },
    totals: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
  };
}

afterEach(() => {
  cleanup();
  shared.tracesCalledWithIds = [];
});

describe('base session still pending', () => {
  test('returns isPending true, no summary, empty derived arrays', () => {
    shared.sessionResult = { isPending: true, error: null, data: undefined };
    shared.traceResult = { isPending: true, error: null, data: undefined };
    shared.tracesById = {};

    const { result } = renderHook(() => useSessionTimelineData('fake:root'));
    expect(result.current.isPending).toBe(true);
    expect(result.current.summary).toBeUndefined();
    expect(result.current.rootAnchor).toBeUndefined();
    expect(result.current.agentSpans).toEqual([]);
    expect(result.current.tokenSeries).toEqual([]);
    expect(result.current.harnessEvents).toEqual([]);
    expect(result.current.componentEvents).toEqual([]);
  });
});

describe('no timing data (resolveRootAnchor undefined)', () => {
  test('summary is present but every derived array stays empty when there is no root anchor', () => {
    const root = makeSummary({ id: 'fake:root', timing: {} });
    shared.sessionResult = {
      isPending: false,
      error: null,
      data: {
        summary: root,
        rollup: makeRollup({ id: 'fake:root' }),
        subtree: { summaries: [root], rollups: { 'fake:root': makeRollup({ id: 'fake:root' }) } },
        diagnostics: [],
      },
    };
    shared.traceResult = { isPending: false, error: null, data: undefined };
    shared.tracesById = {};

    const { result } = renderHook(() => useSessionTimelineData('fake:root'));
    expect(result.current.summary).not.toBeUndefined();
    expect(result.current.rootAnchor).toBeUndefined();
    expect(result.current.agentSpans).toEqual([]);
    expect(result.current.tokenSeries).toEqual([]);
    expect(result.current.harnessEvents).toEqual([]);
    expect(result.current.componentEvents).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });
});

describe('real fixture: merges root + subagent traces via lib/timeline builders', () => {
  const ROOT = makeSummary({ id: 'fake:root', timing: { startedAt: metric(ROOT_START) } });
  const CHILD = makeSummary({
    id: 'fake:child',
    parentId: 'fake:root',
    depth: 1,
    relation: 'subagent',
    agentType: 'Explore',
    timing: { startedAt: metric(iso(500)) },
  });

  function setup() {
    shared.sessionResult = {
      isPending: false,
      error: null,
      data: {
        summary: ROOT,
        rollup: makeRollup({ id: 'fake:root' }),
        subtree: {
          summaries: [ROOT, CHILD],
          rollups: {
            'fake:root': makeRollup({ id: 'fake:root' }),
            'fake:child': makeRollup({ id: 'fake:child' }),
          },
        },
        diagnostics: [],
      },
    };
    const rootTrace = trace(
      [
        {
          kind: 'call',
          i: 0,
          model: 'sonnet-4',
          at: iso(0),
          usage: { uncachedInput: 100 },
          cum: { uncachedInput: 100, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
          blocks: { text: 1, thinking: 0, toolUse: 0 },
        },
        { kind: 'tool', i: 1, category: 'read', name: 'src/index.ts', at: iso(1000) },
      ],
      ROOT_START,
    );
    const childTrace = trace(
      [
        {
          kind: 'tool',
          i: 0,
          category: 'mcp',
          name: 'mcp__github__search',
          at: iso(1500),
          durationMs: 200,
        },
      ],
      iso(500),
    );
    shared.traceResult = { isPending: false, error: null, data: rootTrace };
    shared.tracesById = {
      'fake:root': { isPending: false, error: null, data: rootTrace },
      'fake:child': { isPending: false, error: null, data: childTrace },
    };
  }

  test('rootAnchor resolves from the root trace axis, and every derived array reflects both sessions merged', () => {
    setup();
    const { result } = renderHook(() => useSessionTimelineData('fake:root'));
    expect(result.current.rootAnchor).toBe(ROOT_START);
    expect(result.current.agentSpans).toHaveLength(2);
    expect(result.current.tokenSeries).toHaveLength(1);
    expect(result.current.tokenSeries[0]?.cumulative).toBe(100);
    expect(result.current.harnessEvents).toHaveLength(1);
    expect(result.current.harnessEvents[0]?.at).toBe(1000);
    // Component event comes from the CHILD's own trace, not the root's.
    expect(result.current.componentEvents).toHaveLength(1);
    expect(result.current.componentEvents[0]?.agentId).toBe('fake:child');
    expect(result.current.componentEvents[0]?.at).toBe(1500);
  });

  test('useTraces is called with every subtree member id (root included)', () => {
    setup();
    renderHook(() => useSessionTimelineData('fake:root'));
    const lastCall = shared.tracesCalledWithIds.at(-1);
    expect(lastCall).toEqual(['fake:root', 'fake:child']);
  });
});
