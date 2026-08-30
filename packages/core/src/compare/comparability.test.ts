import { describe, expect, test } from 'bun:test';
import type { Capability, HarnessAdapter } from '../adapter/types';
import type { Metric } from '../model/metric';
import type { ProjectRef, SessionSummary } from '../model/session';
import { comparability } from './comparability';

function metric<T>(value: T, confidence: Metric['confidence'] = 'high', note?: string): Metric<T> {
  return { value, confidence, source: 'test', note };
}

const project: ProjectRef = { key: 'k', name: 'k', identity: 'cwd' };

function summary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: 'x',
    harness: 'claude-code',
    depth: 0,
    project,
    cwd: { first: '/x', all: ['/x'] },
    timing: {},
    model: { all: [], changes: 0 },
    flags: {},
    usage: {},
    counts: {},
    children: [],
    source: { path: '/x', sizeBytes: 0, mtimeMs: 0 },
    diagnostics: [],
    ...overrides,
  };
}

function adapter(
  id: string,
  capabilities: Capability[],
  explainMap: Partial<Record<string, string>> = {},
): HarnessAdapter {
  return {
    id: id as HarnessAdapter['id'],
    displayName: id,
    adapterVersion: '1',
    capabilities,
    allowlist: {},
    async probe() {
      return { installed: true, roots: [], notes: [] };
    },
    async *discover() {},
    async *parse() {},
    explain: (field) => explainMap[field as string],
    toolCategory: () => 'other',
    harnessEventNames: [],
  };
}

describe('comparability', () => {
  test('not-provided when the adapter lacks the required capability', () => {
    const a = adapter('claude-code', []); // no usage capability at all
    const s = summary({ harness: 'claude-code', usage: { output: metric(10) } });
    const m = comparability([s], new Map([['claude-code', a]]));
    const row = m.rows.find((r) => r.field === 'output');
    expect(row?.cells[0]?.flag).toBe('not-provided');
  });

  test('missing when the capability is present but the session has no value', () => {
    const a = adapter('claude-code', ['usage.perCall']);
    const s = summary({ harness: 'claude-code', usage: {} });
    const m = comparability([s], new Map([['claude-code', a]]));
    const row = m.rows.find((r) => r.field === 'output');
    expect(row?.cells[0]?.flag).toBe('missing');
  });

  test('ok when the value is present at high confidence and there is nothing to disagree with', () => {
    const a = adapter('claude-code', ['usage.perCall']);
    const s = summary({ harness: 'claude-code', usage: { output: metric(10, 'high') } });
    const m = comparability([s], new Map([['claude-code', a]]));
    const row = m.rows.find((r) => r.field === 'output');
    expect(row?.cells[0]?.flag).toBe('ok');
  });

  test('derived when the value is present but not high confidence', () => {
    const a = adapter('claude-code', ['usage.perCall']);
    const s = summary({
      harness: 'claude-code',
      usage: { output: metric(10, 'medium', 'cumulative total reported by harness') },
    });
    const m = comparability([s], new Map([['claude-code', a]]));
    const row = m.rows.find((r) => r.field === 'output');
    expect(row?.cells[0]).toEqual({
      flag: 'derived',
      note: 'cumulative total reported by harness',
    });
  });

  test('incomparable when two harnesses in the comparison define the field differently', () => {
    const a = adapter('claude-code', ['usage.perCall'], { output: 'Anthropic output_tokens' });
    const b = adapter('codex', ['usage.perCall'], {
      output: 'OpenAI output_tokens (reasoning included)',
    });
    const s1 = summary({ id: 'a', harness: 'claude-code', usage: { output: metric(10) } });
    const s2 = summary({ id: 'b', harness: 'codex', usage: { output: metric(20) } });
    const m = comparability(
      [s1, s2],
      new Map<string, HarnessAdapter>([
        ['claude-code', a],
        ['codex', b],
      ]),
    );
    const row = m.rows.find((r) => r.field === 'output');
    expect(row?.cells.every((c) => c.flag === 'incomparable')).toBe(true);
  });

  test('same explain() text across harnesses is comparable (ok), not incomparable', () => {
    const a = adapter('claude-code', ['usage.perCall'], { output: 'total generated tokens' });
    const b = adapter('codex', ['usage.perCall'], { output: 'total generated tokens' });
    const s1 = summary({ id: 'a', harness: 'claude-code', usage: { output: metric(10) } });
    const s2 = summary({ id: 'b', harness: 'codex', usage: { output: metric(20) } });
    const m = comparability(
      [s1, s2],
      new Map<string, HarnessAdapter>([
        ['claude-code', a],
        ['codex', b],
      ]),
    );
    const row = m.rows.find((r) => r.field === 'output');
    expect(row?.cells.every((c) => c.flag === 'ok')).toBe(true);
  });

  test('apiCalls specifically requires usage.perCall, not usage.cumulative alone', () => {
    const a = adapter('codex', ['usage.cumulative']);
    const s = summary({ harness: 'codex', counts: { apiCalls: metric(5) } });
    const m = comparability([s], new Map([['codex', a]]));
    const row = m.rows.find((r) => r.field === 'apiCalls');
    expect(row?.cells[0]?.flag).toBe('not-provided');
  });

  test('covers every Usage and Counts field as a row', () => {
    const a = adapter('claude-code', []);
    const s = summary({ harness: 'claude-code' });
    const m = comparability([s], new Map([['claude-code', a]]));
    const fields = m.rows.map((r) => r.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'uncachedInput',
        'cachedInput',
        'cacheWrite',
        'output',
        'reasoningOutput',
        'totalInput',
        'turns',
        'apiCalls',
        'toolCalls',
        'compactions',
        'subagents',
      ]),
    );
  });
});
