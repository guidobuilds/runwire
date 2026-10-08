import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { AdapterContext } from '../adapter/types';
import type { HarnessAdapter } from '../contract/adapter';
import type { Diagnostic, SessionBundle, SourceRef } from '../contract/types';
import { readImportedVersion } from '../store/persist';
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

/** An adapter `discover` that fails before emitting a record. A plain async
 * iterator (rather than a generator) keeps the rejection in the iterator
 * protocol without needing an unreachable `yield`. */
function throwingDiscover(reason: unknown): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return { next: (): Promise<IteratorResult<never>> => Promise.reject(reason) };
    },
  };
}

/**
 * A one-source adapter for the D82 refresh tests: it emits a single tool step
 * whose MCP identity can be toggled per "mapping version", so a version bump
 * can prove a previously NULL column is backfilled even though the source's
 * size/mtime are unchanged. `known` is honoured like a real adapter so an
 * explicit `--force`/refresh bypass is observable.
 */
function refreshAdapter(
  adapterVersion: string,
  opts: { identity: boolean; diagnostics?: Diagnostic[]; size?: number; mtime?: number },
): HarnessAdapter {
  const path = '/fake/refresh.jsonl';
  const size = opts.size ?? 10;
  const mtime = opts.mtime ?? 1;
  return {
    id: 'fake',
    displayName: 'Fake',
    adapterVersion,
    capabilities: [],
    allowlist: {},
    probe: async () => ({ installed: true, roots: ['/fake'], notes: [] }),
    async *discover(_ctx, known) {
      const k = known.get(path);
      if (k !== undefined && k.size === size && k.mtime === mtime) return;
      yield {
        project: { key: 'k', name: 'k', identity: 'cwd' },
        session: {
          id: 'fake:refresh',
          harnessId: 'fake',
          projectKey: 'k',
          depth: 0,
          sourcePath: path,
          sourceSize: size,
          sourceMtime: mtime,
        },
        steps: [
          {
            sessionId: 'fake:refresh',
            seq: 0,
            kind: 'tool',
            toolCategory: 'mcp',
            toolName: 'mcp__srv__tool',
            ...(opts.identity ? { mcpServer: 'srv', mcpTool: 'tool' } : {}),
          },
        ],
        diagnostics: opts.diagnostics ?? [],
      };
    },
  };
}

/** A fake adapter with a different `adapterVersion` (simulates a mapping bump). */
function withVersion(adapter: HarnessAdapter, adapterVersion: string): HarnessAdapter {
  return { ...adapter, adapterVersion };
}

function fakeImportMeta(db: Database): {
  adapter_version: string;
  imported_version: string | null;
} {
  return db
    .query('SELECT adapter_version, imported_version FROM harnesses WHERE id = ?')
    .get('fake') as { adapter_version: string; imported_version: string | null };
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

  test('titles:true persists session titles end to end (D7 opt-in)', async () => {
    const { db } = openStore(':memory:');
    await importAll({ adapters: [createFakeAdapter()], db, ctx: ctxWithFiles(BASE_PATHS) });

    const titled = db.query("SELECT title FROM sessions WHERE id = 'fake:titled'").get() as {
      title: string | null;
    };
    expect(titled.title).toBe('A fake session title');
  });

  test('titles:false nulls titles at persist even when the adapter emits one (D7)', async () => {
    const { db } = openStore(':memory:');
    const inner = createFakeAdapter();
    // An adapter bug: it ignores ctx.privacy.titles and always emits titles.
    // persist must still refuse to write them when the caller opted out.
    const leaky = {
      ...inner,
      async *discover(ctx: AdapterContext, known: Parameters<typeof inner.discover>[1]) {
        for await (const bundle of inner.discover({ ...ctx, privacy: { titles: true } }, known)) {
          yield bundle;
        }
      },
    };
    const ctx: AdapterContext = { ...ctxWithFiles(BASE_PATHS), privacy: { titles: false } };
    const report = await importAll({ adapters: [leaky], db, ctx });
    expect(reportFor(report, 'fake').imported).toBe(9);

    const rows = db.query('SELECT id, title FROM sessions').all() as {
      id: string;
      title: string | null;
    }[];
    expect(rows.length).toBe(9);
    for (const row of rows) expect(row.title).toBeNull();
  });

  test('titles:false ignores the size/mtime cache: a stored title is nulled without force (D7/D71)', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    await importAll({ adapters: [adapter], db, ctx: ctxWithFiles(BASE_PATHS) });

    const titled = db.query("SELECT title FROM sessions WHERE id = 'fake:titled'").get() as {
      title: string | null;
    };
    expect(titled.title).toBe('A fake session title');

    // No `force`: the opt-out alone must reach every source, because the cache
    // would otherwise skip a source and leave its stored title untouched.
    const noTitles: AdapterContext = { ...ctxWithFiles(BASE_PATHS), privacy: { titles: false } };
    const second = await importAll({ adapters: [adapter], db, ctx: noTitles });

    expect(reportFor(second, 'fake')).toEqual({
      discovered: 9,
      imported: 9,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    const rows = db.query('SELECT id, title FROM sessions').all() as {
      id: string;
      title: string | null;
    }[];
    expect(rows.length).toBe(9);
    for (const row of rows) expect(row.title).toBeNull();
    // Every known source was re-emitted, so none was treated as vanished.
    expect(sessionIds(db).length).toBe(9);
  });

  test('titles:true keeps the size/mtime cache: an unchanged rerun is skipped and the title survives', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [adapter], db, ctx });

    const second = await importAll({ adapters: [adapter], db, ctx });

    // Regression guard for the titles:false bypass above: the opt-in path must
    // not lose the cache.
    expect(reportFor(second, 'fake')).toEqual({
      discovered: 0,
      imported: 0,
      skipped: 9,
      removed: 0,
      failed: 0,
    });
    const titled = db.query("SELECT title FROM sessions WHERE id = 'fake:titled'").get() as {
      title: string | null;
    };
    expect(titled.title).toBe('A fake session title');
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

  test('a stub row with NULL size/mtime is re-emitted while unchanged valid sources are skipped', async () => {
    const { db } = openStore(':memory:');
    // A completed marker at the running version plus a persisted invalid stub
    // (NULL size/mtime) simulate a store after a previously successful run.
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities, imported_version) VALUES ('fake', 'Fake', '1.0.0', '[]', '1.0.0')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_id, source_locator, source_path, source_size, source_mtime)
       VALUES ('fake:invalid', 'fake', NULL, 0, '/fake/invalid.jsonl', '/fake/invalid.jsonl', '/fake/invalid.jsonl', NULL, NULL)`,
    );
    const adapter = createFakeAdapter({ includeInvalid: true, scenarios: ['invalid'] });
    const ctx = ctxWithFiles([...BASE_PATHS, '/fake/invalid.jsonl']);

    const report = await importAll({ adapters: [adapter], db, ctx });

    // The stub's NULL size/mtime never matches known (plan P5), so it is
    // re-parsed and fails validation again; no valid source is touched.
    expect(reportFor(report, 'fake').discovered).toBe(1);
    expect(reportFor(report, 'fake').failed).toBe(1);
    expect(reportFor(report, 'fake').imported).toBe(0);
    // The failed re-run does not retain apparent success.
    expect(readImportedVersion(db, 'fake')).toBeNull();
  });

  test('a source that goes valid -> invalid is cleared to a stub and stops inflating its parent rollup', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles([...BASE_PATHS, '/fake/invalid.jsonl']);

    // Run 1: the same id/sourcePath the fake invalid scenario uses, but valid
    // and bearing a title/parent/tokens. A distinct size/mtime keeps run 2's
    // invalid scenario (200/1000) out of the size/mtime cache.
    const base = createFakeAdapter();
    const validInvalid: SessionBundle = {
      project: { key: 'k', name: 'k', identity: 'cwd' },
      session: {
        id: 'fake:invalid',
        harnessId: 'fake',
        projectKey: 'k',
        parentId: 'fake:root',
        relation: 'subagent',
        depth: 1,
        spawnCallId: 'c1',
        title: 'A valid invalid title',
        apiCalls: 2,
        output: 5,
        sourcePath: '/fake/invalid.jsonl',
        sourceSize: 999,
        sourceMtime: 9999,
      },
      steps: [{ sessionId: 'fake:invalid', seq: 0, kind: 'call', output: 5 }],
      diagnostics: [],
    };
    const withValidInvalid = {
      ...base,
      async *discover(ctx2: AdapterContext, known: Parameters<typeof base.discover>[1]) {
        yield* base.discover(ctx2, known);
        yield validInvalid;
      },
    };

    const first = await importAll({ adapters: [withValidInvalid], db, ctx });
    expect(reportFor(first, 'fake').imported).toBe(10);
    const valid = db
      .query("SELECT title, parent_id, output FROM sessions WHERE id = 'fake:invalid'")
      .get() as { title: string | null; parent_id: string | null; output: number | null };
    expect(valid).toEqual({ title: 'A valid invalid title', parent_id: 'fake:root', output: 5 });

    const rootOutput = (): number | null =>
      (
        db.query('SELECT output FROM rollups WHERE session_id = ?').get('fake:root') as {
          output: number | null;
        }
      ).output;
    const beforeRoot = rootOutput();

    // Run 2: only the invalid scenario; it fails validation and clears the row.
    const second = await importAll({
      adapters: [createFakeAdapter({ includeInvalid: true, scenarios: ['invalid'] })],
      db,
      ctx,
    });
    expect(reportFor(second, 'fake').failed).toBe(1);
    expect(reportFor(second, 'fake').imported).toBe(0);

    const stub = db
      .query("SELECT title, parent_id, output, source_size FROM sessions WHERE id = 'fake:invalid'")
      .get() as {
      title: string | null;
      parent_id: string | null;
      output: number | null;
      source_size: number | null;
    };
    expect(stub).toEqual({ title: null, parent_id: null, output: null, source_size: null });

    // The stale exclusive total is gone from the parent's inclusive rollup.
    expect(rootOutput()).toBe((beforeRoot as number) - 5);
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
    expect(fakeReport.error).toBe('fake: Error');
    expect(fakeReport.discovered).toBe(2);
    expect(fakeReport.imported).toBe(2);
    // The pseudocode's catch skips the removed/skipped calculation entirely on a throw.
    expect(fakeReport.removed).toBe(0);
    expect(fakeReport.skipped).toBe(0);
    // What was persisted before the throw stays - not rolled back.
    expect(sessionIds(db).length).toBe(2);
  });

  test('a throwing adapter never logs record text: the error is code-like, one-line and bounded', async () => {
    const { db } = openStore(':memory:');
    const inner = createFakeAdapter();
    const canary = 'RUNWIRE_CANARY_SECRET_RECORD';
    const recordLikeMessage = `failed to parse record {"prompt":"${canary}"}\nsecond line\r\nthird line`;
    const throwingAdapter = {
      ...inner,
      discover: () => throwingDiscover(new Error(recordLikeMessage)),
    };
    const logged: string[] = [];
    const ctx: AdapterContext = {
      ...ctxWithFiles([...BASE_PATHS]),
      log: {
        info() {},
        warn() {},
        error(message: string) {
          logged.push(message);
        },
      },
    };

    const report = await importAll({ adapters: [throwingAdapter], db, ctx });
    const fakeReport = reportFor(report, 'fake');

    expect(logged).toHaveLength(1);
    const line = logged[0] as string;
    // The raw record fragment reaches neither sink (docs/ARCHITECTURE.md §7).
    expect(line).not.toContain(canary);
    expect(line).not.toContain('failed to parse record');
    expect(fakeReport.error).not.toContain(canary);
    expect(fakeReport.error).not.toContain('failed to parse record');
    // No newlines: a raw multi-line dump cannot be reconstructed.
    expect(line).not.toMatch(/[\r\n]/);
    expect(fakeReport.error).not.toMatch(/[\r\n]/);
    // Short, code-like (adapter id + error name) and bounded.
    expect(line.length).toBeLessThanOrEqual(200);
    expect((fakeReport.error as string).length).toBeLessThanOrEqual(200);
    expect(line).toContain('fake');
    expect(line).toContain('Error');
    expect(fakeReport.error).toBe('fake: Error');
  });

  test('a non-Error throw is reported by type, never by its stringified payload', async () => {
    const { db } = openStore(':memory:');
    const inner = createFakeAdapter();
    const throwingAdapter = {
      ...inner,
      discover: () => throwingDiscover(`record leak\n${'x'.repeat(500)}`),
    };
    const logged: string[] = [];
    const ctx: AdapterContext = {
      ...ctxWithFiles([...BASE_PATHS]),
      log: {
        info() {},
        warn() {},
        error(message: string) {
          logged.push(message);
        },
      },
    };

    const report = await importAll({ adapters: [throwingAdapter], db, ctx });
    const fakeReport = reportFor(report, 'fake');

    expect(fakeReport.error).toBe('fake: string');
    expect(logged[0]).toContain('(string)');
    expect(logged[0] as string).not.toMatch(/[\r\n]/);
    expect(logged[0] as string).not.toContain('record leak');
  });
});

describe('importAll: automatic version refresh and completion marker (D82)', () => {
  test('a completed same-version rerun keeps the size/mtime cache and the marker', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [adapter], db, ctx });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');

    const second = await importAll({ adapters: [adapter], db, ctx });

    expect(reportFor(second, 'fake')).toEqual({
      discovered: 0,
      imported: 0,
      skipped: 9,
      removed: 0,
      failed: 0,
    });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
  });

  test('a mapping-version change forces a full reimport of unchanged sources and advances the marker', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [createFakeAdapter()], db, ctx });
    const locators = () =>
      db.query('SELECT id, source_id, source_locator, source_path FROM sessions ORDER BY id').all();
    const beforeLocators = locators();

    const second = await importAll({
      adapters: [withVersion(createFakeAdapter(), '2.0.0')],
      db,
      ctx,
    });

    // Unchanged size/mtime sources are re-emitted anyway: a version refresh
    // bypasses the cache, like `--force`.
    expect(reportFor(second, 'fake')).toEqual({
      discovered: 9,
      imported: 9,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    // Installed metadata and completed-refresh marker stay separate columns.
    expect(fakeImportMeta(db)).toEqual({ adapter_version: '2.0.0', imported_version: '2.0.0' });
    // Re-emitting the same effective identity never rewrites a locator.
    expect(locators()).toEqual(beforeLocators);

    // Once the marker catches up, ordinary incremental behavior resumes.
    const third = await importAll({
      adapters: [withVersion(createFakeAdapter(), '2.0.0')],
      db,
      ctx,
    });
    expect(reportFor(third, 'fake').discovered).toBe(0);
  });

  test('a version refresh backfills a previously NULL metadata column without changing the locator', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles([]);
    const step = () =>
      db
        .query(
          `SELECT s.source_path AS source_path, st.mcp_server AS mcp_server, st.mcp_tool AS mcp_tool
           FROM steps st JOIN sessions s ON s.id = st.session_id
           WHERE st.session_id = 'fake:refresh'`,
        )
        .get() as { source_path: string; mcp_server: string | null; mcp_tool: string | null };

    await importAll({ adapters: [refreshAdapter('1.0.0', { identity: false })], db, ctx });
    expect(step()).toEqual({
      source_path: '/fake/refresh.jsonl',
      mcp_server: null,
      mcp_tool: null,
    });

    await importAll({ adapters: [refreshAdapter('2.0.0', { identity: true })], db, ctx });

    expect(step()).toEqual({
      source_path: '/fake/refresh.jsonl',
      mcp_server: 'srv',
      mcp_tool: 'tool',
    });
    expect(readImportedVersion(db, 'fake')).toBe('2.0.0');
  });

  test('a NULL marker on a legacy store forces one full refresh even when sizes match', async () => {
    const { db } = openStore(':memory:');
    // A pre-feature store: installed metadata present, completion marker NULL.
    db.run(
      "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('fake', 'Fake', '1.0.0', '[]')",
    );
    db.run(
      `INSERT INTO sessions (id, harness_id, project_key, depth, source_path, source_size, source_mtime)
       VALUES ('fake:root', 'fake', NULL, 0, '/fake/root.jsonl', 1000, 1000)`,
    );

    const report = await importAll({
      adapters: [createFakeAdapter()],
      db,
      ctx: ctxWithFiles(BASE_PATHS),
    });

    // Every source is re-parsed despite matching sizes; the marker advances.
    expect(reportFor(report, 'fake')).toEqual({
      discovered: 9,
      imported: 9,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
  });

  test('a mid-stream discover throw invalidates the marker and preserves all imported history, then retries', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [createFakeAdapter()], db, ctx });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');

    const inner = createFakeAdapter();
    const throwing = {
      ...withVersion(inner, '2.0.0'),
      async *discover(c: AdapterContext, known: Parameters<typeof inner.discover>[1]) {
        let i = 0;
        for await (const bundle of inner.discover(c, known)) {
          if (i === 2) throw new Error('boom mid-stream');
          i++;
          yield bundle;
        }
      },
    };

    const partial = await importAll({ adapters: [throwing], db, ctx });
    expect(reportFor(partial, 'fake').error).toBe('fake: Error');
    // Incomplete enumeration: no removal, and the apparent completed marker is
    // cleared so the next scan retries instead of trusting the cache.
    expect(readImportedVersion(db, 'fake')).toBeNull();
    expect(sessionIds(db).length).toBe(9);

    // The retry (a now-complete v2 adapter) refreshes and completes.
    const retry = await importAll({
      adapters: [withVersion(createFakeAdapter(), '2.0.0')],
      db,
      ctx,
    });
    expect(reportFor(retry, 'fake').discovered).toBe(9);
    expect(readImportedVersion(db, 'fake')).toBe('2.0.0');
  });

  test('a failed bundle blocks the marker and the next run retries via a full refresh', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter({ includeInvalid: true });
    const ctx = ctxWithFiles([...BASE_PATHS, '/fake/invalid.jsonl']);

    const first = await importAll({ adapters: [adapter], db, ctx });
    expect(reportFor(first, 'fake').failed).toBe(1);
    expect(readImportedVersion(db, 'fake')).toBeNull();

    const second = await importAll({ adapters: [adapter], db, ctx });
    expect(reportFor(second, 'fake').discovered).toBe(10);
    expect(reportFor(second, 'fake').failed).toBe(1);
    expect(reportFor(second, 'fake').imported).toBe(9);
    expect(readImportedVersion(db, 'fake')).toBeNull();
  });

  test('an error-level diagnostic blocks completion', async () => {
    const { db } = openStore(':memory:');
    const report = await importAll({
      adapters: [
        refreshAdapter('1.0.0', {
          identity: false,
          diagnostics: [{ level: 'error', code: 'source-read-failed', message: 'read failed' }],
        }),
      ],
      db,
      ctx: ctxWithFiles([]),
    });
    expect(reportFor(report, 'fake').imported).toBe(1);
    expect(readImportedVersion(db, 'fake')).toBeNull();
  });

  test('a tolerated warning diagnostic does not block completion (no retry loop)', async () => {
    const { db } = openStore(':memory:');
    const report = await importAll({
      adapters: [
        refreshAdapter('1.0.0', {
          identity: false,
          diagnostics: [
            {
              level: 'warn',
              code: 'malformed-json-line',
              message: 'Could not parse a line as JSON',
            },
          ],
        }),
      ],
      db,
      ctx: ctxWithFiles([]),
    });
    expect(reportFor(report, 'fake').imported).toBe(1);
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
  });

  test('an incomplete scan retains known sources it did not enumerate instead of pruning them', async () => {
    const { db } = openStore(':memory:');
    await importAll({ adapters: [createFakeAdapter()], db, ctx: ctxWithFiles(BASE_PATHS) });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
    expect(sessionIds(db).length).toBe(9);

    // Run 2 is a version refresh (so the cache is bypassed) that visits only
    // root/child1 and whose invalid source fails validation: `complete` is
    // false. The other seven stored sources are absent from this ctx and from
    // the emitted set, so an incomplete scan must not delete them.
    const partial = await importAll({
      adapters: [
        withVersion(
          createFakeAdapter({ includeInvalid: true, scenarios: ['root', 'child1', 'invalid'] }),
          '2.0.0',
        ),
      ],
      db,
      ctx: ctxWithFiles(['/fake/root.jsonl', '/fake/child1.jsonl', '/fake/invalid.jsonl']),
    });

    expect(reportFor(partial, 'fake').failed).toBe(1);
    expect(reportFor(partial, 'fake').removed).toBe(0);
    expect(readImportedVersion(db, 'fake')).toBeNull();
    // Every previously stored source survives the incomplete run.
    expect(sessionIds(db)).toContain('fake:titled');
    expect(sessionIds(db)).toContain('fake:orphan');
    expect(sessionIds(db)).toContain('fake:grandchild');
  });

  test('a complete scan still prunes a confirmed-absent source (regression guard for the incomplete-scan gate)', async () => {
    const { db } = openStore(':memory:');
    const adapter = createFakeAdapter();
    await importAll({ adapters: [adapter], db, ctx: ctxWithFiles(BASE_PATHS) });

    const second = await importAll({
      adapters: [adapter],
      db,
      ctx: ctxWithFiles(BASE_PATHS.filter((p) => p !== '/fake/orphan.jsonl')),
    });
    expect(reportFor(second, 'fake').removed).toBe(1);
    expect(sessionIds(db)).not.toContain('fake:orphan');
  });

  test('a vanished-source cleanup failure invalidates the marker', async () => {
    const { db } = openStore(':memory:');
    const ctx = opencodeCtx();
    await importAll({
      adapters: [
        opencodeLikeAdapter({ ids: ['opencode:current:ses_a', 'opencode:current:ses_b'] }),
      ],
      db,
      ctx,
    });
    expect(readImportedVersion(db, 'opencode')).toBe('1.0.0');

    const failingCleanup = {
      ...withVersion(opencodeLikeAdapter({ ids: ['opencode:current:ses_a'] }), '2.0.0'),
      sourceExists: async (): Promise<boolean> => {
        throw new Error('cleanup boom');
      },
    };
    const report = await importAll({ adapters: [failingCleanup], db, ctx });

    expect(reportFor(report, 'opencode').error).toBe('opencode: Error');
    expect(readImportedVersion(db, 'opencode')).toBeNull();
  });

  test('titles:false still nulls titles during a version refresh', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [createFakeAdapter()], db, ctx });
    const titled = db.query("SELECT title FROM sessions WHERE id = 'fake:titled'").get() as {
      title: string | null;
    };
    expect(titled.title).toBe('A fake session title');

    const noTitles: AdapterContext = { ...ctx, privacy: { titles: false } };
    const report = await importAll({
      adapters: [withVersion(createFakeAdapter(), '2.0.0')],
      db,
      ctx: noTitles,
    });

    expect(reportFor(report, 'fake').discovered).toBe(9);
    expect(readImportedVersion(db, 'fake')).toBe('2.0.0');
    const after = db.query('SELECT title FROM sessions').all() as { title: string | null }[];
    for (const row of after) expect(row.title).toBeNull();
  });

  test('--force still bypasses the cache and does not disturb the completion marker', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles(BASE_PATHS);
    await importAll({ adapters: [createFakeAdapter()], db, ctx });

    const forced = await importAll({ adapters: [createFakeAdapter()], db, ctx, force: true });

    expect(reportFor(forced, 'fake')).toEqual({
      discovered: 9,
      imported: 9,
      skipped: 0,
      removed: 0,
      failed: 0,
    });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
  });

  test('an error diagnostic after a completed version invalidates the marker so the next scan retries the cached source', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles([]);

    // 1. A completed same-version import records the marker.
    await importAll({ adapters: [refreshAdapter('1.0.0', { identity: false })], db, ctx });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');

    // 2. The source changes and its re-read fails with an error diagnostic. The
    //    changed size is persisted, so a same-version incremental scan would
    //    treat it as known and skip it forever.
    const failed = await importAll({
      adapters: [
        refreshAdapter('1.0.0', {
          identity: false,
          size: 20,
          diagnostics: [{ level: 'error', code: 'source-read-failed', message: 'read failed' }],
        }),
      ],
      db,
      ctx,
    });
    expect(reportFor(failed, 'fake').imported).toBe(1);
    // Capture the marker before the retry so the retry's discovery behavior is
    // observable first.
    const markerAfterFailure = readImportedVersion(db, 'fake');
    expect(db.query("SELECT source_size FROM sessions WHERE id = 'fake:refresh'").get()).toEqual({
      source_size: 20,
    });

    // 3. The next scan bypasses the size/mtime cache (the source is unchanged
    //    from what the failed run stored) and completes. Without invalidation
    //    the marker would still equal the version and this would be skipped (0).
    const retry = await importAll({
      adapters: [refreshAdapter('1.0.0', { identity: false, size: 20 })],
      db,
      ctx,
    });
    expect(reportFor(retry, 'fake').discovered).toBe(1);
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
    // The incomplete run must not have retained apparent success.
    expect(markerAfterFailure).toBeNull();
  });

  test('a validation failure after a completed version invalidates the marker and retries', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles([]);
    await importAll({ adapters: [refreshAdapter('1.0.0', { identity: false })], db, ctx });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');

    const inner = refreshAdapter('1.0.0', { identity: false, size: 20 });
    const invalid = {
      ...inner,
      async *discover(c: AdapterContext, known: Parameters<typeof inner.discover>[1]) {
        for await (const bundle of inner.discover(c, known)) {
          yield { ...bundle, steps: bundle.steps.map((step) => ({ ...step, seq: -1 })) };
        }
      },
    };
    const failed = await importAll({ adapters: [invalid], db, ctx });
    expect(reportFor(failed, 'fake').failed).toBe(1);
    expect(readImportedVersion(db, 'fake')).toBeNull();

    const retry = await importAll({
      adapters: [refreshAdapter('1.0.0', { identity: false, size: 20 })],
      db,
      ctx,
    });
    expect(reportFor(retry, 'fake').discovered).toBe(1);
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
  });

  test('a discover throw after a completed version invalidates the marker and retries', async () => {
    const { db } = openStore(':memory:');
    const ctx = ctxWithFiles([]);
    await importAll({ adapters: [refreshAdapter('1.0.0', { identity: false })], db, ctx });
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');

    const throwing = {
      ...refreshAdapter('1.0.0', { identity: false }),
      discover: () => throwingDiscover(new Error('discover boom')),
    };
    const failed = await importAll({ adapters: [throwing], db, ctx });
    expect(reportFor(failed, 'fake').error).toBe('fake: Error');
    expect(readImportedVersion(db, 'fake')).toBeNull();

    const retry = await importAll({
      adapters: [refreshAdapter('1.0.0', { identity: false })],
      db,
      ctx,
    });
    expect(reportFor(retry, 'fake').discovered).toBe(1);
    expect(readImportedVersion(db, 'fake')).toBe('1.0.0');
  });
});
