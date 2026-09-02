import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, ScoutEvent, SourceRef } from '@scout/core';
import { createBunFs, createMemoryFs, link, reduce } from '@scout/core';
import { adapterContract } from '@scout/core/test-kit';
import { createClaudeCodeAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'claude-code');

function contextForFixture(name: string): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function collectEvents(ref: SourceRef, ctx: AdapterContext): Promise<ScoutEvent[]> {
  const adapter = createClaudeCodeAdapter();
  const out: ScoutEvent[] = [];
  for await (const e of adapter.parse(ref, ctx)) out.push(e);
  return out;
}

async function findRef(ctx: AdapterContext, sourceId: string): Promise<SourceRef> {
  const adapter = createClaudeCodeAdapter();
  for await (const ref of adapter.discover(ctx)) {
    if (ref.sourceId === sourceId) return ref;
  }
  throw new Error(`fixture ref not found: ${sourceId}`);
}

// --- Adapter contract kit ---
// Runs against fixtures/claude-code/all: the union of every other fixture
// here, since the "capabilities are consistent" check needs to see the full
// repertoire of real behavior in one discover() view (no single fixture
// alone exercises every declared capability — see all/README.md).

const contractCtx = contextForFixture('all');
adapterContract({
  adapter: createClaudeCodeAdapter(),
  ctx: contractCtx,
  malformedSourceId: 'malformed-session',
  canarySourceId: 'canary-session',
  canarySentinel: 'SCOUT_CANARY_',
});

// --- Per-fixture correctness ---

describe('claude-code adapter: small fixture', () => {
  test('discovers exactly one root session with no diagnostics', async () => {
    const ctx = contextForFixture('small');
    const ref = await findRef(ctx, 'ce93c1a2-540a-4692-b016-a452c55ae0de');
    expect(ref.kind).toBe('root');
    const events = await collectEvents(ref, ctx);
    expect(events[0]?.kind).toBe('meta');
    expect(events.filter((e) => e.kind === 'diagnostic')).toEqual([]);
  });
});

describe('claude-code adapter: medium fixture (the dedupe regression)', () => {
  test('deduped output matches the known-good value, not the naive sum', async () => {
    const ctx = contextForFixture('medium');
    const ref = await findRef(ctx, '3666e64a-bdeb-4ffb-82d4-ad06666a67a8');
    const adapter = createClaudeCodeAdapter();
    const reduced = await reduce(adapter.parse(ref, ctx), {
      harness: 'claude-code',
      path: ref.path,
      privacyTitles: true,
    });

    // Known-good value from the real reference session (docs/adapters/claude-code.md):
    // naive per-record sum is 1,117,279; deduped by requestId is 438,086.
    expect(reduced.usage.output?.value).toBe(438_086);
    expect(reduced.usage.output?.confidence).toBe('high');
    expect(reduced.counts.apiCalls?.value).toBe(386);
    expect(reduced.model.all).toContain('claude-opus-5');
    expect(reduced.model.all).toContain('claude-sonnet-5');
    expect(reduced.flags.versionChanged).toBe(true);
    expect(reduced.counts.compactions?.value).toBeGreaterThanOrEqual(1);
  });
});

describe('claude-code adapter: subagents fixture', () => {
  test('both subagents link to the root with agentType, depth and viaCallId', async () => {
    const ctx = contextForFixture('subagents');
    const rootId = '5db79557-f2ad-489d-81ee-607606b3a6ef';
    const childRefs: SourceRef[] = [];
    const adapter = createClaudeCodeAdapter();
    for await (const ref of adapter.discover(ctx)) {
      if (ref.kind === 'child') childRefs.push(ref);
    }
    expect(childRefs).toHaveLength(2);

    for (const ref of childRefs) {
      expect(ref.parentHint).toBe(rootId);
      const events = await collectEvents(ref, ctx);
      const link = events.find((e) => e.kind === 'link');
      expect(link).toBeDefined();
      if (link?.kind === 'link') {
        expect(link.parentSourceId).toBe(rootId);
        expect(link.relation).toBe('subagent');
        expect(link.agentType).toBeTruthy();
        expect(link.viaCallId).toBeTruthy();
      }
    }
  });

  test('the root reduces with a compaction, a version change, and a model change', async () => {
    const ctx = contextForFixture('subagents');
    const ref = await findRef(ctx, '5db79557-f2ad-489d-81ee-607606b3a6ef');
    const adapter = createClaudeCodeAdapter();
    const reduced = await reduce(adapter.parse(ref, ctx), {
      harness: 'claude-code',
      path: ref.path,
      privacyTitles: true,
    });
    expect(reduced.counts.compactions?.value).toBeGreaterThanOrEqual(1);
    expect(reduced.flags.versionChanged).toBe(true);
    expect(reduced.model.changes).toBeGreaterThanOrEqual(1);
  });
});

describe('claude-code adapter: old-version fixture', () => {
  test('has no cost events and still derives turns from user-message heuristics', async () => {
    const ctx = contextForFixture('old-version');
    const ref = await findRef(ctx, 'bdbb0e1e-36e5-4571-bb82-a9b39ba1edec');
    const events = await collectEvents(ref, ctx);
    expect(events.some((e) => e.kind === 'cost')).toBe(false);
    expect(events.some((e) => e.kind === 'turn')).toBe(true);
  });
});

describe('claude-code adapter: malformed fixture (beyond the generic contract check)', () => {
  test('marks the source truncated and reports specific diagnostic codes', async () => {
    const ctx = contextForFixture('malformed');
    const ref = await findRef(ctx, 'malformed-session');
    const events = await collectEvents(ref, ctx);
    const codes = events
      .filter((e) => e.kind === 'diagnostic')
      .map((e) => (e.kind === 'diagnostic' ? e.code : ''));
    expect(codes).toContain('source-truncated');
    expect(codes).toContain('malformed-json-line');
    expect(codes).toContain('unknown-record-type');
    // Records before and after the broken line still produced real events.
    expect(events.some((e) => e.kind === 'usage')).toBe(true);
  });
});

// --- Initiator (human vs machine provenance) ---

/**
 * Builds a minimal single-record session in memory. Used for the initiator
 * cases no committed fixture happens to cover (a pre-`entrypoint` session, an
 * unrecognized future surface, the claude-desktop/promptSource trap).
 */
function memoryCtxWith(records: Array<Record<string, unknown>>): AdapterContext {
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs({ files: { '/home/u/.claude/projects/proj/sess1.jsonl': `${body}\n` } }),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

function assistantRecord(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: 'a1',
    requestId: 'req_1',
    timestamp: '2026-01-01T00:00:00.000Z',
    cwd: '/home/u/proj',
    version: '2.1.257',
    message: { role: 'assistant', model: 'claude-opus-5', usage: { output_tokens: 5 } },
    ...extra,
  };
}

async function initiatorOf(ctx: AdapterContext, sourceId: string) {
  const ref = await findRef(ctx, sourceId);
  const events = await collectEvents(ref, ctx);
  return events.find((e) => e.kind === 'initiator');
}

describe('claude-code adapter: initiator on real fixtures', () => {
  test('an sdk-py root is machine/sdk at high confidence (the 80% majority case)', async () => {
    // small/ was redacted from a real sdk-py session. 308 of 383 real roots
    // on disk are sdk-cli/sdk-py, i.e. the bulk of what has no human behind it.
    const ctx = contextForFixture('small');
    expect(await initiatorOf(ctx, 'ce93c1a2-540a-4692-b016-a452c55ae0de')).toEqual({
      kind: 'initiator',
      initiatorKind: 'machine',
      surface: 'sdk-py',
      automation: 'sdk',
      confidence: 'high',
    });
  });

  test('a plain cli root is human, and only at medium confidence', async () => {
    const ctx = contextForFixture('medium');
    expect(await initiatorOf(ctx, '3666e64a-bdeb-4ffb-82d4-ad06666a67a8')).toEqual({
      kind: 'initiator',
      initiatorKind: 'human',
      surface: 'cli',
      confidence: 'medium',
    });
  });

  test('a dispatched cli root is machine, on the agent-setting marker alone', async () => {
    // dispatch/ was redacted from one of the 10 real `cli` roots that are
    // agent-dispatched workers. entrypoint says `cli` for these exactly as it
    // does for a person at a terminal - only the marker separates them.
    const ctx = contextForFixture('dispatch');
    expect(await initiatorOf(ctx, 'edd8b2ff-23be-43e1-85b2-3ae4ff03791a')).toEqual({
      kind: 'initiator',
      initiatorKind: 'machine',
      surface: 'cli',
      automation: 'subagent-dispatch',
      confidence: 'medium',
    });
  });

  test('the marker is read by presence: the agent-setting payload never reaches an event', async () => {
    const ctx = contextForFixture('dispatch');
    const ref = await findRef(ctx, 'edd8b2ff-23be-43e1-85b2-3ae4ff03791a');
    const events = await collectEvents(ref, ctx);
    expect(JSON.stringify(events)).not.toContain('agentSetting');
    // ...and it is a *handled* type now, not an unrecognized one.
    expect(events.some((e) => e.kind === 'diagnostic' && e.code === 'unknown-record-type')).toBe(
      false,
    );
  });
});

describe('claude-code adapter: initiator edge cases', () => {
  test('promptSource "sdk" does NOT make a claude-desktop session machine', async () => {
    // The verified trap: promptSource `sdk` covers all 308 machine roots AND
    // the single real claude-desktop root (13.3h, 86.5M tokens, 23 user
    // turns) that is unambiguously human. It is allowlisted for diagnostics
    // but must never enter the decision.
    const ctx = memoryCtxWith([
      assistantRecord({ entrypoint: 'claude-desktop' }),
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-01-01T00:00:01.000Z',
        entrypoint: 'claude-desktop',
        promptSource: 'sdk',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      },
    ]);
    expect(await initiatorOf(ctx, 'sess1')).toMatchObject({
      initiatorKind: 'human',
      surface: 'claude-desktop',
      confidence: 'medium',
    });
  });

  test('an unrecognized future surface degrades to unknown instead of breaking', async () => {
    const ctx = memoryCtxWith([assistantRecord({ entrypoint: 'claude-in-some-2027-surface' })]);
    expect(await initiatorOf(ctx, 'sess1')).toEqual({
      kind: 'initiator',
      initiatorKind: 'unknown',
      surface: 'claude-in-some-2027-surface',
      confidence: 'low',
    });
  });

  test('a session predating entrypoint emits no initiator event at all', async () => {
    const ctx = memoryCtxWith([assistantRecord({})]);
    expect(await initiatorOf(ctx, 'sess1')).toBeUndefined();
  });

  test('the initiator event carries no timestamp, so it cannot perturb timing', async () => {
    const withInitiator = memoryCtxWith([
      assistantRecord({ entrypoint: 'sdk-cli' }),
      assistantRecord({ uuid: 'a2', requestId: 'req_2', timestamp: '2026-01-01T00:05:00.000Z' }),
    ]);
    const without = memoryCtxWith([
      assistantRecord({}),
      assistantRecord({ uuid: 'a2', requestId: 'req_2', timestamp: '2026-01-01T00:05:00.000Z' }),
    ]);
    const adapter = createClaudeCodeAdapter();
    const opts = { harness: 'claude-code' as const, privacyTitles: true };
    const a = await reduce(adapter.parse(await findRef(withInitiator, 'sess1'), withInitiator), {
      ...opts,
      path: 'a',
    });
    const b = await reduce(adapter.parse(await findRef(without, 'sess1'), without), {
      ...opts,
      path: 'b',
    });
    expect(a.timing).toEqual(b.timing);
    expect(a.initiator).toBeDefined();
    expect(b.initiator).toBeUndefined();
  });
});

describe('claude-code adapter: initiator survives the whole parse -> reduce -> link path', () => {
  /**
   * The anti-silent-drop guard. `link()` builds SessionSummary from an
   * explicit object literal, not a spread, so a field present on
   * ReducedSession but omitted there disappears with every layer's own unit
   * test still green. This test fails if the field is dropped at *any* of the
   * three hops, which is the only place that property is actually observable.
   */
  async function summaryFor(ctx: AdapterContext, sourceId: string) {
    const adapter = createClaudeCodeAdapter();
    const ref = await findRef(ctx, sourceId);
    const reduced = await reduce(adapter.parse(ref, ctx), {
      harness: 'claude-code',
      path: ref.path,
      privacyTitles: true,
    });
    const { summaries } = link([{ ref, reduced }], () => ({
      key: 'k',
      name: 'n',
      identity: 'cwd' as const,
    }));
    return { reduced, summary: summaries[0] };
  }

  test('a machine session reaches SessionSummary.initiator intact', async () => {
    const ctx = contextForFixture('small');
    const { reduced, summary } = await summaryFor(ctx, 'ce93c1a2-540a-4692-b016-a452c55ae0de');
    expect(reduced.initiator).toBeDefined();
    expect(summary?.initiator).toEqual({
      value: { kind: 'machine', surface: 'sdk-py', automation: 'sdk' },
      confidence: 'high',
      source: 'claude-code/initiator',
    });
    // Guards the hop specifically: whatever reduce produced is what link carries.
    expect(summary?.initiator).toEqual(reduced.initiator);
  });

  test('a dispatched session reaches SessionSummary.initiator intact', async () => {
    const ctx = contextForFixture('dispatch');
    const { reduced, summary } = await summaryFor(ctx, 'edd8b2ff-23be-43e1-85b2-3ae4ff03791a');
    expect(summary?.initiator).toEqual({
      value: { kind: 'machine', surface: 'cli', automation: 'subagent-dispatch' },
      confidence: 'medium',
      source: 'claude-code/initiator',
    });
    expect(summary?.initiator).toEqual(reduced.initiator);
  });

  test('a session with no initiator signal leaves the summary field absent, not fabricated', async () => {
    const ctx = memoryCtxWith([assistantRecord({})]);
    const { summary } = await summaryFor(ctx, 'sess1');
    expect(summary?.initiator).toBeUndefined();
  });
});

describe('claude-code adapter: oversized line (in-memory, not a committed multi-megabyte fixture)', () => {
  test('a line over the size cap is skipped with a diagnostic, not buffered whole', async () => {
    const hugeText = 'x'.repeat(9 * 1024 * 1024);
    const huge = JSON.stringify({
      type: 'user',
      uuid: 'c1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/home/u/proj',
      version: '2.1.250',
      message: { role: 'user', content: [{ type: 'text', text: hugeText }] },
    });
    const ok = JSON.stringify({
      type: 'user',
      uuid: 'c2',
      isMeta: true,
      timestamp: '2026-01-01T00:00:01.000Z',
      cwd: '/home/u/proj',
      version: '2.1.250',
      message: { role: 'user' },
    });

    const fs = createMemoryFs({
      files: { '/home/u/.claude/projects/proj/sess1.jsonl': `${huge}\n${ok}\n` },
    });
    const ctx: AdapterContext = {
      home: '/home/u',
      platform: 'linux',
      env: {},
      fs,
      privacy: { titles: true },
      log: { info() {}, warn() {}, error() {} },
    };
    const ref = await findRef(ctx, 'sess1');
    const events = await collectEvents(ref, ctx);
    expect(events.some((e) => e.kind === 'diagnostic' && e.code === 'oversized-line')).toBe(true);
    expect(events.filter((e) => e.kind === 'observed')).toHaveLength(1); // only the second (small) line parsed
  });
});
