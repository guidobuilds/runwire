import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterContext, SessionBundle } from '@runwire/core';
import { createBunFs, TOKEN_FIELDS } from '@runwire/core';
import { adapterContract } from '@runwire/core/test-kit';
import { createPiAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'pi');

function contextForFixture(name: string, titles = true): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function collect(ctx: AdapterContext): Promise<SessionBundle[]> {
  const adapter = createPiAdapter();
  const out: SessionBundle[] = [];
  for await (const bundle of adapter.discover(ctx, new Map())) out.push(bundle);
  return out;
}

async function bundleFor(ctx: AdapterContext, sessionId: string): Promise<SessionBundle> {
  const bundles = await collect(ctx);
  const found = bundles.find((b) => b.session.id === sessionId);
  if (!found) {
    throw new Error(
      `bundle not found: ${sessionId} (have: ${bundles.map((b) => b.session.id).join(', ')})`,
    );
  }
  return found;
}

adapterContract({
  adapter: createPiAdapter(),
  ctx: contextForFixture('all'),
  malformedSessionId: 'pi:a1000000-0000-7000-8000-000000000008',
  canarySentinel: 'RUNWIRE_CANARY_',
});

describe('pi adapter: small fixture', () => {
  test('discovers exactly one session with no diagnostics and a timed, successful tool call', async () => {
    const ctx = contextForFixture('small');
    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0] as SessionBundle;
    expect(bundle.session.id).toBe('pi:a1000000-0000-7000-8000-000000000001');
    expect(bundle.session.depth).toBe(0);
    expect(bundle.session.durationMs).toBe(5000);
    expect(bundle.diagnostics).toEqual([]);
    const tool = bundle.steps.find((s) => s.kind === 'tool');
    expect(tool?.durationMs).toBe(2000);
    expect(tool?.error).toBe(false);
  });
});

describe('pi adapter: tree fixture (file-order linearization)', () => {
  test('step kinds follow append order across both roots', async () => {
    const ctx = contextForFixture('tree');
    const bundle = await bundleFor(ctx, 'pi:a1000000-0000-7000-8000-000000000002');
    expect(bundle.steps.map((s) => s.kind)).toEqual([
      'turn',
      'call',
      'tool',
      'model-change',
      'call',
      'harness',
      'turn',
      'call',
      'tool',
    ]);
  });

  test('reports branched-tree, unanswered-tool-call and a model-change step', async () => {
    const ctx = contextForFixture('tree');
    const bundle = await bundleFor(ctx, 'pi:a1000000-0000-7000-8000-000000000002');
    const codes = bundle.diagnostics.map((d) => d.code);
    expect(codes).toContain('branched-tree');
    expect(codes).toContain('unanswered-tool-call');
    expect(bundle.diagnostics.find((d) => d.code === 'branched-tree')?.count).toBe(1);
    expect(bundle.steps.some((s) => s.kind === 'model-change')).toBe(true);
  });
});

describe('pi adapter: subagents fixture', () => {
  test('subagent_run is an agent-category tool step and the extension sibling is never discovered', async () => {
    const ctx = contextForFixture('subagents');
    const sibling = join(
      FIXTURES_ROOT,
      'subagents',
      'home',
      '.pi',
      'agent',
      'gentle-agents',
      'sessions',
      '2026-01-03T01-00-00-000Z_a1000000-0000-7000-8000-0000000000b0.jsonl',
    );
    expect(existsSync(sibling)).toBe(true);

    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.diagnostics.some((d) => d.code === 'branched-tree')).toBe(false);
    const tool = bundles[0]?.steps.find((s) => s.kind === 'tool');
    expect(tool?.toolName).toBe('subagent_run');
    expect(tool?.toolCategory).toBe('agent');
  });
});

describe('pi adapter: legacy fixture', () => {
  test('carries the legacy diagnostic codes across both files', async () => {
    const ctx = contextForFixture('legacy');
    const bundles = await collect(ctx);
    const codes = new Set(bundles.flatMap((b) => b.diagnostics.map((d) => d.code)));
    expect(codes.has('legacy-format')).toBe(true);
    expect(codes.has('missing-session-header')).toBe(true);
    expect(codes.has('unknown-message-role')).toBe(true);
    expect(codes.has('cwd-from-dirname')).toBe(true);
  });

  test('the headerless file takes its identity from the filename uuid', async () => {
    const ctx = contextForFixture('legacy');
    const bundle = await bundleFor(ctx, 'pi:a1000000-0000-7000-8000-000000000005');
    expect(bundle.session.id).toBe('pi:a1000000-0000-7000-8000-000000000005');
  });
});

describe('pi adapter: fork fixture', () => {
  test('parentSession becomes a fork link with no parentId', async () => {
    const ctx = contextForFixture('fork');
    const bundle = await bundleFor(ctx, 'pi:a1000000-0000-7000-8000-000000000006');
    expect(bundle.session.relation).toBe('fork');
    expect(bundle.session.forkedFrom).toBe('pi:99000000-0000-7000-8000-0000000000aa');
    expect(bundle.session.parentId).toBeUndefined();
    expect(bundle.diagnostics.some((d) => d.code === 'branched-tree')).toBe(false);
  });
});

describe('pi adapter: extra-usage fixture', () => {
  test('extra-context calls count as API calls and stay inside the Σ invariant', async () => {
    const ctx = contextForFixture('extra-usage');
    const bundle = await bundleFor(ctx, 'pi:a1000000-0000-7000-8000-000000000007');
    const calls = bundle.steps.filter((s) => s.kind === 'call');
    expect(calls).toHaveLength(4);
    expect(calls.filter((s) => s.model === undefined)).toHaveLength(3);
    expect(bundle.session.apiCalls).toBe(calls.length);
    expect(bundle.session.modelPrimary).toBeDefined();
    for (const field of TOKEN_FIELDS) {
      const sessionValue = bundle.session[field];
      if (sessionValue === undefined) continue;
      const sum = calls.reduce((acc, s) => acc + (s[field] ?? 0), 0);
      expect(sum).toBe(sessionValue);
    }
    const diag = bundle.diagnostics.find((d) => d.code === 'usage-on-non-assistant');
    expect(diag?.count).toBe(3);
    expect(bundle.diagnostics.some((d) => d.code === 'branched-tree')).toBe(false);
  });
});

describe('pi adapter: canary fixture', () => {
  test('session_info.name is never emitted as a title and the sentinel is absent', async () => {
    const ctx = contextForFixture('canary');
    const bundles = await collect(ctx);
    const bundle = bundles[0] as SessionBundle;
    expect(bundle.session.title).toBeUndefined();
    expect(bundle.diagnostics.some((d) => d.code === 'branched-tree')).toBe(false);
    const serialized = JSON.stringify(bundle);
    expect(serialized.includes('RUNWIRE_CANARY_')).toBe(false);
  });
});

describe('pi adapter: probe', () => {
  test('reports not installed when <agentDir>/sessions does not exist', async () => {
    const ctx: AdapterContext = {
      home: '/does/not/exist/at/all',
      platform: 'darwin',
      env: {},
      fs: createBunFs(),
      privacy: { titles: true },
      log: { info() {}, warn() {}, error() {} },
    };
    const adapter = createPiAdapter();
    const result = await adapter.probe(ctx);
    expect(result.installed).toBe(false);
    expect(result.roots).toEqual([]);
  });

  test('reports installed with the sessions root when a fixture home exists', async () => {
    const ctx = contextForFixture('small');
    const adapter = createPiAdapter();
    const result = await adapter.probe(ctx);
    expect(result.installed).toBe(true);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]?.endsWith('.pi/agent/sessions')).toBe(true);
  });
});
