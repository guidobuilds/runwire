import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { inventorySessions, retrieveSession, retrieveSessionParts } from './retrieve';
import { sessionDetailsSchema, sessionSummarySchema } from './types';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', '..', 'fixtures', 'opencode');

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

describe('inventorySessions', () => {
  test('streams a schema-valid SessionSummary for every session across both origins', async () => {
    const ctx = ctxFor('all');
    const summaries = [];
    for await (const s of inventorySessions(ctx)) summaries.push(s);
    const ids = summaries.map((s) => s.sourceId);
    expect(ids).toContain('opencode:current:ses_all_1');
    expect(ids).toContain('opencode:current:ses_all_child');
    expect(ids).toContain('opencode:legacy:ses_all_legacy');
    for (const s of summaries) {
      const r = sessionSummarySchema.safeParse(s);
      expect(r.success).toBe(true);
      expect('text' in s).toBe(false);
      expect('content' in s).toBe(false);
    }
  });

  test('includeLegacy:false omits the legacy store', async () => {
    const summaries = [];
    for await (const s of inventorySessions(ctxFor('all'), { includeLegacy: false }))
      summaries.push(s);
    expect(summaries.every((s) => s.dbOrigin === 'current')).toBe(true);
  });
});

describe('retrieveSession', () => {
  test('returns a schema-valid CORE SessionDetails (no content parts) for a session', async () => {
    const details = await retrieveSession(ctxFor('all'), 'opencode:current:ses_all_1');
    const r = sessionDetailsSchema.safeParse(details);
    expect(r.success).toBe(true);
    expect(details.harnessId).toBe('opencode');
    expect(details.dbOrigin).toBe('current');
    const json = JSON.stringify(details);
    expect(json.includes('RUNWIRE_CANARY_')).toBe(false);
    for (const step of details.steps) {
      expect('text' in step).toBe(false);
      expect('content' in step).toBe(false);
    }
  });

  test('retrieveSession throws a clear error for an unknown source', async () => {
    await expect(retrieveSession(ctxFor('all'), 'opencode:current:ses_nope')).rejects.toThrow(
      /not found|invalid/,
    );
  });
});

describe('retrieveSessionParts', () => {
  test('streams Step[] pages in seq order', async () => {
    const ctx = ctxFor('all');
    const pages: number[][] = [];
    for await (const page of retrieveSessionParts(ctx, 'opencode:current:ses_all_1', {
      pageSize: 2,
    })) {
      pages.push(page.map((s) => s.seq));
    }
    expect(pages.length).toBeGreaterThan(1);
    const flat = pages.flat();
    expect(flat).toEqual([...Array(flat.length).keys()]);
  });
});
