import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { AdapterContext } from '../adapter/types';
import type { SessionBundle } from '../contract/types';
import {
  effectiveSourceId,
  effectiveSourceLocator,
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

/** A minimal AdapterContext for removeVanished's `opts.ctx` (the sourceExists callback ignores it). */
function adapterCtx(): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
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

  test('persists step.skillName into steps.skill_name, and NULL when a step has none', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({}, [
        {
          sessionId: 'fake:s1',
          seq: 0,
          kind: 'tool',
          toolCategory: 'skill',
          toolName: 'Skill',
          skillName: 'my-skill',
        },
        { sessionId: 'fake:s1', seq: 1, kind: 'tool', toolCategory: 'read', toolName: 'Read' },
      ]),
    );
    const rows = db
      .query('SELECT seq, skill_name FROM steps WHERE session_id = ? ORDER BY seq')
      .all('fake:s1') as { seq: number; skill_name: string | null }[];
    expect(rows).toEqual([
      { seq: 0, skill_name: 'my-skill' },
      { seq: 1, skill_name: null },
    ]);
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

describe('effectiveSourceId/effectiveSourceLocator', () => {
  test('default to sourcePath when sourceId/sourceLocator are absent (Claude path)', () => {
    expect(effectiveSourceId({ sourcePath: '/fake/s.jsonl' })).toBe('/fake/s.jsonl');
    expect(effectiveSourceLocator({ sourcePath: '/fake/s.jsonl' })).toBe('/fake/s.jsonl');
  });

  test('use sourceId/sourceLocator when present (OpenCode path)', () => {
    expect(
      effectiveSourceId({ sourceId: 'opencode:current:x', sourcePath: 'opencode:current:x' }),
    ).toBe('opencode:current:x');
    expect(
      effectiveSourceLocator({
        sourceLocator: '/db/opencode.db',
        sourcePath: 'opencode:current:x',
      }),
    ).toBe('/db/opencode.db');
  });
});

describe('sourceId/sourceLocator persistence', () => {
  test('persistBundle writes source_id and source_locator columns', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({
        id: 'opencode:current:ses_1',
        sourceId: 'opencode:current:ses_1',
        sourceLocator: '/db/opencode.db',
        sourcePath: 'opencode:current:ses_1',
      }),
    );
    const row = db
      .query('SELECT source_id, source_locator, source_path FROM sessions WHERE id = ?')
      .get('opencode:current:ses_1') as {
      source_id: string | null;
      source_locator: string | null;
      source_path: string;
    };
    expect(row.source_id).toBe('opencode:current:ses_1');
    expect(row.source_locator).toBe('/db/opencode.db');
    expect(row.source_path).toBe('opencode:current:ses_1');
  });

  test('persistInvalidBundle writes source_id/source_locator on the invalid stub', () => {
    const { db } = storeWithFakeHarness();
    persistInvalidBundle(
      db,
      'fake',
      {
        session: {
          id: 'opencode:current:bad',
          sourceId: 'opencode:current:bad',
          sourceLocator: '/db/opencode.db',
          sourcePath: 'opencode:current:bad',
        },
      },
      ['x'],
    );
    const row = db
      .query('SELECT source_id, source_locator FROM sessions WHERE id = ?')
      .get('opencode:current:bad') as { source_id: string | null; source_locator: string | null };
    expect(row.source_id).toBe('opencode:current:bad');
    expect(row.source_locator).toBe('/db/opencode.db');
  });
});

describe('loadKnown: identity-keyed and locator-scoped', () => {
  test('a row with source_id distinct from source_path is keyed by source_id', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({
        id: 'opencode:current:ses_1',
        sourceId: 'opencode:current:ses_1',
        sourceLocator: '/db/opencode.db',
        sourcePath: 'opencode:current:ses_1',
      }),
    );
    const known = loadKnown(db, 'fake', ['/db']);
    expect([...known.keys()]).toEqual(['opencode:current:ses_1']);
  });

  test('root scoping uses the physical source_locator, not the opaque id', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({
        id: 'opencode:current:ses_1',
        sourceId: 'opencode:current:ses_1',
        sourceLocator: '/db/opencode.db',
        sourcePath: 'opencode:current:ses_1',
      }),
    );
    // A root that does NOT contain the locator (e.g. an opaque id prefix) must
    // not include the row.
    const known = loadKnown(db, 'fake', ['opencode:']);
    expect(known.size).toBe(0);
  });

  test('identity default: a row with no source_id is keyed by source_path', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ id: 'fake:s1', sourcePath: '/fake/s1.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    expect([...known.keys()]).toEqual(['/fake/s1.jsonl']);
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

  test('sourceExists returning false deletes a known-but-unemitted source by COALESCE(source_id, source_path)', async () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({
        id: 'opencode:current:ses_1',
        sourceId: 'opencode:current:ses_1',
        sourceLocator: '/db/opencode.db',
        sourcePath: 'opencode:current:ses_1',
      }),
    );
    const known = loadKnown(db, 'fake', ['/db']);
    const removed = await removeVanished(db, 'fake', known, new Set(), createMemoryFs(), {
      sourceExists: async () => false,
      ctx: adapterCtx(),
    });
    expect(removed).toBe(1);
    expect(
      db.query('SELECT * FROM sessions WHERE id = ?').all('opencode:current:ses_1').length,
    ).toBe(0);
  });

  test('sourceExists returning true retains a known-but-unemitted source', async () => {
    const { db } = storeWithFakeHarness();
    persistBundle(
      db,
      bundle({
        id: 'opencode:current:ses_1',
        sourceId: 'opencode:current:ses_1',
        sourceLocator: '/db/opencode.db',
        sourcePath: 'opencode:current:ses_1',
      }),
    );
    const known = loadKnown(db, 'fake', ['/db']);
    const removed = await removeVanished(db, 'fake', known, new Set(), createMemoryFs(), {
      sourceExists: async () => true,
      ctx: adapterCtx(),
    });
    expect(removed).toBe(0);
    expect(
      db.query('SELECT * FROM sessions WHERE id = ?').all('opencode:current:ses_1').length,
    ).toBe(1);
  });

  test('a NULL-source_id stub row is still deletable via the COALESCE delete', async () => {
    const { db } = storeWithFakeHarness();
    // A raw test insert / invalid stub with NULL source_id (no sourceId emitted).
    persistInvalidBundle(
      db,
      'fake',
      { session: { id: 'fake:stub', sourcePath: '/fake/stub.jsonl' } },
      ['x'],
    );
    const known = loadKnown(db, 'fake', ['/fake']);
    expect([...known.keys()]).toEqual(['/fake/stub.jsonl']);
    const fs = createMemoryFs({ files: {} });
    const removed = await removeVanished(db, 'fake', known, new Set(), fs);
    expect(removed).toBe(1);
    expect(db.query('SELECT * FROM sessions WHERE id = ?').all('fake:stub').length).toBe(0);
  });
});
