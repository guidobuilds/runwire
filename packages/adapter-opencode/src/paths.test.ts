import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, SqliteReader } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import {
  detectDbKind,
  opencodeDataDir,
  opencodeDbPath,
  parseIdFromSourceId,
  parseOriginFromSourceId,
  sourceIdFor,
  sourceLocatorFor,
} from './paths';

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

describe('paths', () => {
  test('opencodeDataDir / opencodeDbPath resolve under the home', () => {
    const ctx = ctxFor('small');
    const dataDir = opencodeDataDir(ctx);
    expect(dataDir).toContain(join('.local', 'share', 'opencode'));
    expect(opencodeDbPath(ctx, 'current')).toBe(join(dataDir, 'opencode.db'));
    expect(opencodeDbPath(ctx, 'legacy')).toBe(join(dataDir, 'opencode-tui-v2.db'));
  });

  test('sourceIdFor and sourceLocatorFor are origin-scoped', () => {
    const ctx = ctxFor('small');
    expect(sourceIdFor('current', 'ses_a')).toBe('opencode:current:ses_a');
    expect(sourceIdFor('legacy', 'ses_a')).toBe('opencode:legacy:ses_a');
    expect(sourceLocatorFor(ctx, 'current')).toBe(opencodeDbPath(ctx, 'current'));
  });

  test('parseOriginFromSourceId / parseIdFromSourceId round-trip', () => {
    expect(parseOriginFromSourceId('opencode:current:ses_x')).toBe('current');
    expect(parseOriginFromSourceId('opencode:legacy:ses_y')).toBe('legacy');
    expect(parseOriginFromSourceId('opencode:foo:ses_z')).toBeUndefined();
    expect(parseIdFromSourceId('opencode:current:ses_x')).toBe('ses_x');
    expect(parseIdFromSourceId('opencode:current:')).toBe('');
    expect(parseIdFromSourceId('not-opencode')).toBeUndefined();
  });

  test('detectDbKind detects session_v2 (current) vs session (legacy) vs not-opencode', async () => {
    expect(await detectDbKind(ctxFor('small'), 'current')).toBe('current');
    expect(await detectDbKind(ctxFor('legacy'), 'legacy')).toBe('legacy');
    expect(await detectDbKind(ctxFor('legacy'), 'current')).toBe('not-opencode');
    expect(await detectDbKind(ctxFor('small'), 'legacy')).toBe('not-opencode');
  });

  test('a present DB that cannot be opened is unreadable, not not-opencode', async () => {
    const base = ctxFor('small');
    const currentPath = opencodeDbPath(base, 'current');
    const ctx: AdapterContext = {
      ...base,
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
    expect(await detectDbKind(ctx, 'current')).toBe('unreadable');
    expect(await detectDbKind(ctx, 'legacy')).toBe('not-opencode');
  });

  test('a readable DB without OpenCode tables is not-opencode', async () => {
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
    expect(await detectDbKind(ctx, 'current')).toBe('not-opencode');
  });
});
