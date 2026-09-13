import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext } from '@scout/core';
import { createBunFs } from '@scout/core';
import { discover, probe, sourceExists } from './discover';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'opencode');

function ctxFor(name: string): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

describe('probe', () => {
  test('installed when at least one origin DB exists; roots = the data dir; notes list both origins', async () => {
    const result = await probe(ctxFor('all'));
    expect(result.installed).toBe(true);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toContain('.local/share/opencode');
    expect(result.notes.some((n) => n.includes('current'))).toBe(true);
    expect(result.notes.some((n) => n.includes('legacy'))).toBe(true);
  });

  test('not installed when the data dir has no OpenCode DBs', async () => {
    const result = await probe({ ...ctxFor('all'), home: '/does/not/exist' });
    expect(result.installed).toBe(false);
    expect(result.roots).toEqual([]);
  });
});

describe('discover', () => {
  test('streams both origins sorted; current then legacy', async () => {
    const bundles = [];
    for await (const b of discover(ctxFor('all'), new Map())) bundles.push(b);
    const ids = bundles.map((b) => b.session.id);
    expect(ids).toContain('opencode:current:ses_all_1');
    expect(ids).toContain('opencode:current:ses_all_child');
    expect(ids).toContain('opencode:legacy:ses_all_legacy');
    // current-origin sessions sort before legacy-origin (they iterate origins in order).
    expect(ids.indexOf('opencode:current:ses_all_1')).toBeLessThan(
      ids.indexOf('opencode:legacy:ses_all_legacy'),
    );
  });

  test('known-skip by sourceId: feeding back known yields zero bundles for unchanged sources', async () => {
    const ctx = ctxFor('small');
    const first = [];
    for await (const b of discover(ctx, new Map())) first.push(b);
    expect(first.length).toBeGreaterThan(0);
    const known = new Map<string, { size: number; mtime: number }>();
    for (const b of first) {
      known.set(b.session.sourceId!, { size: b.session.sourceSize, mtime: b.session.sourceMtime });
    }
    const second = [];
    for await (const b of discover(ctx, known)) second.push(b);
    expect(second).toHaveLength(0);
  });

  test('never throws on a malformed fixture (diagnostics carried, no throw)', async () => {
    const bundles = [];
    await expect(
      (async () => {
        for await (const b of discover(ctxFor('malformed'), new Map())) bundles.push(b);
      })(),
    ).resolves.toBeUndefined();
    expect(bundles.length).toBeGreaterThan(0);
  });
});

describe('sourceExists', () => {
  test('returns true when the id is present in a successfully-read DB (keep)', async () => {
    const ctx = ctxFor('small');
    const present = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: join(
        FIXTURES_ROOT,
        'small',
        'home',
        '.local',
        'share',
        'opencode',
        'opencode.db',
      ),
    });
    expect(present).toBe(true);
  });

  test('returns false when the id is confirmed absent in a successfully-read DB (delete)', async () => {
    const ctx = ctxFor('small');
    const absent = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_missing',
      sourceLocator: join(
        FIXTURES_ROOT,
        'small',
        'home',
        '.local',
        'share',
        'opencode',
        'opencode.db',
      ),
    });
    expect(absent).toBe(false);
  });

  test('a present-but-unreadable directory locator (open throws) retains (returns true)', async () => {
    const ctx = ctxFor('small');
    // The data dir exists (stat succeeds) but is not a SQLite DB, so opening it
    // throws; sourceExists must return true so a transient error never deletes.
    const locator = join(FIXTURES_ROOT, 'small', 'home', '.local', 'share', 'opencode');
    const result = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: locator,
    });
    expect(result).toBe(true);
  });

  test('a present-but-unreadable file locator (open throws) retains (returns true)', async () => {
    const ctx = ctxFor('small');
    // A real file that exists but is not a SQLite DB (the fixture snapshot).
    const locator = join(FIXTURES_ROOT, 'small', 'expected.json');
    const result = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: locator,
    });
    expect(result).toBe(true);
  });

  test('a missing locator retains (returns true) until core can signal ENOENT', async () => {
    const ctx = ctxFor('small');
    // Adapter-only trade-off (M1): a deleted DB is retained, not deleted,
    // because `fs.stat === undefined` cannot distinguish "missing" from
    // "I/O error" under `createBunFs` (ARCHITECTURE §6 priority).
    const absent = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: '/does/not/exist/opencode.db',
    });
    expect(absent).toBe(true);
  });

  test('opaque stat (undefined) does not delete even when open throws non-ENOENT (returns true)', async () => {
    const base = ctxFor('small');
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        // The exact M1 shape: stat is opaque AND the read fails for another
        // reason. `undefined` must never be read as "confirmed absent".
        stat: async () => undefined,
        openSqliteReadonly: () => {
          throw new Error('EACCES: permission denied, open opencode.db');
        },
      },
    };
    const result = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: join(base.home, '.local', 'share', 'opencode', 'opencode.db'),
    });
    expect(result).toBe(true);
  });

  test('an explicit ENOENT open error still retains (returns true)', async () => {
    const base = ctxFor('small');
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        stat: async () => undefined,
        openSqliteReadonly: () => {
          throw new Error('ENOENT: no such file or directory, open opencode.db');
        },
      },
    };
    const result = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: join(base.home, '.local', 'share', 'opencode', 'opencode.db'),
    });
    expect(result).toBe(true);
  });
});
