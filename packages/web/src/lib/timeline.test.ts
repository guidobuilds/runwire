import { describe, expect, test } from 'vitest';
import type { Metric, SessionSummary, SessionTrace, TraceStep } from '../api/types';
import {
  buildAgentSpans,
  buildComponentEvents,
  buildHarnessEvents,
  buildTokenSeries,
  type ClusterableEvent,
  clusterByProximity,
  elapsedMs,
  resolveRootAnchor,
} from './timeline';

const ROOT_ANCHOR = '2026-01-01T00:00:00.000Z';

function metric<T>(value: T, confidence: Metric<T>['confidence'] = 'high'): Metric<T> {
  return { value, confidence, source: 'fake' };
}

/** ISO timestamp `ms` milliseconds after `ROOT_ANCHOR`. */
function iso(ms: number): string {
  return new Date(Date.parse(ROOT_ANCHOR) + ms).toISOString();
}

function summary(
  id: string,
  extra: Partial<{
    parentId: string;
    depth: number;
    agentType: string;
    relation: SessionSummary['relation'];
    startedAt: Metric<string>;
    endedAt: Metric<string>;
    durationMs: Metric<number>;
    model: string;
    usage: SessionSummary['usage'];
  }> = {},
): SessionSummary {
  return {
    id,
    harness: 'fake',
    depth: extra.depth ?? (extra.parentId === undefined ? 0 : 1),
    parentId: extra.parentId,
    relation: extra.relation,
    agentType: extra.agentType,
    project: { key: 'p', name: 'p', identity: 'cwd' },
    cwd: { first: '/w', all: ['/w'] },
    timing: {
      startedAt: extra.startedAt,
      endedAt: extra.endedAt,
      durationMs: extra.durationMs,
    },
    model: { primary: extra.model ? metric(extra.model) : undefined, all: [], changes: 0 },
    flags: {},
    usage: extra.usage ?? {},
    counts: {},
    children: [],
    source: { path: '/w/a.jsonl', sizeBytes: 1, mtimeMs: 0 },
    diagnostics: [],
  };
}

function trace(steps: TraceStep[], overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    id: 'fake-session',
    steps,
    models: ['claude-x'],
    axis: { steps: steps.length },
    totals: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
    ...overrides,
  };
}

const call = (
  i: number,
  extra: Partial<{
    at: string;
    model: string;
    usage: Partial<TraceStep & { kind: 'call' }>['usage'];
  }> = {},
): TraceStep =>
  ({
    kind: 'call',
    i,
    at: extra.at,
    model: extra.model ?? 'claude-x',
    usage: extra.usage,
    cum: { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 },
    blocks: { text: 1, thinking: 0, toolUse: 0 },
  }) as TraceStep;

const tool = (i: number, category: string, extra: Record<string, unknown> = {}): TraceStep =>
  ({ kind: 'tool', i, name: `tool-${i}`, category, ...extra }) as TraceStep;

const harnessStep = (i: number, name: string, at?: string): TraceStep =>
  ({ kind: 'harness', i, at, name }) as TraceStep;

describe('elapsedMs / resolveRootAnchor', () => {
  describe('elapsedMs', () => {
    test('returns the millisecond difference between at and rootAnchor', () => {
      expect(elapsedMs(ROOT_ANCHOR, iso(1500))).toBe(1500);
    });

    test('returns undefined when rootAnchor is absent', () => {
      expect(elapsedMs(undefined, iso(100))).toBeUndefined();
    });

    test('returns undefined when at is absent', () => {
      expect(elapsedMs(ROOT_ANCHOR, undefined)).toBeUndefined();
    });

    test('returns undefined when at fails to parse', () => {
      expect(elapsedMs(ROOT_ANCHOR, 'not-a-date')).toBeUndefined();
    });

    test('returns undefined when rootAnchor fails to parse', () => {
      expect(elapsedMs('not-a-date', iso(0))).toBeUndefined();
    });

    test('can be negative when at precedes rootAnchor', () => {
      expect(elapsedMs(ROOT_ANCHOR, iso(-500))).toBe(-500);
    });
  });

  describe('resolveRootAnchor', () => {
    test('prefers rootTrace.axis.startedAt', () => {
      const root = summary('r', { startedAt: metric('2026-01-01T00:00:05.000Z') });
      const rootTrace = trace([], { axis: { steps: 0, startedAt: '2026-01-01T00:00:01.000Z' } });
      expect(resolveRootAnchor(root, rootTrace)).toBe('2026-01-01T00:00:01.000Z');
    });

    test('falls back to rootSummary.timing.startedAt.value when the trace has no axis start', () => {
      const root = summary('r', { startedAt: metric('2026-01-01T00:00:05.000Z') });
      const rootTrace = trace([], { axis: { steps: 0 } });
      expect(resolveRootAnchor(root, rootTrace)).toBe('2026-01-01T00:00:05.000Z');
    });

    test('falls back to rootSummary.timing.startedAt.value when rootTrace is undefined', () => {
      const root = summary('r', { startedAt: metric('2026-01-01T00:00:05.000Z') });
      expect(resolveRootAnchor(root, undefined)).toBe('2026-01-01T00:00:05.000Z');
    });

    test('returns undefined when neither the trace axis nor the summary timing has a start', () => {
      const root = summary('r');
      expect(resolveRootAnchor(root, trace([]))).toBeUndefined();
    });
  });
});

describe('buildAgentSpans', () => {
  test('one span per subtree summary at any depth, start/end in elapsed ms', () => {
    const subtree = [
      summary('root', { startedAt: metric(iso(0)), endedAt: metric(iso(1000)) }),
      summary('child', {
        parentId: 'root',
        depth: 1,
        agentType: 'Explore',
        startedAt: metric(iso(100)),
        endedAt: metric(iso(400)),
      }),
      summary('grandchild', {
        parentId: 'child',
        depth: 2,
        agentType: 'forge-worker-leaf',
        startedAt: metric(iso(150)),
        endedAt: metric(iso(300)),
      }),
    ];
    const spans = buildAgentSpans(ROOT_ANCHOR, subtree);
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => s.id === 'root');
    expect(root).toMatchObject({
      id: 'root',
      agentId: 'root',
      name: 'root',
      parentAgentId: null,
      depth: 0,
      start: 0,
      end: 1000,
      confidenceLevel: 'high',
    });

    const grandchild = spans.find((s) => s.id === 'grandchild');
    expect(grandchild).toMatchObject({
      name: 'forge-worker-leaf',
      parentAgentId: 'child',
      depth: 2,
      start: 150,
      end: 300,
    });
  });

  test('name falls back to relation, then to "root" when both agentType and relation are absent', () => {
    const spans = buildAgentSpans(ROOT_ANCHOR, [
      summary('r'),
      summary('s', { relation: 'subagent', parentId: 'r' }),
      summary('t', { parentId: 'r' }),
    ]);
    expect(spans.find((s) => s.id === 's')?.name).toBe('subagent');
    expect(spans.find((s) => s.id === 't')?.name).toBe('root');
  });

  test('start/end are undefined when the corresponding timing metric is absent, not invented as zero', () => {
    const spans = buildAgentSpans(ROOT_ANCHOR, [summary('r')]);
    expect(spans[0]?.start).toBeUndefined();
    expect(spans[0]?.end).toBeUndefined();
  });

  test('confidenceLevel is the weakest of startedAt/endedAt/durationMs confidence when present', () => {
    const highOnly = buildAgentSpans(ROOT_ANCHOR, [
      summary('r', { startedAt: metric(iso(0), 'high'), endedAt: metric(iso(10), 'high') }),
    ])[0];
    expect(highOnly?.confidenceLevel).toBe('high');

    const oneWeak = buildAgentSpans(ROOT_ANCHOR, [
      summary('r', { startedAt: metric(iso(0), 'high'), endedAt: metric(iso(10), 'medium') }),
    ])[0];
    expect(oneWeak?.confidenceLevel).toBe('medium');

    const singleTimestampDuration = buildAgentSpans(ROOT_ANCHOR, [
      summary('r', {
        startedAt: metric(iso(0), 'high'),
        durationMs: metric(10, 'low'),
      }),
    ])[0];
    expect(singleTimestampDuration?.confidenceLevel).toBe('low');
  });

  test('confidenceLevel is low (not high) when no timing metric is present at all', () => {
    const spans = buildAgentSpans(ROOT_ANCHOR, [summary('r')]);
    expect(spans[0]?.confidenceLevel).toBe('low');
  });

  test('inputTokens/outputTokens sum present Usage metrics and are undefined when none are present', () => {
    const withUsage = buildAgentSpans(ROOT_ANCHOR, [
      summary('r', {
        usage: {
          uncachedInput: metric(100),
          cachedInput: metric(20),
          output: metric(30),
          reasoningOutput: metric(5),
        },
      }),
    ])[0];
    expect(withUsage?.inputTokens).toBe(120);
    expect(withUsage?.outputTokens).toBe(35);

    const withoutUsage = buildAgentSpans(ROOT_ANCHOR, [summary('r')])[0];
    expect(withoutUsage?.inputTokens).toBeUndefined();
    expect(withoutUsage?.outputTokens).toBeUndefined();
  });

  test('model is summary.model.primary.value, undefined when absent', () => {
    const [withModel] = buildAgentSpans(ROOT_ANCHOR, [summary('r', { model: 'claude-x' })]);
    expect(withModel?.model).toBe('claude-x');
    const [withoutModel] = buildAgentSpans(ROOT_ANCHOR, [summary('r')]);
    expect(withoutModel?.model).toBeUndefined();
  });
});

describe('buildTokenSeries', () => {
  test('exact hand-computed cumulative across an interleaved two-session merge: A[+10], B[+5], A[+20] -> 10, 15, 35', () => {
    const traceA = trace([
      call(0, { at: iso(10), usage: { uncachedInput: 10 } }),
      call(1, { at: iso(30), usage: { uncachedInput: 20 } }),
    ]);
    const traceB = trace([call(0, { at: iso(20), usage: { uncachedInput: 5 } })]);
    const tracesById = new Map([
      ['A', traceA],
      ['B', traceB],
    ]);

    const points = buildTokenSeries(ROOT_ANCHOR, tracesById);

    expect(points.map((p) => p.at)).toEqual([10, 20, 30]);
    expect(points.map((p) => p.agentId)).toEqual(['A', 'B', 'A']);
    expect(points.map((p) => p.delta)).toEqual([10, 5, 20]);
    expect(points.map((p) => p.cumulative)).toEqual([10, 15, 35]);
    expect(points.map((p) => p.id)).toEqual(['call:A#0', 'call:B#0', 'call:A#1']);
  });

  test('negative control: per-trace concatenation (session A fully, then session B) is also monotonic but produces a DIFFERENT, wrong result -- proving the assertion above can fail', () => {
    const traceA = trace([
      call(0, { at: iso(10), usage: { uncachedInput: 10 } }),
      call(1, { at: iso(30), usage: { uncachedInput: 20 } }),
    ]);
    const traceB = trace([call(0, { at: iso(20), usage: { uncachedInput: 5 } })]);
    const tracesById = new Map([
      ['A', traceA],
      ['B', traceB],
    ]);

    const correct = buildTokenSeries(ROOT_ANCHOR, tracesById).map((p) => p.cumulative);
    expect(correct).toEqual([10, 15, 35]);

    // What sorting by (sessionId, step.i) instead of merged elapsedMs would
    // produce: A's two calls concatenated first (10, 30), then B's (35).
    // Still non-negative deltas -> still monotonic -- but not equal to the
    // correct, time-sorted merge. This is the same three total events with
    // the same three deltas, so anything that treats "monotonic" as
    // sufficient would wrongly accept it.
    const naiveConcatenationByTrace = [10, 30, 35];
    expect(correct).not.toEqual(naiveConcatenationByTrace);
    // Both are non-decreasing, so monotonicity alone cannot distinguish them.
    const isMonotonic = (xs: number[]) => xs.every((x, i) => i === 0 || x >= (xs[i - 1] ?? 0));
    expect(isMonotonic(correct)).toBe(true);
    expect(isMonotonic(naiveConcatenationByTrace)).toBe(true);
  });

  test('cumulative never reuses TraceStep.cum -- a large per-step cum is ignored in favor of the recomputed running delta sum', () => {
    const step = call(0, { at: iso(0), usage: { uncachedInput: 7 } });
    if (step.kind === 'call') {
      // A deliberately huge, wrong "running total" on the raw step -- if the
      // builder ever read `cum` instead of re-summing `usage`, this would leak
      // through as the point's cumulative value.
      step.cum = {
        uncachedInput: 999_999,
        cachedInput: 0,
        cacheWrite: 0,
        output: 0,
        reasoningOutput: 0,
      };
    }
    const points = buildTokenSeries(ROOT_ANCHOR, new Map([['A', trace([step])]]));
    expect(points[0]?.cumulative).toBe(7);
  });

  test('input is uncachedInput+cachedInput+cacheWrite, output is output+reasoningOutput', () => {
    const step = call(0, {
      at: iso(0),
      usage: { uncachedInput: 1, cachedInput: 2, cacheWrite: 3, output: 4, reasoningOutput: 5 },
    });
    const [point] = buildTokenSeries(ROOT_ANCHOR, new Map([['A', trace([step])]]));
    expect(point?.input).toBe(6);
    expect(point?.output).toBe(9);
    expect(point?.delta).toBe(15);
  });

  test('call steps without at are excluded entirely, not counted as a zero-elapsed point', () => {
    const points = buildTokenSeries(
      ROOT_ANCHOR,
      new Map([['A', trace([call(0, { usage: { uncachedInput: 5 } })])]]),
    );
    expect(points).toEqual([]);
  });

  test('non-call steps are ignored', () => {
    const points = buildTokenSeries(
      ROOT_ANCHOR,
      new Map([
        ['A', trace([tool(0, 'read', { at: iso(0) }), harnessStep(1, 'hook:Stop', iso(5))])],
      ]),
    );
    expect(points).toEqual([]);
  });

  test('empty tracesById produces an empty series', () => {
    expect(buildTokenSeries(ROOT_ANCHOR, new Map())).toEqual([]);
  });
});

describe('buildHarnessEvents', () => {
  test('includes exactly read/write/exec tool-category steps, excluding search/plan/agent/web/mcp/skill/other', () => {
    const steps = [
      tool(0, 'read', { at: iso(0) }),
      tool(1, 'write', { at: iso(10) }),
      tool(2, 'exec', { at: iso(20) }),
      tool(3, 'search', { at: iso(30) }),
      tool(4, 'plan', { at: iso(40) }),
      tool(5, 'agent', { at: iso(50) }),
      tool(6, 'web', { at: iso(60) }),
      tool(7, 'mcp', { at: iso(70) }),
      tool(8, 'skill', { at: iso(80) }),
      tool(9, 'other', { at: iso(90) }),
    ];
    const { events, skippedNoTimestamp } = buildHarnessEvents(
      ROOT_ANCHOR,
      new Map([['A', trace(steps)]]),
    );
    expect(events.map((e) => e.kind)).toEqual(['read', 'write', 'exec']);
    expect(skippedNoTimestamp).toBe(0);
  });

  test('durationMs and error carry through; a step with no durationMs is undefined, not 0', () => {
    const steps = [
      tool(0, 'read', { at: iso(0), durationMs: 250 }),
      tool(1, 'write', { at: iso(10), error: true }),
    ];
    const { events } = buildHarnessEvents(ROOT_ANCHOR, new Map([['A', trace(steps)]]));
    expect(events[0]?.durationMs).toBe(250);
    expect(events[1]?.durationMs).toBeUndefined();
    expect(events[1]?.error).toBe(true);
    expect(events[0]?.error).toBeUndefined();
  });

  test('steps lacking at are counted in skippedNoTimestamp, not silently dropped without a trace', () => {
    const steps = [tool(0, 'read', { at: iso(0) }), tool(1, 'read'), tool(2, 'exec')];
    const { events, skippedNoTimestamp } = buildHarnessEvents(
      ROOT_ANCHOR,
      new Map([['A', trace(steps)]]),
    );
    expect(events).toHaveLength(1);
    expect(skippedNoTimestamp).toBe(2);
  });

  test('merges across multiple traces and sorts by elapsed time', () => {
    const traceA = trace([tool(0, 'read', { at: iso(20) })]);
    const traceB = trace([tool(0, 'write', { at: iso(5) })]);
    const { events } = buildHarnessEvents(
      ROOT_ANCHOR,
      new Map([
        ['A', traceA],
        ['B', traceB],
      ]),
    );
    expect(events.map((e) => e.agentId)).toEqual(['B', 'A']);
    expect(events.map((e) => e.at)).toEqual([5, 20]);
  });

  test('id is "sessionId#step.i", agentId is the sessionId, name is the tool name', () => {
    const { events } = buildHarnessEvents(
      ROOT_ANCHOR,
      new Map([['sess-1', trace([tool(7, 'exec', { at: iso(0), name: 'Bash' })])]]),
    );
    expect(events[0]).toMatchObject({ id: 'sess-1#7', agentId: 'sess-1', name: 'Bash' });
  });
});

describe('buildComponentEvents', () => {
  test('includes skill/mcp/agent tool-category steps and every harness-kind step as hook', () => {
    const steps = [
      tool(0, 'skill', { at: iso(0), name: 'Skill' }),
      tool(1, 'mcp', { at: iso(10), name: 'mcp__filesystem__read_file' }),
      tool(2, 'agent', { at: iso(20), name: 'Task', childId: 'child-1' }),
      harnessStep(3, 'hook:PreToolUse', iso(30)),
      tool(4, 'read', { at: iso(40) }),
    ];
    const { events, skippedNoTimestamp } = buildComponentEvents(
      ROOT_ANCHOR,
      new Map([['A', trace(steps)]]),
    );
    expect(events.map((e) => e.kind)).toEqual(['skill', 'mcp', 'agent', 'hook']);
    expect(skippedNoTimestamp).toBe(0);
  });

  test('mcp detail splits mcp__server__tool into server/tool', () => {
    const { events } = buildComponentEvents(
      ROOT_ANCHOR,
      new Map([['A', trace([tool(0, 'mcp', { at: iso(0), name: 'mcp__filesystem__read_file' })])]]),
    );
    expect(events[0]?.detail).toBe('filesystem/read_file');
  });

  test('mcp detail is undefined for a malformed mcp name with no tool part', () => {
    const { events } = buildComponentEvents(
      ROOT_ANCHOR,
      new Map([['A', trace([tool(0, 'mcp', { at: iso(0), name: 'mcp__onlyserver' })])]]),
    );
    expect(events[0]?.detail).toBeUndefined();
  });

  test('detail is undefined for skill/agent/hook kinds', () => {
    const { events } = buildComponentEvents(
      ROOT_ANCHOR,
      new Map([
        [
          'A',
          trace([
            tool(0, 'skill', { at: iso(0) }),
            tool(1, 'agent', { at: iso(10), childId: 'child-1' }),
            harnessStep(2, 'hook:Stop', iso(20)),
          ]),
        ],
      ]),
    );
    expect(events.map((e) => e.detail)).toEqual([undefined, undefined, undefined]);
  });

  test('agent-category steps carry childId through; other kinds have childId undefined', () => {
    const { events } = buildComponentEvents(
      ROOT_ANCHOR,
      new Map([
        [
          'A',
          trace([
            tool(0, 'agent', { at: iso(0), childId: 'child-1' }),
            tool(1, 'skill', { at: iso(10) }),
          ]),
        ],
      ]),
    );
    expect(events[0]?.childId).toBe('child-1');
    expect(events[1]?.childId).toBeUndefined();
  });

  test('harness-kind steps carry no durationMs (TraceStepHarness has none) and use their own name as-is', () => {
    const { events } = buildComponentEvents(
      ROOT_ANCHOR,
      new Map([['A', trace([harnessStep(0, 'hook:PreToolUse', iso(0))])]]),
    );
    expect(events[0]).toMatchObject({
      kind: 'hook',
      name: 'hook:PreToolUse',
      durationMs: undefined,
    });
  });

  test('steps lacking at are counted in skippedNoTimestamp for both tool- and harness-kind steps', () => {
    const steps = [tool(0, 'skill', { at: iso(0) }), tool(1, 'skill'), harnessStep(2, 'hook:Stop')];
    const { events, skippedNoTimestamp } = buildComponentEvents(
      ROOT_ANCHOR,
      new Map([['A', trace(steps)]]),
    );
    expect(events).toHaveLength(1);
    expect(skippedNoTimestamp).toBe(2);
  });

  test('excludes read/write/exec/search/plan/web/other tool-category steps', () => {
    const steps = ['read', 'write', 'exec', 'search', 'plan', 'web', 'other'].map((category, i) =>
      tool(i, category, { at: iso(i * 10) }),
    );
    const { events } = buildComponentEvents(ROOT_ANCHOR, new Map([['A', trace(steps)]]));
    expect(events).toEqual([]);
  });
});

describe('clusterByProximity', () => {
  type FakeEvent = ClusterableEvent;

  function ev(id: string, at: number, kind = 'read'): FakeEvent {
    return { id, at, kind };
  }

  /** Simple identity-ish scale: 1 elapsed-ms unit == 1 rendered px, so distances in `at` are directly the pixel distances the threshold compares against. */
  const identityScale = (value: number) => value;

  test('a single event yields a single-member cluster (unclustered) whose representative is itself', () => {
    const clusters = clusterByProximity([ev('a', 100)], identityScale, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toEqual([ev('a', 100)]);
    expect(clusters[0]?.representative).toEqual(ev('a', 100));
  });

  test('two same-kind events within the threshold merge into one cluster, representative is the earliest', () => {
    const clusters = clusterByProximity([ev('a', 100), ev('b', 105)], identityScale, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members.map((m) => m.id)).toEqual(['a', 'b']);
    expect(clusters[0]?.representative.id).toBe('a');
  });

  test('two same-kind events beyond the threshold stay as two separate single-member clusters', () => {
    const clusters = clusterByProximity([ev('a', 100), ev('b', 200)], identityScale, 10);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.members.length)).toEqual([1, 1]);
  });

  test('events of a different kind never join a cluster, even at the identical position', () => {
    const clusters = clusterByProximity(
      [ev('a', 100, 'read'), ev('b', 100, 'write')],
      identityScale,
      10,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
  });

  test('chain-linkage: A-B and B-C each within threshold clusters all three, even though A-C alone exceeds it', () => {
    // a=100, b=108, c=116: a-b=8 (<=10), b-c=8 (<=10), a-c=16 (>10).
    const clusters = clusterByProximity(
      [ev('a', 100), ev('b', 108), ev('c', 116)],
      identityScale,
      10,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  test('a gap breaks the chain into two separate clusters', () => {
    // a=100, b=108 (a-b=8, clustered); c=200 (b-c=92, not clustered).
    const clusters = clusterByProximity(
      [ev('a', 100), ev('b', 108), ev('c', 200)],
      identityScale,
      10,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.members.map((m) => m.id)).toEqual(['a', 'b']);
    expect(clusters[1]?.members.map((m) => m.id)).toEqual(['c']);
  });

  test('output order is stable left-to-right by representative position across mixed kinds', () => {
    const clusters = clusterByProximity(
      [ev('late', 500, 'write'), ev('early', 100, 'read')],
      identityScale,
      10,
    );
    expect(clusters.map((c) => c.representative.id)).toEqual(['early', 'late']);
  });

  test('recomputes fresh against whatever xScale is passed -- the same events cluster under a compressed scale and separate under an expanded one, proving no domain caching', () => {
    const events = [ev('a', 100), ev('b', 110)];
    // Compressed: 0.05 px/ms -> 5, 5.5 -> 0.5px apart -> clusters under threshold 10.
    const compressed = clusterByProximity(events, (v) => v * 0.05, 10);
    expect(compressed).toHaveLength(1);
    // Expanded (post-zoom-style): 5 px/ms -> 500, 550 -> 50px apart -- exceeds threshold 10.
    const expanded = clusterByProximity(events, (v) => v * 5, 10);
    expect(expanded).toHaveLength(2);
  });
});
