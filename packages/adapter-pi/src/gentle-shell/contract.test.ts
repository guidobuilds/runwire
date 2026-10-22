import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, SessionBundle } from '@runwire/core';
import { createBunFs, TOKEN_FIELDS } from '@runwire/core';
import { adapterContract } from '@runwire/core/test-kit';
import { createGentleShellAdapter } from './index';

const ROOT = join(import.meta.dir, '..', '..', '..', '..', 'fixtures', 'gentle-shell');
const id = (suffix: string) => `gentle-shell:b0000000-0000-7000-8000-${suffix.padStart(12, '0')}`;

function context(name: string): AdapterContext {
  return {
    home: join(ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function collect(name: string, ctx = context(name)): Promise<SessionBundle[]> {
  const bundles: SessionBundle[] = [];
  for await (const bundle of createGentleShellAdapter().discover(ctx, new Map())) {
    bundles.push(bundle);
  }
  return bundles;
}

adapterContract({
  adapter: createGentleShellAdapter(),
  ctx: context('all'),
  malformedSessionId: id('8'),
  canarySentinel: 'RUNWIRE_CANARY_',
});

describe('gentle-shell fixture behavior', () => {
  test('small preserves the linked pair with monotonic timing and zero diagnostics', async () => {
    const bundles = await collect('small');
    expect(bundles).toHaveLength(2);
    for (const bundle of bundles) expect(bundle.diagnostics).toEqual([]);
    const parent = bundles.find((b) => b.session.id === id('1'));
    expect(parent?.session).toMatchObject({ durationMs: 4000, depth: 0 });
    expect(parent?.session.initiatorKind).toBeUndefined();
    expect(parent?.steps.find((s) => s.kind === 'tool')).toMatchObject({
      durationMs: 1000,
      error: false,
    });
  });

  test('subagents use only linkage metadata, never ledger aggregates', async () => {
    const bundles = await collect('subagents');
    expect(bundles).toHaveLength(2);
    const parent = bundles.find((b) => b.session.id === id('3'));
    const child = bundles.find((b) => b.session.id === id('b3'));
    expect(parent?.session.initiatorKind).toBeUndefined();
    expect(child?.session).toMatchObject({
      parentId: id('3'),
      relation: 'subagent',
      agentType: 'gentle-ai-worker',
      depth: 1,
      spawnCallId: 'spawn-3',
      initiatorKind: 'machine',
      initiatorAutomation: 'subagent-dispatch',
      uncachedInput: 2,
      cachedInput: 3,
      cacheWrite: 4,
      output: 5,
      reasoningOutput: 1,
      costUsd: 0.25,
      turns: 1,
      toolCalls: 1,
      apiCalls: 1,
    });
    expect(JSON.stringify(bundles)).not.toContain('987654321');
    expect(child?.diagnostics).toEqual([]);
  });

  test('cross-home links to Pi without opening Pi-owned session content', async () => {
    const ctx = context('cross-home');
    const fs = ctx.fs;
    const reads: string[] = [];
    const guard = (path: string) => {
      reads.push(path);
      if (path.includes('/.pi/agent/sessions/')) throw new Error('cross-read');
    };
    ctx.fs = {
      ...fs,
      readFile: async (path) => {
        guard(path);
        return fs.readFile(path);
      },
      openStream: (path) => {
        guard(path);
        return fs.openStream(path);
      },
    };
    const bundles = await collect('cross-home', ctx);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.session).toMatchObject({
      id: id('b4'),
      parentId: 'pi:b0000000-0000-7000-8000-000000000004',
      relation: 'subagent',
      depth: 1,
      initiatorKind: 'machine',
    });
    expect(bundles[0]?.session.spawnCallId).toBeUndefined();
    expect(bundles[0]?.diagnostics).toEqual([]);
    expect(reads.some((p) => p.includes('/.pi/agent/sessions/'))).toBe(false);
  });

  test('extra usage contributes four extra calls and all five token totals', async () => {
    const bundles = await collect('extra-usage');
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0] as SessionBundle;
    const calls = bundle.steps.filter((s) => s.kind === 'call');
    expect(calls).toHaveLength(5);
    expect(bundle.session.apiCalls).toBe(5);
    for (const field of TOKEN_FIELDS) {
      expect(bundle.session[field]).toBeDefined();
      expect(bundle.session[field]).toBe(calls.reduce((sum, s) => sum + (s[field] ?? 0), 0));
    }
    expect(bundle.session).toMatchObject({
      uncachedInput: 10,
      cachedInput: 15,
      cacheWrite: 20,
      output: 25,
      reasoningOutput: 5,
    });
    expect(bundle.diagnostics).toMatchObject([{ code: 'usage-on-non-assistant', count: 4 }]);
  });

  test('new-format recognizes Pi 1.2 records, direct duration, effort and bounded nesting', async () => {
    const [bundle] = await collect('new-format');
    expect(bundle?.session).toMatchObject({ effort: 'high', toolCalls: 1 });
    expect(bundle?.steps.find((s) => s.kind === 'tool')).toMatchObject({
      toolName: 'codemode',
      durationMs: 17,
      error: true,
    });
    expect(bundle?.steps.some((s) => s.kind === 'harness' && s.toolName === 'context-edit')).toBe(
      true,
    );
    expect(bundle?.diagnostics).toMatchObject([{ code: 'nested-tool-calls', count: 2 }]);
    expect(bundle?.diagnostics.some((d) => d.code.startsWith('unknown-'))).toBe(false);
  });

  test('malformed lines and ledger produce diagnostics without dropping the valid session', async () => {
    const bundles = await collect('malformed');
    expect(bundles).toHaveLength(2);
    const broken = bundles.find((b) => b.session.id === id('8'));
    expect(broken?.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['malformed-json-line', 'source-truncated', 'ledger-invalid']),
    );
    const valid = bundles.find((b) => b.session.id === id('88'));
    expect(valid?.session.apiCalls).toBe(1);
    expect(valid?.diagnostics).toEqual([]);
  });

  test('canary covers content-bearing session and ledger fields without leaking', async () => {
    const bundles = await collect('canary');
    expect(bundles).toHaveLength(2);
    expect(bundles.every((b) => b.session.title === undefined)).toBe(true);
    expect(bundles.find((b) => b.session.id === id('b9'))?.session.parentId).toBe(id('9'));
    expect(JSON.stringify(bundles)).not.toContain('RUNWIRE_CANARY_');
  });

  test('all includes fork linkage as well as subagent children', async () => {
    const bundles = await collect('all');
    expect(bundles.some((b) => b.session.relation === 'fork')).toBe(true);
    expect(bundles.some((b) => b.session.relation === 'subagent')).toBe(true);
  });
});
