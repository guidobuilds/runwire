import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, SessionBundle, SqliteReader } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { discover, probe, sourceExists } from './discover';
import { opencodeDbPath } from './paths';

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

  test('a session whose computeBundle throws yields a source-read-failed stub and the rest still stream', async () => {
    const base = ctxFor('all');
    let readFileCalls = 0;
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        readFile: async (path: string) => {
          readFileCalls++;
          if (readFileCalls === 1) throw new Error('boom: fold failed');
          return base.fs.readFile(path);
        },
      },
    };

    const bundles = [];
    for await (const b of discover(ctx, new Map())) bundles.push(b);

    const failed = bundles.find((b) => b.session.id === 'opencode:current:ses_all_1');
    expect(failed).toBeDefined();
    expect(failed?.diagnostics.map((d) => d.code)).toContain('source-read-failed');
    expect(failed?.diagnostics[0]?.message).toBe('boom: fold failed');
    expect(failed?.steps).toEqual([]);

    expect(bundles.some((b) => b.session.id === 'opencode:current:ses_all_child')).toBe(true);
    expect(bundles.some((b) => b.session.id === 'opencode:legacy:ses_all_legacy')).toBe(true);
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

  test('throws the fixed error when a present origin DB cannot be opened', async () => {
    const base = ctxFor('small');
    const currentPath = opencodeDbPath(base, 'current');
    const logs: string[] = [];
    const ctx: AdapterContext = {
      ...base,
      log: { info() {}, warn() {}, error: (message: string) => logs.push(message) },
      fs: {
        ...base.fs,
        stat: async (path: string) =>
          path === currentPath
            ? { sizeBytes: 8, mtimeMs: 0, isDirectory: false }
            : base.fs.stat(path),
        openSqliteReadonly: (path: string) => {
          if (path === currentPath) throw new Error('SQLITE_NOTADB: file is not a database');
          return base.fs.openSqliteReadonly(path);
        },
      },
    };
    const bundles: SessionBundle[] = [];
    let caught: unknown;
    try {
      for await (const b of discover(ctx, new Map())) bundles.push(b);
    } catch (e) {
      caught = e;
    }
    expect(bundles).toHaveLength(0);
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { code?: string };
    expect(err.message).toBe('opencode current source-read-failed');
    expect(err.code).toBe('source-read-failed');
    expect(logs).toEqual(['opencode: origin current read failed (source-read-failed)']);
    expect(logs.join('\n')).not.toContain('SQLITE_NOTADB');
  });

  test('a fatal legacy origin throws mid-stream after the current bundles', async () => {
    const base = ctxFor('small');
    const legacyPath = opencodeDbPath(base, 'legacy');
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path: string) =>
          path === legacyPath
            ? { sizeBytes: 8, mtimeMs: 0, isDirectory: false }
            : base.fs.stat(path),
        openSqliteReadonly: (path: string) => {
          if (path === legacyPath) throw new Error('SQLITE_NOTADB: file is not a database');
          return base.fs.openSqliteReadonly(path);
        },
      },
    };
    const bundles: SessionBundle[] = [];
    let caught: unknown;
    try {
      for await (const b of discover(ctx, new Map())) bundles.push(b);
    } catch (e) {
      caught = e;
    }
    expect(bundles.map((b) => b.session.id)).toContain('opencode:current:ses_small');
    const err = caught as Error & { code?: string };
    expect(err.message).toBe('opencode legacy source-read-failed');
    expect(err.code).toBe('source-read-failed');
  });

  test('a read failure after successful detection rejects with the fixed error', async () => {
    const base = ctxFor('small');
    const currentPath = opencodeDbPath(base, 'current');
    let opens = 0;
    const detectReader: SqliteReader = {
      all<T = Record<string, unknown>>(): T[] {
        return [{ name: 'session_v2' }] as T[];
      },
      close() {},
    };
    const brokenReader: SqliteReader = {
      all<T = Record<string, unknown>>(): T[] {
        throw new Error('SQLITE_CORRUPT: database disk image is malformed');
      },
      close() {},
    };
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path: string) =>
          path === currentPath
            ? { sizeBytes: 8, mtimeMs: 0, isDirectory: false }
            : base.fs.stat(path),
        openSqliteReadonly: () => {
          opens++;
          return opens === 1 ? detectReader : brokenReader;
        },
      },
    };
    const bundles: SessionBundle[] = [];
    let caught: unknown;
    try {
      for await (const b of discover(ctx, new Map())) bundles.push(b);
    } catch (e) {
      caught = e;
    }
    expect(bundles).toHaveLength(0);
    const err = caught as Error & { code?: string };
    expect(err.message).toBe('opencode current source-read-failed');
    expect(err.code).toBe('source-read-failed');
  });

  test('a healthy empty origin yields no bundles and does not throw', async () => {
    const base = ctxFor('small');
    const empty: AdapterContext = { ...base, home: '/does/not/exist' };
    const bundles: SessionBundle[] = [];
    await expect(
      (async () => {
        for await (const b of discover(empty, new Map())) bundles.push(b);
      })(),
    ).resolves.toBeUndefined();
    expect(bundles).toHaveLength(0);
  });

  test('a readable DB without OpenCode tables is healthy-empty (no throw)', async () => {
    const base = ctxFor('small');
    const currentPath = opencodeDbPath(base, 'current');
    const reader: SqliteReader = {
      all<T = Record<string, unknown>>(): T[] {
        return [{ name: 'other' }] as T[];
      },
      close() {},
    };
    const ctx: AdapterContext = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path: string) =>
          path === currentPath
            ? { sizeBytes: 8, mtimeMs: 0, isDirectory: false }
            : base.fs.stat(path),
        openSqliteReadonly: () => reader,
      },
    };
    const bundles: SessionBundle[] = [];
    for await (const b of discover(ctx, new Map())) bundles.push(b);
    expect(bundles).toHaveLength(0);
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
    const locator = join(FIXTURES_ROOT, 'small', 'home', '.local', 'share', 'opencode');
    const result = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: locator,
    });
    expect(result).toBe(true);
  });

  test('a present-but-unreadable file locator (open throws) retains (returns true)', async () => {
    const ctx = ctxFor('small');
    const locator = join(FIXTURES_ROOT, 'small', 'expected.json');
    const result = await sourceExists(ctx, {
      sourceId: 'opencode:current:ses_small',
      sourceLocator: locator,
    });
    expect(result).toBe(true);
  });

  test('a missing locator retains (returns true) until core can signal ENOENT', async () => {
    const ctx = ctxFor('small');
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
