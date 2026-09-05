import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext } from '@scout/core';
import { createBunFs } from '@scout/core';
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
    expect(dataDir).toContain('.local/share/opencode');
    expect(opencodeDbPath(ctx, 'current')).toBe(`${dataDir}/opencode.db`);
    expect(opencodeDbPath(ctx, 'legacy')).toBe(`${dataDir}/opencode-tui-v2.db`);
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
    // A missing DB file is not-opencode, never a throw.
    expect(await detectDbKind(ctxFor('legacy'), 'current')).toBe('not-opencode');
    expect(await detectDbKind(ctxFor('small'), 'legacy')).toBe('not-opencode');
  });
});
