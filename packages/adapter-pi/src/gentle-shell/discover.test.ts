import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterContext, SessionBundle } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { createGentleShellAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', '..', 'fixtures', 'gentle-shell');

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

async function collect(ctx: AdapterContext, known = new Map()): Promise<SessionBundle[]> {
  const adapter = createGentleShellAdapter();
  const out: SessionBundle[] = [];
  for await (const bundle of adapter.discover(ctx, known)) out.push(bundle);
  return out;
}

describe('gentle-shell discovery', () => {
  test('probe returns every candidate root, even the missing ones', async () => {
    const ctx = contextForFixture('small');
    const probe = await createGentleShellAdapter().probe(ctx);
    expect(probe.installed).toBe(true);
    expect(probe.roots).toHaveLength(3);
    expect(probe.roots.some((r) => r.endsWith('/.gentle-shell/agent/sessions'))).toBe(true);
    expect(probe.roots.some((r) => r.endsWith('/.gentle-shell/agent/gentle-agents/sessions'))).toBe(
      true,
    );
    expect(probe.roots.some((r) => r.endsWith('/.pi/agent/gentle-agents/sessions'))).toBe(true);
  });

  test('small: one parent and one linked child with exact ids', async () => {
    const ctx = contextForFixture('small');
    const bundles = await collect(ctx);
    const ids = bundles.map((b) => b.session.id).sort();
    expect(ids).toEqual([
      'gentle-shell:b0000000-0000-7000-8000-000000000001',
      'gentle-shell:b0000000-0000-7000-8000-0000000000b0',
    ]);
    expect(bundles.every((b) => b.session.harnessId === 'gentle-shell')).toBe(true);
    const child = bundles.find((b) => b.session.id.endsWith('b0'));
    expect(child?.diagnostics.some((d) => d.code === 'unlinked-subagent')).toBe(false);
    expect(child?.diagnostics.some((d) => d.code === 'orphan-parent')).toBe(false);
  });

  test('a second discover with the known map skips every source', async () => {
    const ctx = contextForFixture('small');
    const first = await collect(ctx);
    const known = new Map();
    for (const bundle of first) {
      known.set(bundle.session.sourcePath, {
        size: bundle.session.sourceSize,
        mtime: bundle.session.sourceMtime,
      });
    }
    const second = await collect(ctx, known);
    expect(second).toHaveLength(0);
  });

  test('unlinked: a child without a ledger task imports as a root with the diagnostic', async () => {
    const ctx = contextForFixture('unlinked');
    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.session.id).toBe('gentle-shell:b0000000-0000-7000-8000-0000000000b1');
    expect(bundles[0]?.diagnostics.some((d) => d.code === 'unlinked-subagent')).toBe(true);
  });

  test('duplicate: the same child uuid under two homes emits one bundle with more usage records', async () => {
    const ctx = contextForFixture('duplicate');
    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0] as SessionBundle;
    expect(bundle.session.id).toBe('gentle-shell:b0000000-0000-7000-8000-0000000000b2');
    expect(bundle.session.sourcePath?.includes('.gentle-shell/agent/gentle-agents/')).toBe(true);
    expect(bundle.diagnostics.some((d) => d.code === 'duplicate-child')).toBe(true);
  });

  test('a root that vanishes mid-stream throws instead of pruning history', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'runwire-gs-vanish-'));
    try {
      cpSync(join(FIXTURES_ROOT, 'small', 'home'), join(tmp, 'home'), { recursive: true });
      const ctx: AdapterContext = {
        home: join(tmp, 'home'),
        platform: 'darwin',
        env: {},
        fs: createBunFs(),
        privacy: { titles: true },
        log: { info() {}, warn() {}, error() {} },
      };
      const adapter = createGentleShellAdapter();
      const iterator = adapter.discover(ctx, new Map())[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      rmSync(join(tmp, 'home'), { recursive: true, force: true });
      await expect(iterator.next()).rejects.toThrow('enumerated directory vanished');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
