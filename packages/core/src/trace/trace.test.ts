import { describe, expect, test } from 'bun:test';
import type { ScoutEvent } from '../events/event';
import { reduce } from '../reduce/reduce';
import { buildTrace } from './trace';

async function* stream(events: ScoutEvent[]): AsyncIterable<ScoutEvent> {
  for (const e of events) yield e;
}

describe('buildTrace', () => {
  test('emits a call step per usage event with a running cumulative total', async () => {
    const t = await buildTrace(
      'x',
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'usage', dedupeKey: 'r1', model: 'opus', output: 10, uncachedInput: 2 },
        { kind: 'usage', dedupeKey: 'r2', model: 'opus', output: 5 },
      ]),
    );
    expect(t.steps.filter((s) => s.kind === 'call')).toHaveLength(2);
    const [first, second] = t.steps.filter(
      (s): s is Extract<(typeof t.steps)[number], { kind: 'call' }> => s.kind === 'call',
    );
    expect(first?.cum.output).toBe(10);
    expect(second?.cum.output).toBe(15);
    expect(t.totals.output).toBe(15);
  });

  test('deduping by dedupeKey does not double-count into cum, but blocks from duplicates are summed', async () => {
    const t = await buildTrace(
      'x',
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'usage', dedupeKey: 'req1', output: 100, blocks: { text: 1 } },
        { kind: 'usage', dedupeKey: 'req1', output: 100, blocks: { toolUse: 1 } },
      ]),
    );
    const calls = t.steps.filter(
      (s): s is Extract<(typeof t.steps)[number], { kind: 'call' }> => s.kind === 'call',
    );
    expect(calls).toHaveLength(1);
    expect(t.totals.output).toBe(100);
    expect(calls[0]?.blocks).toEqual({ text: 1, thinking: 0, toolUse: 1 });
  });

  test('pairs a toolResult to its toolCall by callId and sets error/duration', async () => {
    const t = await buildTrace(
      'x',
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'toolCall', name: 'Bash', category: 'exec', callId: 'c1' },
        { kind: 'toolResult', callId: 'c1', error: true, durationMs: 250 },
      ]),
    );
    const tool = t.steps.find((s) => s.kind === 'tool');
    expect(tool && 'error' in tool ? tool.error : undefined).toBe(true);
    expect(tool && 'durationMs' in tool ? tool.durationMs : undefined).toBe(250);
  });

  test('pairs by emission order when callId is absent', async () => {
    const t = await buildTrace(
      'x',
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'toolCall', name: 'Read', category: 'read' },
        { kind: 'toolResult', error: false },
      ]),
    );
    const tool = t.steps.find((s) => s.kind === 'tool');
    expect(tool && 'error' in tool ? tool.error : undefined).toBe(false);
  });

  test('model-change steps only appear on an actual transition, not the first model', async () => {
    const t = await buildTrace(
      'x',
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'model', model: 'haiku' },
        { kind: 'model', model: 'opus' },
      ]),
    );
    const changes = t.steps.filter((s) => s.kind === 'model-change');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: 'haiku', to: 'opus' });
  });

  test('turn, compaction and harnessEvent steps are recorded with their fields', async () => {
    const t = await buildTrace(
      'x',
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'turn', durationMs: 1000 },
        { kind: 'compaction', preTokens: 500, postTokens: 20 },
        { kind: 'harnessEvent', name: 'hook:PreToolUse' },
      ]),
    );
    expect(t.steps.map((s) => s.kind)).toEqual(['turn', 'compaction', 'harness']);
  });

  test('axis.steps matches the number of emitted steps', async () => {
    const t = await buildTrace(
      'x',
      stream([{ kind: 'meta', sourceId: 's1', role: 'root' }, { kind: 'turn' }, { kind: 'turn' }]),
    );
    expect(t.axis.steps).toBe(2);
  });
});

describe('buildTrace - totals must equal the reducer exclusive usage', () => {
  test('on a realistic mixed stream with dedupe and multiple models', async () => {
    const events: ScoutEvent[] = [
      {
        kind: 'meta',
        sourceId: 's1',
        role: 'root',
        cwd: '/home/u/proj',
        at: '2026-01-01T00:00:00Z',
      },
      { kind: 'model', model: 'haiku' },
      { kind: 'usage', dedupeKey: 'r1', model: 'haiku', output: 10, uncachedInput: 3 },
      { kind: 'usage', dedupeKey: 'r1', model: 'haiku', output: 10, uncachedInput: 3 }, // duplicate fragment
      { kind: 'model', model: 'opus' },
      { kind: 'usage', dedupeKey: 'r2', model: 'opus', output: 200, cachedInput: 50 },
      { kind: 'toolCall', name: 'Read', category: 'read', callId: 'c1' },
      { kind: 'toolResult', callId: 'c1', error: false },
      { kind: 'observed', at: '2026-01-01T00:05:00Z' },
    ];

    const reduced = await reduce(
      (async function* () {
        for (const e of events) yield e;
      })(),
      { harness: 'claude-code', path: '/x', privacyTitles: true },
    );
    const trace = await buildTrace(
      'x',
      (async function* () {
        for (const e of events) yield e;
      })(),
    );

    expect(reduced.usage.output).toBeDefined();
    expect(reduced.usage.uncachedInput).toBeDefined();
    expect(reduced.usage.cachedInput).toBeDefined();
    expect(trace.totals.output).toBe(reduced.usage.output?.value ?? Number.NaN);
    expect(trace.totals.uncachedInput).toBe(reduced.usage.uncachedInput?.value ?? Number.NaN);
    expect(trace.totals.cachedInput).toBe(reduced.usage.cachedInput?.value ?? Number.NaN);
  });
});
