import { describe, expect, test } from 'bun:test';
import type { AdapterContext } from '../adapter/types';
import type { HarnessAdapter } from './adapter';
import { SessionSchema } from './schema';
import type { SourceRef } from './types';

function minimalSession(): Record<string, unknown> {
  return {
    id: 'opencode:current:ses_abc',
    harnessId: 'opencode',
    projectKey: 'proj',
    depth: 0,
    sourcePath: 'opencode:current:ses_abc',
    sourceSize: 10,
    sourceMtime: 1,
  };
}

describe('SessionSchema: sourceId/sourceLocator are optional and backward-compatible', () => {
  test('a Session with no sourceId/sourceLocator (e.g. Claude) still validates', () => {
    const r = SessionSchema.safeParse(minimalSession());
    expect(r.success).toBe(true);
  });

  test('a Session with explicit sourceId + sourceLocator validates', () => {
    const r = SessionSchema.safeParse({
      ...minimalSession(),
      sourceId: 'opencode:current:ses_abc',
      sourceLocator: '/home/u/.local/share/opencode/opencode.db',
    });
    expect(r.success).toBe(true);
  });

  test('a Session with a sourceId but no sourceLocator validates', () => {
    const r = SessionSchema.safeParse({ ...minimalSession(), sourceId: 'opencode:legacy:ses_x' });
    expect(r.success).toBe(true);
  });

  test('a stray unknown key is still rejected (the .strict() boundary is not weakened)', () => {
    const r = SessionSchema.safeParse({
      ...minimalSession(),
      sourceId: 'x',
      secretField: 'SECRET',
    });
    expect(r.success).toBe(false);
  });
});

describe('SourceRef and HarnessAdapter.sourceExists typecheck', () => {
  test('SourceRef is a { sourceId; sourceLocator? } shape', () => {
    const ref: SourceRef = { sourceId: 'opencode:current:ses_abc', sourceLocator: '/x/y.db' };
    expect(ref.sourceId).toBe('opencode:current:ses_abc');
    expect(ref.sourceLocator).toBe('/x/y.db');
    const bare: SourceRef = { sourceId: 'opencode:legacy:ses_x' };
    expect(bare.sourceLocator).toBeUndefined();
  });

  test('a HarnessAdapter may implement sourceExists(ctx, source)', async () => {
    const ctx = {} as AdapterContext;
    const adapter: HarnessAdapter = {
      id: 'opencode',
      displayName: 'OpenCode',
      adapterVersion: '1.0.0',
      capabilities: [],
      allowlist: {},
      probe: async () => ({ installed: true, roots: [], notes: [] }),
      discover: async function* () {},
      async sourceExists(_ctx: AdapterContext, source: SourceRef): Promise<boolean> {
        return source.sourceId === 'opencode:current:ses_abc';
      },
    };
    const maybeExists = adapter.sourceExists;
    expect(maybeExists).toBeTypeOf('function');
    if (maybeExists) {
      expect(await maybeExists(ctx, { sourceId: 'opencode:current:ses_abc' })).toBe(true);
      expect(await maybeExists(ctx, { sourceId: 'opencode:current:ses_missing' })).toBe(false);
    }
  });
});
