import { describe, expect, test } from 'bun:test';
import type { HarnessAggregate, ProjectAggregate } from './aggregate';
import type { Diagnostic } from './diagnostic';
import type { Metric } from './metric';
import { minConfidence } from './metric';
import type { SessionRollup } from './rollup';
import {
  assertKnownHarnessIdsValidate,
  DiagnosticSchema,
  HarnessAggregateSchema,
  ProjectAggregateSchema,
  SessionRollupSchema,
  SessionSummarySchema,
  SessionTraceSchema,
} from './schema';
import type { ProjectRef, SessionSummary } from './session';
import type { SessionTrace } from './trace';

function metric<T>(value: T, source = 'test'): Metric<T> {
  return { value, confidence: 'high', source };
}

const project: ProjectRef = { key: 'github.com/x/y', name: 'y', identity: 'remote' };

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'claude-code:abc',
    harness: 'claude-code',
    depth: 0,
    project,
    cwd: { first: '/home/u/y', all: ['/home/u/y'] },
    timing: { startedAt: metric('2026-01-01T00:00:00Z'), endedAt: metric('2026-01-01T00:10:00Z') },
    model: { primary: metric('claude-opus-5'), all: ['claude-opus-5'], changes: 0 },
    flags: {},
    usage: { output: metric(100) },
    counts: {},
    children: [],
    source: { path: '/home/u/.claude/x.jsonl', sizeBytes: 10, mtimeMs: 0 },
    diagnostics: [],
    ...overrides,
  };
}

describe('model schemas', () => {
  test('known harness ids validate against the permissive schema', () => {
    assertKnownHarnessIdsValidate();
  });

  test('SessionSummary round-trips through its schema', () => {
    const summary = makeSummary();
    expect(SessionSummarySchema.parse(summary)).toEqual(summary);
  });

  test('SessionSummary schema rejects a negative depth', () => {
    expect(() => SessionSummarySchema.parse(makeSummary({ depth: -1 }))).toThrow();
  });

  test('SessionRollup round-trips', () => {
    const rollup: SessionRollup = {
      id: 'claude-code:abc',
      exclusive: { usage: { output: metric(100) }, counts: {} },
      inclusive: { usage: { output: metric(100) }, counts: { subagents: metric(0) } },
      descendants: 0,
    };
    expect(SessionRollupSchema.parse(rollup)).toEqual(rollup);
  });

  test('ProjectAggregate and HarnessAggregate round-trip', () => {
    const p: ProjectAggregate = {
      project,
      sessionCount: 1,
      harnesses: ['claude-code'],
      aggregateUsage: { output: metric(100) },
    };
    const h: HarnessAggregate = {
      harness: 'claude-code',
      sessionCount: 1,
      projects: [project.key],
      aggregateUsage: { output: metric(100) },
    };
    expect(ProjectAggregateSchema.parse(p)).toEqual(p);
    expect(HarnessAggregateSchema.parse(h)).toEqual(h);
  });

  test('Diagnostic message length is enforced by the schema too', () => {
    const d: Diagnostic = {
      level: 'warn',
      code: 'x',
      message: 'a'.repeat(201),
      harness: 'claude-code',
      path: '/x',
    };
    expect(() => DiagnosticSchema.parse(d)).toThrow();
  });

  test('SessionTrace round-trips with a discriminated step union', () => {
    const trace: SessionTrace = {
      id: 'claude-code:abc',
      steps: [
        {
          kind: 'call',
          i: 0,
          model: 'claude-opus-5',
          cum: { uncachedInput: 1, cachedInput: 0, cacheWrite: 0, output: 10, reasoningOutput: 0 },
          blocks: { text: 1, thinking: 0, toolUse: 0 },
        },
        { kind: 'tool', i: 1, category: 'read', name: 'Read', error: false },
      ],
      models: ['claude-opus-5'],
      axis: { steps: 2 },
      totals: { uncachedInput: 1, cachedInput: 0, cacheWrite: 0, output: 10, reasoningOutput: 0 },
    };
    expect(SessionTraceSchema.parse(trace)).toEqual(trace);
  });

  test('minConfidence returns the weakest confidence', () => {
    expect(minConfidence(['high', 'medium', 'low'])).toBe('low');
    expect(minConfidence(['high', 'high'])).toBe('high');
    expect(minConfidence([])).toBe('high');
  });
});
