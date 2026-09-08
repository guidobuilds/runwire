import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, SessionBundle } from '@scout/core';
import { createBunFs } from '@scout/core';
import { adapterContract } from '@scout/core/test-kit';
import { createOpencodeAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'opencode');

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
  const adapter = createOpencodeAdapter();
  const out: SessionBundle[] = [];
  for await (const bundle of adapter.discover(ctx, new Map())) out.push(bundle);
  return out;
}

// --- Adapter contract kit ---
// Runs against fixtures/opencode/all: the union of current + legacy stores, so
// the capabilities-consistency check sees the full repertoire in one discover().
adapterContract({
  adapter: createOpencodeAdapter(),
  ctx: contextForFixture('all'),
  canarySentinel: 'SCOUT_CANARY_',
});

describe('opencode adapter: malformed fixture', () => {
  test('the malformed session never throws discover() and carries >= 1 diagnostic', async () => {
    const bundles = await collect(contextForFixture('malformed'));
    const bundle = bundles.find((b) => b.session.id === 'opencode:current:ses_malformed');
    expect(bundle).toBeDefined();
    expect(bundle?.diagnostics.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe('opencode adapter: canary content is never returned', () => {
  test('the sentinel does not appear anywhere reachable from a bundle', async () => {
    const bundles = await collect(contextForFixture('canary'));
    const json = JSON.stringify(bundles);
    expect(json.includes('SCOUT_CANARY_')).toBe(false);
  });
});

describe('opencode adapter: createOpencodeAdapter shape', () => {
  test('has id opencode, displayName, adapterVersion, capabilities, allowlist, probe, discover, sourceExists', () => {
    const adapter = createOpencodeAdapter();
    expect(adapter.id).toBe('opencode');
    expect(adapter.displayName).toBe('OpenCode');
    expect(adapter.adapterVersion).toBe('1.1.0');
    expect(Array.isArray(adapter.capabilities)).toBe(true);
    expect(adapter.allowlist).toBeTypeOf('object');
    expect(adapter.probe).toBeTypeOf('function');
    expect(adapter.discover).toBeTypeOf('function');
    expect(adapter.sourceExists).toBeTypeOf('function');
  });
});
