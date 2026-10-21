import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '../adapter/fs.memory';
import type { AdapterContext } from '../adapter/types';
import type { SessionBundle } from '../contract/types';
import {
  effectiveSourceId,
  effectiveSourceLocator,
  loadKnown,
  markImportedVersion,
  persistBundle,
  persistInvalidBundle,
  readImportedVersion,
  removeVanished,
  upsertHarness,
} from './persist';
import { recomputeRollups } from './rollups';
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

/** The id of a `models` row by its UNIQUE name; throws when absent so a bug is loud, not `undefined`. */
function modelIdByName(models: { id: number; name: string }[], name: string): number {
  const found = models.find((m) => m.name === name);
  if (found === undefined) throw new Error(`models row for '${name}' not found`);
  return found.id;
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

/** persistBundle with titles on: the D7 opt-in default these tests don't exercise. */
function persistWithTitles(db: Database, b: SessionBundle): void {
  persistBundle(db, b, true);
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

describe('harness imported_version completion marker (D82)', () => {
  test('readImportedVersion is NULL when the harness row or the marker is absent', () => {
    const { db } = openStore(':memory:');
    expect(readImportedVersion(db, 'fake')).toBeNull();

    upsertHarness(db, {
      id: 'fake',
      displayName: 'Fake',
      adapterVersion: '1.0.0',
      capabilities: [],
    });
    expect(readImportedVersion(db, 'fake')).toBeNull();
  });

  test('markImportedVersion records the completed refresh version', () => {
    const { db } = storeWithFakeHarness();
    markImportedVersion(db, 'fake', '2.0.0');
    expect(readImportedVersion(db, 'fake')).toBe('2.0.0');
  });

  test('upsertHarness refreshes installed metadata but never clobbers the marker', () => {
    const { db } = storeWithFakeHarness();
    markImportedVersion(db, 'fake', '1.0.0');

    upsertHarness(db, {
      id: 'fake',
      displayName: 'Fake v2',
      adapterVersion: '2.0.0',
      capabilities: ['title'],
    });

    const row = db
      .query('SELECT display_name, adapter_version, imported_version FROM harnesses WHERE id = ?')
      .get('fake');
    expect(row).toEqual({
      display_name: 'Fake v2',
      adapter_version: '2.0.0',
      imported_version: '1.0.0',
    });
  });
});

describe('persistBundle', () => {
  test("replaces an existing session's steps/tool counts/diagnostics rather than accumulating", () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({}, [
        { sessionId: 'fake:s1', seq: 0, kind: 'tool', toolCategory: 'read' },
        { sessionId: 'fake:s1', seq: 1, kind: 'tool', toolCategory: 'read' },
      ]),
    );
    persistWithTitles(
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
    persistWithTitles(
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
    persistWithTitles(db, bundle({ id: 'fake:old-id', sourcePath: '/fake/same.jsonl' }));
    persistWithTitles(db, bundle({ id: 'fake:new-id', sourcePath: '/fake/same.jsonl' }));

    const rows = db
      .query('SELECT id FROM sessions WHERE source_path = ?')
      .all('/fake/same.jsonl') as {
      id: string;
    }[];
    expect(rows).toEqual([{ id: 'fake:new-id' }]);
  });

  test('persists step.skillName into steps.skill_name, and NULL when a step has none', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
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

  test('persists step.mcpServer/mcpTool into steps.mcp_server/mcp_tool (metadata roundtrip)', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({}, [
        {
          sessionId: 'fake:s1',
          seq: 0,
          kind: 'tool',
          toolCategory: 'mcp',
          toolName: 'mcp__plugin_engram_engram__mem_save',
          mcpServer: 'plugin_engram_engram',
          mcpTool: 'mem_save',
        },
      ]),
    );
    const row = db
      .query('SELECT tool_name, mcp_server, mcp_tool FROM steps WHERE session_id = ?')
      .get('fake:s1') as {
      tool_name: string;
      mcp_server: string | null;
      mcp_tool: string | null;
    };
    expect(row).toEqual({
      // The raw name is preserved verbatim alongside the normalized pair.
      tool_name: 'mcp__plugin_engram_engram__mem_save',
      mcp_server: 'plugin_engram_engram',
      mcp_tool: 'mem_save',
    });
  });

  test('writes NULL identity for an unproven mcp step and a non-MCP step', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({}, [
        {
          sessionId: 'fake:s1',
          seq: 0,
          kind: 'tool',
          toolCategory: 'mcp',
          toolName: 'mcp__server__tool__extra',
        },
        { sessionId: 'fake:s1', seq: 1, kind: 'tool', toolCategory: 'read', toolName: 'Read' },
      ]),
    );
    const rows = db
      .query('SELECT seq, mcp_server, mcp_tool FROM steps WHERE session_id = ? ORDER BY seq')
      .all('fake:s1') as { seq: number; mcp_server: string | null; mcp_tool: string | null }[];
    expect(rows).toEqual([
      { seq: 0, mcp_server: null, mcp_tool: null },
      { seq: 1, mcp_server: null, mcp_tool: null },
    ]);
  });

  test('replaceSteps clears identity when a re-emitted step loses it (no stale pair survives)', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({}, [
        {
          sessionId: 'fake:s1',
          seq: 0,
          kind: 'tool',
          toolCategory: 'mcp',
          toolName: 'mcp__srv__tool',
          mcpServer: 'srv',
          mcpTool: 'tool',
        },
      ]),
    );
    persistWithTitles(
      db,
      bundle({}, [
        {
          sessionId: 'fake:s1',
          seq: 0,
          kind: 'tool',
          toolCategory: 'mcp',
          toolName: 'mcp__srv__tool__extra',
        },
      ]),
    );
    const row = db
      .query('SELECT mcp_server, mcp_tool FROM steps WHERE session_id = ?')
      .get('fake:s1') as { mcp_server: string | null; mcp_tool: string | null };
    expect(row).toEqual({ mcp_server: null, mcp_tool: null });
  });
});

describe('persistBundle: titles (D7)', () => {
  test('titles: true persists the bundle title', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ title: 'A kept title' }), true);

    const row = db.query('SELECT title FROM sessions WHERE id = ?').get('fake:s1') as {
      title: string | null;
    };
    expect(row.title).toBe('A kept title');
  });

  test('titles: false binds NULL even when the bundle carries a title', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ title: 'RUNWIRE_CANARY_TITLE' }), false);

    const row = db.query('SELECT title FROM sessions WHERE id = ?').get('fake:s1') as {
      title: string | null;
    };
    expect(row.title).toBeNull();
  });

  test('reimport with titles: false after titles: true clears the stored title', () => {
    const { db } = storeWithFakeHarness();
    persistBundle(db, bundle({ title: 'A kept title' }), true);
    persistBundle(db, bundle({ title: 'A kept title' }), false);

    const row = db.query('SELECT title FROM sessions WHERE id = ?').get('fake:s1') as {
      title: string | null;
    };
    expect(row.title).toBeNull();
  });
});

describe('persistBundle: model provider identity (models table + FK ids)', () => {
  test('the same model name from two providers gets two rows and per-provider FK ids', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({ modelPrimary: 'gpt-6.1-sol', modelPrimaryProvider: 'openai' }, [
        {
          sessionId: 'fake:s1',
          seq: 0,
          kind: 'call',
          model: 'gpt-6.1-sol',
          modelProvider: 'openai',
        },
        {
          sessionId: 'fake:s1',
          seq: 1,
          kind: 'call',
          model: 'gpt-6.1-sol',
          modelProvider: 'openai-codex',
        },
      ]),
    );

    const models = db.query('SELECT id, provider, name FROM models ORDER BY provider').all() as {
      id: number;
      provider: string | null;
      name: string;
    }[];
    expect(models.map((m) => [m.provider, m.name])).toEqual([
      ['openai', 'gpt-6.1-sol'],
      ['openai-codex', 'gpt-6.1-sol'],
    ]);

    const openaiRow = models.find((m) => m.provider === 'openai');
    const codexRow = models.find((m) => m.provider === 'openai-codex');
    if (openaiRow === undefined || codexRow === undefined) throw new Error('expected both rows');

    const session = db
      .query('SELECT model_primary_id FROM sessions WHERE id = ?')
      .get('fake:s1') as { model_primary_id: number | null };
    expect(session.model_primary_id).toBe(openaiRow.id);

    const steps = db
      .query('SELECT seq, model_id FROM steps WHERE session_id = ? ORDER BY seq')
      .all('fake:s1') as { seq: number; model_id: number | null }[];
    expect(steps).toEqual([
      { seq: 0, model_id: openaiRow.id },
      { seq: 1, model_id: codexRow.id },
    ]);
  });

  test('a model without provider keeps NULL and dedups by name (claude-code style)', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(db, bundle({ id: 'fake:s1', modelPrimary: 'claude-opus-5-5' }));
    persistWithTitles(
      db,
      bundle({ id: 'fake:s2', sourcePath: '/fake/s2.jsonl', modelPrimary: 'claude-opus-5-5' }),
    );

    const models = db.query('SELECT id, provider, name FROM models').all() as {
      id: number;
      provider: string | null;
      name: string;
    }[];
    expect(models).toEqual([{ id: expect.any(Number), provider: null, name: 'claude-opus-5-5' }]);
  });

  test('the same name with and without provider are distinct rows', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({ modelPrimary: 'glm5.3-flash', modelPrimaryProvider: 'nan' }, [
        { sessionId: 'fake:s1', seq: 0, kind: 'call', model: 'glm5.3-flash', modelProvider: 'nan' },
      ]),
    );
    persistWithTitles(
      db,
      bundle({ id: 'fake:s2', sourcePath: '/fake/s2.jsonl', modelPrimary: 'glm5.3-flash' }),
    );

    const models = db.query('SELECT provider, name FROM models ORDER BY provider').all() as {
      provider: string | null;
      name: string;
    }[];
    expect(models.map((m) => [m.provider, m.name])).toEqual([
      [null, 'glm5.3-flash'],
      ['nan', 'glm5.3-flash'],
    ]);
  });

  test('re-persisting a provider bundle adds no duplicate models rows', () => {
    const { db } = storeWithFakeHarness();
    const b = bundle({ modelPrimary: 'glm5.3-flash', modelPrimaryProvider: 'nan' }, [
      { sessionId: 'fake:s1', seq: 0, kind: 'call', model: 'glm5.3-flash', modelProvider: 'nan' },
    ]);
    persistWithTitles(db, b);
    persistWithTitles(db, b);

    expect((db.query('SELECT name FROM models').all() as { name: string }[]).length).toBe(1);
  });
});

describe('persistBundle: model identity (models table + FK ids)', () => {
  test('upserts distinct raw model strings and writes model_primary_id/model_id', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({ modelPrimary: 'claude-sonnet-4' }, [
        { sessionId: 'fake:s1', seq: 0, kind: 'call', model: 'claude-sonnet-4' },
        { sessionId: 'fake:s1', seq: 1, kind: 'tool', toolCategory: 'read', model: 'claude-haiku' },
      ]),
    );

    const models = db.query('SELECT id, name FROM models ORDER BY name').all() as {
      id: number;
      name: string;
    }[];
    expect(models.map((m) => m.name)).toEqual(['claude-haiku', 'claude-sonnet-4']);

    const session = db
      .query('SELECT model_primary_id FROM sessions WHERE id = ?')
      .get('fake:s1') as { model_primary_id: number | null };
    expect(session.model_primary_id).toBe(modelIdByName(models, 'claude-sonnet-4'));

    const steps = db
      .query('SELECT seq, model_id FROM steps WHERE session_id = ? ORDER BY seq')
      .all('fake:s1') as { seq: number; model_id: number | null }[];
    expect(steps).toEqual([
      { seq: 0, model_id: modelIdByName(models, 'claude-sonnet-4') },
      { seq: 1, model_id: modelIdByName(models, 'claude-haiku') },
    ]);
  });

  test('a step with no model keeps model_id NULL and adds no models row', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(db, bundle({}, [{ sessionId: 'fake:s1', seq: 0, kind: 'turn' }]));

    const step = db.query('SELECT model_id FROM steps WHERE session_id = ?').get('fake:s1') as {
      model_id: number | null;
    };
    expect(step.model_id).toBeNull();
    expect((db.query('SELECT name FROM models').all() as { name: string }[]).length).toBe(0);
  });

  test('re-persisting the same bundle adds no duplicate models rows', () => {
    const { db } = storeWithFakeHarness();
    const b = bundle({ modelPrimary: 'claude-sonnet-4' }, [
      { sessionId: 'fake:s1', seq: 0, kind: 'call', model: 'claude-sonnet-4' },
      { sessionId: 'fake:s1', seq: 1, kind: 'call', model: 'claude-haiku' },
    ]);
    persistWithTitles(db, b);
    persistWithTitles(db, b);

    const models = db.query('SELECT name FROM models ORDER BY name').all() as { name: string }[];
    expect(models).toEqual([{ name: 'claude-haiku' }, { name: 'claude-sonnet-4' }]);
  });

  test('two sessions sharing a model string share one models row', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({ id: 'fake:s1', sourcePath: '/fake/s1.jsonl', modelPrimary: 'shared-model' }),
    );
    persistWithTitles(
      db,
      bundle({ id: 'fake:s2', sourcePath: '/fake/s2.jsonl', modelPrimary: 'shared-model' }),
    );

    const models = db.query('SELECT id, name FROM models').all() as {
      id: number;
      name: string;
    }[];
    expect(models.length).toBe(1);
    const only = models[0];
    if (only === undefined) throw new Error('expected exactly one models row');
    const sessionIds = db.query('SELECT model_primary_id FROM sessions ORDER BY id').all() as {
      model_primary_id: number | null;
    }[];
    expect(sessionIds).toEqual([{ model_primary_id: only.id }, { model_primary_id: only.id }]);
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
    persistWithTitles(db, bundle({ id: 'fake:old-id', sourcePath: '/fake/same.jsonl' }));
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

  test('clears a previously valid row to a full stub: tokens/title/parent_id and the rest go NULL', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
      db,
      bundle({ id: 'fake:parent', sourcePath: '/fake/parent.jsonl', uncachedInput: 1, output: 1 }),
    );
    persistWithTitles(
      db,
      bundle(
        {
          id: 'fake:child',
          sourcePath: '/fake/child.jsonl',
          parentId: 'fake:parent',
          relation: 'subagent',
          depth: 1,
          agentType: 'fake-explorer',
          spawnCallId: 'c1',
          title: 'Child title',
          cwd: '/home/u/child',
          gitBranch: 'main',
          gitCommit: 'abc123',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:01:00.000Z',
          durationMs: 60_000,
          modelPrimary: 'fake-model-b',
          modelChanges: 1,
          modePrimary: 'auto',
          modeChanges: 1,
          effort: 'high',
          uncachedInput: 100,
          cachedInput: 5,
          cacheWrite: 2,
          output: 250,
          reasoningOutput: 3,
          turns: 1,
          apiCalls: 2,
          toolCalls: 4,
          compactions: 1,
          costUsd: 0.42,
          initiatorKind: 'machine',
          initiatorSurface: 'sdk',
          initiatorAutomation: 'sdk',
          resumed: true,
          forkedFrom: 'fake:other',
          harnessVersionFirst: '1.0.0',
          harnessVersionLast: '1.0.1',
        },
        [{ sessionId: 'fake:child', seq: 0, kind: 'call', output: 250 }],
      ),
    );
    recomputeRollups(db);

    // Sanity: the valid child contributes its exclusive totals to the parent.
    const before = db
      .query('SELECT uncached_input, output, descendants FROM rollups WHERE session_id = ?')
      .get('fake:parent') as {
      uncached_input: number | null;
      output: number | null;
      descendants: number;
    };
    expect(before).toEqual({ uncached_input: 101, output: 251, descendants: 1 });

    // Same id/source re-imported as invalid: the row must become a pure stub.
    const ok = persistInvalidBundle(
      db,
      'fake',
      { session: { id: 'fake:child', sourcePath: '/fake/child.jsonl' } },
      ['session.depth: too_small'],
    );
    expect(ok).toBe(true);

    const row = db.query('SELECT * FROM sessions WHERE id = ?').get('fake:child') as Record<
      string,
      unknown
    >;
    const cleared = [
      'project_key',
      'parent_id',
      'relation',
      'agent_type',
      'spawn_call_id',
      'title',
      'cwd',
      'git_branch',
      'git_commit',
      'started_at',
      'ended_at',
      'duration_ms',
      'model_primary_id',
      'model_changes',
      'mode_primary',
      'mode_changes',
      'effort',
      'uncached_input',
      'cached_input',
      'cache_write',
      'output',
      'reasoning_output',
      'turns',
      'api_calls',
      'tool_calls',
      'compactions',
      'cost_usd',
      'initiator_kind',
      'initiator_surface',
      'initiator_automation',
      'resumed',
      'forked_from',
      'harness_version_first',
      'harness_version_last',
      'source_size',
      'source_mtime',
    ];
    for (const column of cleared) expect(row[column]).toBeNull();
    // Identity and the stub defaults survive.
    expect(row.id).toBe('fake:child');
    expect(row.harness_id).toBe('fake');
    expect(row.source_path).toBe('/fake/child.jsonl');
    expect(row.depth).toBe(0);

    const diags = db
      .query('SELECT code, message FROM diagnostics WHERE session_id = ?')
      .all('fake:child') as { code: string; message: string }[];
    expect(diags).toEqual([{ code: 'bundle-invalid', message: 'session.depth: too_small' }]);

    // The stale exclusive totals can no longer inflate the parent's inclusive rollup.
    recomputeRollups(db);
    const after = db
      .query('SELECT uncached_input, output, descendants FROM rollups WHERE session_id = ?')
      .get('fake:parent') as {
      uncached_input: number | null;
      output: number | null;
      descendants: number;
    };
    expect(after).toEqual({ uncached_input: 1, output: 1, descendants: 0 });
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
    persistWithTitles(db, bundle({ id: 'fake:in', sourcePath: '/fake/in.jsonl' }));
    persistWithTitles(db, bundle({ id: 'fake:out', sourcePath: '/other/out.jsonl' }));

    const known = loadKnown(db, 'fake', ['/fake']);
    expect([...known.keys()]).toEqual(['/fake/in.jsonl']);
  });

  test('a root path itself (exact match, no trailing separator) is included', () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(db, bundle({ id: 'fake:exact', sourcePath: '/fake' }));
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
    persistWithTitles(
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
    persistWithTitles(
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
    persistWithTitles(
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
    persistWithTitles(db, bundle({ id: 'fake:s1', sourcePath: '/fake/s1.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    expect([...known.keys()]).toEqual(['/fake/s1.jsonl']);
  });
});

describe('removeVanished', () => {
  test('deletes sessions whose known path no longer stats, cascading to child tables', async () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
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
    persistWithTitles(db, bundle({ id: 'fake:still-here', sourcePath: '/fake/still-here.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    const fs = createMemoryFs({ files: { '/fake/still-here.jsonl': 'x' } });
    const removed = await removeVanished(db, 'fake', known, new Set(), fs);
    expect(removed).toBe(0);
    expect(db.query('SELECT * FROM sessions WHERE id = ?').all('fake:still-here').length).toBe(1);
  });

  test('a path that was re-emitted this run is not removed even if it no longer stats', async () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(db, bundle({ id: 'fake:emitted', sourcePath: '/fake/emitted.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    const fs = createMemoryFs({ files: {} });
    const removed = await removeVanished(db, 'fake', known, new Set(['/fake/emitted.jsonl']), fs);
    expect(removed).toBe(0);
  });

  test('a row under another root is never removed by a run scoped to /fake', async () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(db, bundle({ id: 'fake:other', sourcePath: '/other/keep.jsonl' }));
    const known = loadKnown(db, 'fake', ['/fake']);
    expect(known.size).toBe(0);
    const fs = createMemoryFs({ files: {} });
    const removed = await removeVanished(db, 'fake', known, new Set(), fs);
    expect(removed).toBe(0);
    expect(db.query('SELECT * FROM sessions WHERE id = ?').all('fake:other').length).toBe(1);
  });

  test('sourceExists returning false deletes a known-but-unemitted source by COALESCE(source_id, source_path)', async () => {
    const { db } = storeWithFakeHarness();
    persistWithTitles(
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
    persistWithTitles(
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
