import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { SessionBundle } from '../contract/types';
import {
  loadKnown,
  persistBundle,
  persistInvalidBundle,
  removeVanished,
  upsertHarness,
} from './persist';
import { openStore } from './store';

function bundle(
  overrides: Partial<SessionBundle['session']> = {},
  steps: SessionBundle['steps'] = [],
): SessionBundle {
  return {
    project: { key: 'k', name: 'k', identity: 'cwd' },
    session: {
      id: 'fake:s1',
      harnessId: 'fake',
      projectKey: 'k',
      depth: 0,
      sourcePath: '/fake/s1.jsonl',
      sourceSize: 10,
      sourceMtime: 1,
      ...overrides,
    },
    steps,
    diagnostics: [],
  };
}

/** Every session references a harnesses row via a real FK; the orchestrator upserts it once per adapter run. */
function storeWithFakeHarness() {
  const store = openStore(':memory:');
  upsertHarness(store.db, {
    id: 'fake',
    displayName: 'Fake',
    adapterVersion: '1.0.0',
    capabilities: [],
  });
  return store;
}

describe('persistBundle', () => {
  test("replaces an existing session's steps/tool counts/diagnostics rather than accumulating", () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({}, [
        { sessionId: 'fake:s1', seq: 0, kind: 'tool', toolCategory: 'read' },
        { sessionId: 'fake:s1', seq: 1, kind: 'tool', toolCategory: 'read' },
      ]),
    );
    persistBundle(
      db,
      bundle({}, [{ sessionId: 'fake:s1', seq: 0, kind: 'tool', toolCategory: 'write' }]),
    );

    const steps = db.query('SELECT * FROM steps WHERE session_id = ?').all('fake:s1');
    expect(steps.length).toBe(1);
    const counts = db
      .query('SELECT category, count FROM session_tool_counts WHERE session_id = ?')
      .all('fake:s1') as { category: string; count: number }[];
    expect(counts).toEqual([{ category: 'write', count: 1 }]);
  });

  test('derives session_tool_counts by GROUP BY tool_category from the bundle steps', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({}, [
        { sessionId: 'fake:s1', seq: 0, kind: 'tool', toolCategory: 'read' },
        { sessionId: 'fake:s1', seq: 1, kind: 'tool', toolCategory: 'read' },
        { sessionId: 'fake:s1', seq: 2, kind: 'tool', toolCategory: 'exec' },
        { sessionId: 'fake:s1', seq: 3, kind: 'call' },
      ]),
    );
    const counts = db
      .query(
        'SELECT category, count FROM session_tool_counts WHERE session_id = ? ORDER BY category',
      )
      .all('fake:s1') as { category: string; count: number }[];
    expect(counts).toEqual([
      { category: 'exec', count: 1 },
      { category: 'read', count: 2 },
    ]);
  });

  test('the two-unique-key case: a new bundle at the same source_path but a different id displaces the old row', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:old-id', sourcePath: '/fake/same.jsonl' }));
    persistBundle(db, bundle({ id: 'fake:new-id', sourcePath: '/fake/same.jsonl' }));

    const rows = db
      .query('SELECT id FROM sessions WHERE source_path = ?')
      .all('/fake/same.jsonl') as {
      id: string;
    }[];
    expect(rows).toEqual([{ id: 'fake:new-id' }]);
  });
});

describe('persistInvalidBundle', () => {
  test('inserts a stub session (project_key/source_size/source_mtime NULL) plus a bundle-invalid diagnostic', () => {
    const { db } = storeWithFakeHarness();
    const ok = persistInvalidBundle(
      db,
      'fake',
      { session: { id: 'fake:bad', sourcePath: '/fake/bad.jsonl' } },
      ['session.depth: too_small'],
    );
    expect(ok).toBe(true);

    const row = db.query('SELECT * FROM sessions WHERE id = ?').get('fake:bad') as {
      project_key: string | null;
      depth: number;
      source_size: number | null;
      source_mtime: number | null;
    };
    expect(row.project_key).toBeNull();
    expect(row.depth).toBe(0);
    expect(row.source_size).toBeNull();
    expect(row.source_mtime).toBeNull();

    const diags = db
      .query('SELECT code, message FROM diagnostics WHERE session_id = ?')
      .all('fake:bad') as { code: string; message: string }[];
    expect(diags).toEqual([{ code: 'bundle-invalid', message: 'session.depth: too_small' }]);
  });

  test('does the same source_path cleanup as persistBundle (two-unique-key case)', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:old-id', sourcePath: '/fake/same.jsonl' }));
    persistInvalidBundle(
      db,
      'fake',
      { session: { id: 'fake:new-bad', sourcePath: '/fake/same.jsonl' } },
      ['x'],
    );

    const rows = db
      .query('SELECT id FROM sessions WHERE source_path = ?')
      .all('/fake/same.jsonl') as {
      id: string;
    }[];
    expect(rows).toEqual([{ id: 'fake:new-bad' }]);
  });

  test('returns false and writes nothing when id/sourcePath are unusable', () => {
    const { db } = storeWithFakeHarness();
    const ok = persistInvalidBundle(db, 'fake', { session: {} }, ['x']);
    expect(ok).toBe(false);
    const rows = db.query('SELECT * FROM sessions').all();
    expect(rows.length).toBe(0);
  });
});

describe('loadKnown', () => {
  test("root scoping: a row under /other/... is not returned when roots = ['/fake']", () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:in', sourcePath: '/fake/in.jsonl' }));
    persistBundle(db, bundle({ id: 'fake:out', sourcePath: '/other/out.jsonl' }));

    const known = loadKnown(db, 'fake', ['/fake']);
    expect([...known.keys()]).toEqual(['/fake/in.jsonl']);
  });

  test('a root path itself (exact match, no trailing separator) is included', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:exact', sourcePath: '/fake' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    expect(known.has('/fake')).toBe(true);
  });

  test('NULL source_size/source_mtime map to { size: -1, mtime: -1 }', () => {
    const { db } = storeWithFakeHarness();
    persistInvalidBundle(
      db,
      'fake',
      { session: { id: 'fake:stub', sourcePath: '/fake/stub.jsonl' } },
      ['x'],
    );
    const known = loadKnown(db, 'fake', ['/fake']);
    expect(known.get('/fake/stub.jsonl')).toEqual({ size: -1, mtime: -1 });
  });
});

describe('removeVanished', () => {
  test('deletes sessions whose known path no longer stats, cascading to child tables', async () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({ id: 'fake:gone', sourcePath: '/fake/gone.jsonl' }, [
        { sessionId: 'fake:gone', seq: 0, kind: 'turn' },
      ]),
    );
    const known = loadKnown(db, 'fake', ['/fake']);
    const fs = createMemoryFs({ files: {} }); // nothing exists
    const removed = await removeVanished(db, 'fake', known, new Set(), fs);
    expect(removed).toBe(1);
    expect(db.query('SELECT * FROM sessions WHERE id = ?').all('fake:gone').length).toBe(0);
    expect(db.query('SELECT * FROM steps WHERE session_id = ?').all('fake:gone').length).toBe(0);
  });

  test('a path that still stats is not removed', async () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:still-here', sourcePath: '/fake/still-here.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    const fs = createMemoryFs({ files: { '/fake/still-here.jsonl': 'x' } });
    const removed = await removeVanished(db, 'fake', known, new Set(), fs);
    expect(removed).toBe(0);
    expect(db.query('SELECT * FROM sessions WHERE id = ?').all('fake:still-here').length).toBe(1);
  });

  test('a path that was re-emitted this run is not removed even if it no longer stats', async () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:emitted', sourcePath: '/fake/emitted.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    const fs = createMemoryFs({ files: {} });
    const removed = await removeVanished(db, 'fake', known, new Set(['/fake/emitted.jsonl']), fs);
    expect(removed).toBe(0);
  });

  test('a row under another root is never removed by a run scoped to /fake', async () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:other', sourcePath: '/other/keep.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    expect(known.size).toBe(0);
    const fs = createMemoryFs({ files: {} });
    const removed = await removeVanished(db, 'fake', known, new Set(), fs);
    expect(removed).toBe(0);
    expect(db.query('SELECT * FROM sessions WHERE id = ?').all('fake:other').length).toBe(1);
  });
});
