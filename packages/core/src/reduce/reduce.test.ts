import { describe, expect, test } from 'bun:test';
import type { ScoutEvent } from '../events/event';
import type { ReduceContext } from './reduce';
import { reduce } from './reduce';

const ctx: ReduceContext = {
  harness: 'claude-code',
  path: '/fake/session.jsonl',
  privacyTitles: true,
};

async function* stream(events: ScoutEvent[]): AsyncIterable<ScoutEvent> {
  for (const e of events) yield e;
}

describe('reduce - meta and errors', () => {
  test('throws if the source never emits a meta event', async () => {
    await expect(
      reduce(stream([{ kind: 'observed', at: '2026-01-01T00:00:00Z' }]), ctx),
    ).rejects.toThrow(/meta/);
  });

  test('captures sourceId, cwd, title (when privacy.titles is on) and git from meta', async () => {
    const r = await reduce(
      stream([
        {
          kind: 'meta',
          sourceId: 's1',
          role: 'root',
          cwd: '/home/u/proj',
          title: 'Fix the bug',
          git: { branch: 'main', commit: 'abc', remote: 'github.com/x/y' },
          at: '2026-01-01T00:00:00Z',
        },
      ]),
      ctx,
    );
    expect(r.sourceId).toBe('s1');
    expect(r.cwd.first).toBe('/home/u/proj');
    expect(r.title).toEqual({ value: 'Fix the bug', contentDerived: true });
    expect(r.git).toEqual({ branch: 'main', commit: 'abc', remote: 'github.com/x/y' });
  });

  test('drops the title when privacy.titles is false', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root', title: 'secret prompt-derived title' },
      ]),
      { ...ctx, privacyTitles: false },
    );
    expect(r.title).toBeUndefined();
  });
});

describe('reduce - usage dedupe (per-call, high confidence)', () => {
  test('sums usage once per dedupeKey, not once per event', async () => {
    // Regression for the Claude Code overcount: one API response can be split
    // across several assistant records sharing a requestId with identical usage.
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'usage', dedupeKey: 'req1', output: 100, uncachedInput: 10 },
        { kind: 'usage', dedupeKey: 'req1', output: 100, uncachedInput: 10 },
        { kind: 'usage', dedupeKey: 'req2', output: 50, uncachedInput: 5 },
      ]),
      ctx,
    );
    expect(r.usage.output?.value).toBe(150);
    expect(r.usage.output?.confidence).toBe('high');
    expect(r.usage.uncachedInput?.value).toBe(15);
    expect(r.counts.apiCalls?.value).toBe(2);
  });

  test('events without a dedupeKey are each unique', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'usage', output: 10 },
        { kind: 'usage', output: 20 },
      ]),
      ctx,
    );
    expect(r.usage.output?.value).toBe(30);
    expect(r.counts.apiCalls?.value).toBe(2);
  });

  test('a field listed in derived is medium confidence with a derived note', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        {
          kind: 'usage',
          dedupeKey: 'req1',
          output: 10,
          uncachedInput: 5,
          derived: ['uncachedInput'],
        },
      ]),
      ctx,
    );
    expect(r.usage.output?.confidence).toBe('high');
    expect(r.usage.uncachedInput?.confidence).toBe('medium');
    expect(r.usage.uncachedInput?.note).toContain('derived');
  });
});

describe('reduce - usageTotal only (medium confidence)', () => {
  test('takes the last usageTotal snapshot when there is no per-call usage', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'usageTotal', output: 100, cachedInput: 40 },
        { kind: 'usageTotal', output: 250, cachedInput: 90 },
      ]),
      ctx,
    );
    expect(r.usage.output?.value).toBe(250);
    expect(r.usage.output?.confidence).toBe('medium');
    expect(r.usage.output?.note).toBe('cumulative total reported by harness');
    expect(r.counts.apiCalls).toBeUndefined();
  });
});

describe('reduce - cross-check mismatch (low confidence)', () => {
  test('downgrades usage to low when deduped sum and last total disagree by more than 5%', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'usage', dedupeKey: 'req1', output: 100 },
        { kind: 'usageTotal', output: 500 },
      ]),
      ctx,
    );
    expect(r.usage.output?.value).toBe(100);
    expect(r.usage.output?.confidence).toBe('low');
    expect(r.usage.output?.note).toBe('usage-total-mismatch');
    expect(r.diagnostics.some((d) => d.code === 'usage-total-mismatch')).toBe(true);
  });

  test('does not downgrade when within the 5% tolerance', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'usage', dedupeKey: 'req1', output: 100 },
        { kind: 'usageTotal', output: 103 },
      ]),
      ctx,
    );
    expect(r.usage.output?.confidence).toBe('high');
  });
});

describe('reduce - timing', () => {
  test('two or more timestamps give high-confidence bounds and duration', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root', at: '2026-01-01T00:00:00.000Z' },
        { kind: 'observed', at: '2026-01-01T00:10:00.000Z' },
      ]),
      ctx,
    );
    expect(r.timing.startedAt?.confidence).toBe('high');
    expect(r.timing.durationMs?.value).toBe(600_000);
  });

  test('a single timestamp yields a low-confidence startedAt and no duration', async () => {
    const r = await reduce(
      stream([{ kind: 'meta', sourceId: 's1', role: 'root', at: '2026-01-01T00:00:00.000Z' }]),
      ctx,
    );
    expect(r.timing.startedAt?.confidence).toBe('low');
    expect(r.timing.startedAt?.note).toBe('single-timestamp');
    expect(r.timing.durationMs).toBeUndefined();
  });

  test('zero timestamps leave timing entirely absent', async () => {
    const r = await reduce(stream([{ kind: 'meta', sourceId: 's1', role: 'root' }]), ctx);
    expect(r.timing.startedAt).toBeUndefined();
  });
});

describe('reduce - model and mode primary/changes', () => {
  test('primary model is the one with the most attributed output; changes counts transitions', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'model', model: 'haiku' },
        { kind: 'usage', dedupeKey: 'r1', model: 'haiku', output: 5 },
        { kind: 'model', model: 'opus' },
        { kind: 'usage', dedupeKey: 'r2', model: 'opus', output: 500 },
        { kind: 'model', model: 'haiku' },
      ]),
      ctx,
    );
    expect(r.model.primary?.value).toBe('opus');
    expect(r.model.primary?.confidence).toBe('medium');
    expect(r.model.primary?.note).toBe('changed 2 times');
    expect(r.model.changes).toBe(2);
    expect(r.model.all).toEqual(['haiku', 'opus']);
  });

  test('a single model with no changes is high confidence and has no note', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'model', model: 'opus' },
      ]),
      ctx,
    );
    expect(r.model.primary?.confidence).toBe('high');
    expect(r.model.primary?.note).toBeUndefined();
  });

  test('mode primary is the most frequent mode', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'mode', mode: 'auto' },
        { kind: 'mode', mode: 'plan' },
        { kind: 'mode', mode: 'auto' },
      ]),
      ctx,
    );
    expect(r.mode?.primary?.value).toBe('auto');
    expect(r.mode?.changes).toBe(2);
  });

  test('no mode events leaves mode entirely absent, not an empty object', async () => {
    const r = await reduce(stream([{ kind: 'meta', sourceId: 's1', role: 'root' }]), ctx);
    expect(r.mode).toBeUndefined();
  });
});

describe('reduce - counts', () => {
  test('turns come only from explicit turn events, and are never summed with subagents (rollup concern)', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'turn' },
        { kind: 'turn' },
        { kind: 'toolCall', name: 'Read', category: 'read' },
        { kind: 'compaction' },
      ]),
      ctx,
    );
    expect(r.counts.turns?.value).toBe(2);
    expect(r.counts.toolCalls?.value).toBe(1);
    expect(r.counts.compactions?.value).toBe(1);
    expect(r.counts.subagents).toBeUndefined();
  });

  test('no turn events leaves turns absent rather than zero', async () => {
    const r = await reduce(stream([{ kind: 'meta', sourceId: 's1', role: 'root' }]), ctx);
    expect(r.counts.turns).toBeUndefined();
  });
});

describe('reduce - version, flags, link, cost', () => {
  test('version first/last and versionChanged flag', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root', harnessVersion: '1.0.0' },
        { kind: 'version', version: '1.1.0' },
      ]),
      ctx,
    );
    expect(r.harnessVersion).toEqual({ first: '1.0.0', last: '1.1.0' });
    expect(r.flags.versionChanged).toBe(true);
  });

  test('no version change leaves the flag unset', async () => {
    const r = await reduce(
      stream([{ kind: 'meta', sourceId: 's1', role: 'root', harnessVersion: '1.0.0' }]),
      ctx,
    );
    expect(r.flags.versionChanged).toBeUndefined();
  });

  test('resumed and forkedFrom flags', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'flag', flag: 'resumed', value: true },
        { kind: 'flag', flag: 'forkedFrom', value: 'other-session' },
      ]),
      ctx,
    );
    expect(r.flags.resumed).toBe(true);
    expect(r.flags.forkedFrom).toBe('other-session');
  });

  test('a link event captures parent, relation, depth hint and viaCallId', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 'child1', role: 'child' },
        {
          kind: 'link',
          parentSourceId: 'root1',
          relation: 'subagent',
          agentType: 'Explore',
          depth: 1,
          viaCallId: 'call1',
        },
      ]),
      ctx,
    );
    expect(r.parentSourceId).toBe('root1');
    expect(r.relation).toBe('subagent');
    expect(r.agentType).toBe('Explore');
    expect(r.depthHint).toBe(1);
    expect(r.viaCallId).toBe('call1');
  });

  test('cost takes the last reported value', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        { kind: 'cost', usd: 1.5 },
        { kind: 'cost', usd: 3.2 },
      ]),
      ctx,
    );
    expect(r.cost?.value.usd).toBe(3.2);
  });
});

describe('reduce - diagnostics', () => {
  test('diagnostic events become Diagnostics stamped with harness and path', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        {
          kind: 'diagnostic',
          level: 'warn',
          code: 'unknown-record-type',
          message: 'saw 3 unknown records',
          line: 42,
        },
      ]),
      ctx,
    );
    const d = r.diagnostics.find((x) => x.code === 'unknown-record-type');
    expect(d).toBeDefined();
    expect(d?.harness).toBe('claude-code');
    expect(d?.path).toBe('/fake/session.jsonl');
    expect(d?.line).toBe(42);
  });

  test('missing cwd produces a no-cwd diagnostic', async () => {
    const r = await reduce(stream([{ kind: 'meta', sourceId: 's1', role: 'root' }]), ctx);
    expect(r.diagnostics.some((d) => d.code === 'no-cwd')).toBe(true);
  });
});

describe('reduce - totalInput', () => {
  test('is derived from uncachedInput + cachedInput + cacheWrite', async () => {
    const r = await reduce(
      stream([
        { kind: 'meta', sourceId: 's1', role: 'root' },
        {
          kind: 'usage',
          dedupeKey: 'r1',
          uncachedInput: 10,
          cachedInput: 5,
          cacheWrite: 2,
          output: 1,
        },
      ]),
      ctx,
    );
    expect(r.usage.totalInput?.value).toBe(17);
  });
});
