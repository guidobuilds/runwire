import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterContext, AdapterReport, ImportReport } from '@scout/core';
import { createBunFs, importAll, openStore } from '@scout/core';
import { retrieveSession } from './connector/retrieve';
import { createOpencodeAdapter } from './index';

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

function reportFor(result: ImportReport, id: string): AdapterReport {
  const report = result.perAdapter[id];
  if (!report) throw new Error(`no report for adapter "${id}"`);
  return report;
}

describe('current + legacy both inventoried', () => {
  test('all fixture yields both origins with no id collision', async () => {
    const adapter = createOpencodeAdapter();
    const ids: string[] = [];
    for await (const b of adapter.discover(ctxFor('all'), new Map())) ids.push(b.session.id);
    expect(ids.some((id) => id.startsWith('opencode:current:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('opencode:legacy:'))).toBe(true);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe('two-run import regression (the known-skip deletion bug)', () => {
  test('second run preserves the session count and removes nothing', async () => {
    const ctx = ctxFor('small');
    const adapter = createOpencodeAdapter();
    const { db } = openStore(':memory:');

    const first = await importAll({ adapters: [adapter], db, ctx });
    expect(reportFor(first, 'opencode').imported).toBe(1);
    expect(reportFor(first, 'opencode').removed).toBe(0);

    const second = await importAll({ adapters: [adapter], db, ctx });
    // The unchanged live session is skipped by discover, but sourceExists finds
    // it in the DB, so removed: 0. This is the regression that would have
    // deleted every live-but-unchanged session on the second import.
    expect(reportFor(second, 'opencode').discovered).toBe(0);
    expect(reportFor(second, 'opencode').removed).toBe(0);
    expect(reportFor(second, 'opencode').skipped).toBe(1);
    expect(db.query('SELECT COUNT(*) AS c FROM sessions').get()).toEqual({ c: 1 });
  });
});

describe('connector is CORE-representable (no content parts)', () => {
  test('retrieveSession returns project + session + steps + diagnostics with no content', async () => {
    const details = await retrieveSession(ctxFor('all'), 'opencode:current:ses_all_1');
    expect(details.project).toBeDefined();
    expect(details.session.id).toBe('opencode:current:ses_all_1');
    expect(details.steps.length).toBeGreaterThan(0);
    const json = JSON.stringify(details);
    expect(json.includes('SCOUT_CANARY_')).toBe(false);
    for (const step of details.steps) {
      expect('text' in step).toBe(false);
      expect('content' in step).toBe(false);
    }
  });
});

describe('confirmed-absent origin DB file removes that origin sessions', () => {
  test('a full import, then the current DB file disappears (legacy remains), removes only the current-origin sessions', async () => {
    // Build a scratch home with the all-fixture layout (current + legacy DBs).
    const srcHome = join(FIXTURES_ROOT, 'all', 'home', '.local', 'share', 'opencode');
    const scratch = mkdtempSync(join(tmpdir(), 'oc-absent-'));
    const scratchHome = join(scratch, '.local', 'share', 'opencode');
    cpSync(srcHome, scratchHome, { recursive: true });

    const adapter = createOpencodeAdapter();
    const ctx: AdapterContext = {
      home: scratch,
      platform: 'darwin',
      env: {},
      fs: createBunFs(),
      privacy: { titles: true },
      log: { info() {}, warn() {}, error() {} },
    };

    const { db, close } = openStore(':memory:');
    try {
      const first = await importAll({ adapters: [adapter], db, ctx });
      expect(reportFor(first, 'opencode').imported).toBe(3);

      // Confirm-absent the current DB file (remove opencode.db, keep the legacy
      // store) so probe stays installed.
      rmSync(join(scratchHome, 'opencode.db'));

      const second = await importAll({ adapters: [adapter], db, ctx });
      // current-origin sessions are removed (confirmed absent), legacy retained.
      expect(reportFor(second, 'opencode').removed).toBe(2);
      const remaining = db.query('SELECT id FROM sessions ORDER BY id').all() as { id: string }[];
      const ids = remaining.map((r) => r.id);
      expect(ids).toEqual(['opencode:legacy:ses_all_legacy']);
    } finally {
      close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
