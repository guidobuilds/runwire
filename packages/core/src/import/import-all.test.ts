import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { AdapterContext } from '../adapter/types';
import type { HarnessAdapter } from '../contract/adapter';
import type { SourceRef } from '../contract/types';
import { openStore } from '../store/store';
import { createFakeAdapter } from '../test-kit/fake-adapter';
import type { AdapterReport, ImportReport } from './import-all';
import { importAll } from './import-all';

/**
 * A minimal OpenCode-like adapter: sessions carry an explicit `sourceId`
 * (`opencode:current:<id>`), a shared `sourceLocator` (the DB file path), and
 * `sourcePath = sourceId`. `discover` skips a source when `known` has its
 * sourceId at the same {size,mtime} — mirroring how a real DB-backed adapter
 * avoids re-emitting an unchanged session. `sourceExists` is injected so a
 * test can simulate a confirmed-absent source.
 */
function opencodeLikeAdapter(opts: {
  ids: string[];
  sourceExists?: (source: SourceRef) => Promise<boolean>;
}): HarnessAdapter {
  const ids = new Set(opts.ids);
  return {
    id: 'opencode',
    displayName: 'OpenCode',
    adapterVersion: '1.0.0',
    capabilities: [],
    allowlist: {},
    probe: async () => ({ installed: true, roots: ['/data'], notes: [] }),
    async *discover(_ctx, known) {
      for (const sid of [...ids].sort()) {
        const k = known.get(sid);
        if (k !== undefined && k.size === 1 && k.mtime === 1) continue;
        yield {
          project: { key: 'k', name: 'k', identity: 'cwd' },
          session: {
            id: sid,
            harnessId: 'opencode',
            projectKey: 'k',
            depth: 0,
            sourceId: sid,
            sourceLocator: '/data/opencode.db',
            sourcePath: sid,
            sourceSize: 1,
            sourceMtime: 1,
          },
          steps: [],
          diagnostics: [],
        };
      }
    },
    async sourceExists(_ctx, source) {
      return opts.sourceExists ? opts.sourceExists(source) : true;
    },
  };
}

function opencodeCtx(): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

function reportFor(result: ImportReport, id: string): AdapterReport {
  const report = result.perAdapter[id];
  if (!report) throw new Error(`no report for adapter "${id}"`);
  return report;
}

const BASE_PATHS = [
  '/fake/root.jsonl',
  '/fake/child1.jsonl',
  '/fake/child2.jsonl',
  '/fake/child3.jsonl',
  '/fake/child4.jsonl',
  '/fake/grandchild.jsonl',
  '/fake/orphan.jsonl',
  '/fake/diagnosed.jsonl',
  '/fake/titled.jsonl',
];

function ctxWithFiles(paths: string[]): AdapterContext {
  const files: Record<string, string> = {};
  for (const p of paths) files[p] = 'x';
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs({ files }),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

function sessionIds(db: Database): string[] {
  return (db.query('SELECT id FROM sessions ORDER BY id').all() as { id: string }[]).map(
    (r) => r.id,
  );
}

describe('importAll', () => {
  test('persists every base fake scenario and returns a shaped ImportReport', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    const report = await importAll({ adapters: [adapter], db, ctx: ctxWithFiles(BASE_PATHS) });

    expect(report.perAdapter.fake).toEqual({
      discovered: 9,
      imported: 9,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    expect(typeof report.durationMs).toBe('number');
    expect(sessionIds(db)).toEqual(
      [
        'fake:child1',
        'fake:child2',
        'fake:child3',
        'fake:child4',
        'fake:diagnosed',
        'fake:grandchild',
        'fake:orphan',
        'fake:root',
        'fake:titled',
      ].sort(),
    );
  });

  test('linkSessions runs afterward: child_id is filled and the orphan is nulled with a diagnostic', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    await importAll({ adapters: [adapter], db, ctx: ctxWithFiles(BASE_PATHS) });

    const rootChildStep = db
      .query("SELECT child_id FROM steps WHERE session_id = 'fake:root' AND call_id = 'c1'")
      .get() as { child_id: string | null };
    expect(rootChildStep.child_id).toBe('fake:child1');

    const collisionStep = db
      .query("SELECT child_id FROM steps WHERE session_id = 'fake:root' AND call_id = 'c2'")
      .get() as { child_id: string | null };
    expect(collisionStep.child_id).toBe('fake:child3');

    const orphan = db.query("SELECT parent_id FROM sessions WHERE id = 'fake:orphan'").get() as {
      parent_id: string | null;
    };
    expect(orphan.parent_id).toBeNull();
    const diag = db
      .query("SELECT code FROM diagnostics WHERE session_id = 'fake:orphan'")
      .all() as { code: string }[];
    expect(diag.map((d) => d.code)).toContain('orphan-child');
  });

  test('recomputeRollups runs afterward: the root has a rollups row', async () => {
    const { db } = openStore(':memory:');
    await importAll({ adapters: [createFakeAdapter()], db, ctx: ctxWithFiles(BASE_PATHS) });
    const row = db.query("SELECT descendants FROM rollups WHERE session_id = 'fake:root'").get();
    expect(row).not.toBeNull();
  });

  test('second run with unchanged known sizes/mtimes imports nothing and reports skipped', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [adapter], db, ctx });

    const second = await importAll({ adapters: [adapter], db, ctx });
    expect(second.perAdapter.fake).toEqual({
      discovered: 0,
      imported: 0,
      skipped: 9,
      removed: 0,
      failed: 0,
    });
  });

  test('force reimports unchanged sources instead of passing the size/mtime cache to discovery', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [adapter], db, ctx });

    const forced = await importAll({ adapters: [adapter], db, ctx, force: true });

    expect(forced.perAdapter.fake).toEqual({
      discovered: 9,
      imported: 9,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
  });

  test('a source removed from the fs is deleted with its child rows on the next run', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    await importAll({ adapters: [adapter], db, ctx: ctxWithFiles(BASE_PATHS) });
    expect(sessionIds(db)).toContain('fake:titled');

    const withoutTitled = ctxWithFiles(BASE_PATHS.filter((p) => p !== '/fake/titled.jsonl'));
    const second = await importAll({ adapters: [adapter], db, ctx: withoutTitled });

    expect(reportFor(second, 'fake').removed).toBe(1);
    expect(sessionIds(db)).not.toContain('fake:titled');
    expect(db.query("SELECT * FROM steps WHERE session_id = 'fake:titled'").all().length).toBe(0);
  });

  test('a row under another root survives a run scoped to /fake', async () => {
    const { db } = openStore(':memory:');
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES ('fake:other', 'fake', NULL, 0, '/other/keep.jsonl', 1, 1)`,
    );

    const adapter = createFakeAdapter();
    await importAll({ adapters: [adapter], db, ctx: ctxWithFiles(BASE_PATHS) });

    expect(sessionIds(db)).toContain('fake:other');
  });

  test('fake:invalid is persisted as a stub and re-emitted (not skipped) on the next run', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter({ includeInvalid: true });
    const paths = [...BASE_PATHS, '/fake/invalid.jsonl'];
    const ctx = ctxWithFiles(paths);

    const first = await importAll({ adapters: [adapter], db, ctx });
    expect(reportFor(first, 'fake').failed).toBe(1);
    expect(reportFor(first, 'fake').imported).toBe(9);

    const stub = db
      .query("SELECT project_key, source_size FROM sessions WHERE id = 'fake:invalid'")
      .get() as {
      project_key: string | null;
      source_size: number | null;
    };
    expect(stub.project_key).toBeNull();
    expect(stub.source_size).toBeNull();

    const second = await importAll({ adapters: [adapter], db, ctx });
    // Only fake:invalid is re-emitted: its stub row has NULL size/mtime, which
    // never matches known (plan P5), while the 9 valid scenarios are skipped.
    expect(reportFor(second, 'fake').discovered).toBe(1);
    expect(reportFor(second, 'fake').failed).toBe(1);
    // Nothing valid was re-imported (unchanged known sizes); only the invalid stub was re-parsed.
    expect(reportFor(second, 'fake').imported).toBe(0);
    expect(reportFor(second, 'fake').skipped).toBe(9);
  });

  test('probe.installed=false removes nothing and reports a zero report with notes', async () => {
    const { db } = openStore(':memory:');
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES ('fake:existing', 'fake', NULL, 0, '/fake/existing.jsonl', 1, 1)`,
    );

    const adapter = createFakeAdapter({ installed: false });
    const report = await importAll({ adapters: [adapter], db, ctx: ctxWithFiles([]) });

    expect(report.perAdapter.fake).toEqual({
      discovered: 0,
      imported: 0,
      skipped: 0,
      removed: 0,
      failed: 0,
      notes: [],
    });
    expect(sessionIds(db)).toContain('fake:existing');
  });

  test('two-run OpenCode regression: unchanged live sessions are never deleted (removed: 0)', async () => {
    const { db } = openStore(':memory:');
    const adapter = opencodeLikeAdapter({
      ids: ['opencode:current:ses_a', 'opencode:current:ses_b'],
    });
    const ctx = opencodeCtx();

    const first = await importAll({ adapters: [adapter], db, ctx });
    expect(reportFor(first, 'opencode')).toEqual({
      discovered: 2,
      imported: 2,
      skipped: 0,
      removed: 0,
      failed: 0,
    });

    const second = await importAll({ adapters: [adapter], db, ctx });
    // Both sessions are unchanged (known), so discover skips them; sourceExists
    // returns true (they still exist), so removed: 0. This is the regression that
    // would have caught the known-skip deletion bug.
    expect(reportFor(second, 'opencode')).toEqual({
      discovered: 0,
      imported: 0,
      skipped: 2,
      removed: 0,
      failed: 0,
    });
    const count = db.query('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    expect(count.c).toBe(2);
  });

  test('sourceExists returning false deletes a known-but-unemitted source (confirmed absent)', async () => {
    const { db } = openStore(':memory:');
    const ctx = opencodeCtx();

    const present = opencodeLikeAdapter({
      ids: ['opencode:current:ses_a', 'opencode:current:ses_gone'],
    });
    const first = await importAll({ adapters: [present], db, ctx });
    expect(reportFor(first, 'opencode').imported).toBe(2);

    const afterGone = opencodeLikeAdapter({
      ids: ['opencode:current:ses_a'],
      sourceExists: async (source) => source.sourceId !== 'opencode:current:ses_gone',
    });
    const second = await importAll({ adapters: [afterGone], db, ctx });
    expect(reportFor(second, 'opencode').removed).toBe(1);
    expect(
      db.query("SELECT * FROM sessions WHERE id = 'opencode:current:ses_gone'").all().length,
    ).toBe(0);
    // ses_a survives (sourceExists true), so it is counted as skipped.
    expect(reportFor(second, 'opencode').skipped).toBe(1);
  });

  test('an adapter whose discover() throws mid-stream keeps what was already persisted and sets error', async () => {
    const { db } = openStore(':memory:');
    const inner = createFakeAdapter();
    const throwingAdapter = {
      ...inner,
      async *discover(ctx: AdapterContext, known: Parameters<typeof inner.discover>[1]) {
        let i = 0;
        for await (const bundle of inner.discover(ctx, known)) {
          if (i === 2) throw new Error('boom mid-stream');
          i++;
          yield bundle;
        }
      },
    };

    const report = await importAll({
      adapters: [throwingAdapter],
      db,
      ctx: ctxWithFiles(BASE_PATHS),
    });

    const fakeReport = reportFor(report, 'fake');
    expect(fakeReport.error).toBe('boom mid-stream');
    expect(fakeReport.discovered).toBe(2);
    expect(fakeReport.imported).toBe(2);
    // The pseudocode's catch skips the removed/skipped calculation entirely on a throw.
    expect(fakeReport.removed).toBe(0);
    expect(fakeReport.skipped).toBe(0);
    // What was persisted before the throw stays - not rolled back.
    expect(sessionIds(db).length).toBe(2);
  });
});
