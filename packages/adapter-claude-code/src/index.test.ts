import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, ScoutEvent, SourceRef } from '@scout/core';
import { createBunFs, createMemoryFs, reduce } from '@scout/core';
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
