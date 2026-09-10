import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readProfileMergedEvents } from './profile-events';
import { openStore } from './store';

function seed(db: Database): void {
  db.run(
    "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('test', 'Test', '1', '[]')",
  );
  for (const [id, parent] of [
    ['root', null],
    ['agent-a', 'root'],
    ['agent-b', 'root'],
    ['outside', null],
  ] as const)
    db.run(
      "INSERT INTO sessions (id, harness_id, parent_id, source_path) VALUES (?, 'test', ?, ?)",
      [id, parent, `source:${id}`],
    );
}
/** Idempotently upserts a raw model string and returns its `models.id`. */
function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
  return (db.query('SELECT id FROM models WHERE name = ?').get(name) as { id: number }).id;
}
function step(
  db: Database,
  session: string,
  seq: number,
  kind: string,
  opts: {
    category?: string;
    at?: string | null;
    error?: number;
    model?: string;
    name?: string;
    duration?: number;
    trigger?: string;
    from?: string;
    to?: string;
  } = {},
): void {
  db.run(
    'INSERT INTO steps (session_id, seq, kind, tool_category, at, error, model_id, tool_name, duration_ms, compaction_trigger, from_value, to_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      session,
      seq,
      kind,
      opts.category ?? null,
      opts.at ?? null,
      opts.error ?? null,
      opts.model == null ? null : modelId(db, opts.model),
      opts.name ?? null,
      opts.duration ?? null,
      opts.trigger ?? null,
      opts.from ?? null,
      opts.to ?? null,
    ],
  );
}

describe('readProfileMergedEvents', () => {
  test('emits each of the seven exact metadata-only variants without duplication', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'call', { model: 'm', at: '2025-01-01T00:00:00Z' });
    step(db, 'root', 1, 'tool', {
      category: 'read',
      name: 'Read',
      error: 1,
      at: '2025-01-01T00:00:01Z',
    });
    step(db, 'root', 2, 'turn', { duration: 3, at: '2025-01-01T00:00:02Z' });
    step(db, 'root', 3, 'harness', { name: 'PreToolUse:Bash', at: '2025-01-01T00:00:03Z' });
    step(db, 'root', 4, 'compaction', { trigger: 'auto', at: '2025-01-01T00:00:04Z' });
    step(db, 'root', 5, 'model-change', { from: 'a', to: 'b', at: '2025-01-01T00:00:05Z' });
    step(db, 'root', 6, 'mode-change', { from: 'x', to: 'y', at: '2025-01-01T00:00:06Z' });
    const items = readProfileMergedEvents(db, 'root', { scope: 'own', filter: 'all' })?.items ?? [];
    expect(items.map((event) => event.kind)).toEqual([
      'call',
      'tool',
      'turn',
      'harness',
      'compaction',
      'model-change',
      'mode-change',
    ]);
    expect(items).toEqual([
      expect.objectContaining({ kind: 'call', model: 'm', error: null }),
      expect.objectContaining({ kind: 'tool', category: 'read', toolName: 'Read', error: true }),
      expect.objectContaining({ kind: 'turn', durationMs: 3 }),
      expect.objectContaining({ kind: 'harness', toolName: 'PreToolUse:Bash' }),
      expect.objectContaining({ kind: 'compaction', trigger: 'auto' }),
      expect.objectContaining({ kind: 'model-change', from: 'a', to: 'b' }),
      expect.objectContaining({ kind: 'mode-change', from: 'x', to: 'y' }),
    ]);
    db.close();
  });

  test('relevant is exactly MCP/skill/agent/hooks/changes/compaction/errors and filters run in SQL', () => {
    const { db } = openStore(':memory:');
    seed(db);
    for (const [seq, category] of ['read', 'write', 'exec', 'mcp', 'skill', 'agent'].entries())
      step(db, 'root', seq, 'tool', {
        category,
        at: new Date(2025, 0, 1, 0, 0, seq).toISOString(),
      });
    step(db, 'root', 6, 'harness', { at: '2025-01-01T00:00:06Z' });
    step(db, 'root', 7, 'compaction', { at: '2025-01-01T00:00:07Z' });
    step(db, 'root', 8, 'model-change', { at: '2025-01-01T00:00:08Z' });
    step(db, 'root', 9, 'mode-change', { at: '2025-01-01T00:00:09Z' });
    step(db, 'root', 10, 'tool', { category: 'read', error: 1, at: '2025-01-01T00:00:10Z' });
    const relevant = readProfileMergedEvents(db, 'root', { scope: 'own', filter: 'relevant' });
    expect(relevant?.total).toBe(8);
    expect(relevant?.items.map((e) => e.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(
      readProfileMergedEvents(db, 'root', { scope: 'own', filter: 'read' })?.items.map(
        (e) => e.seq,
      ),
    ).toEqual([0, 10]);
    expect(
      readProfileMergedEvents(db, 'root', { scope: 'own', filter: 'error' })?.items.map(
        (e) => e.seq,
      ),
    ).toEqual([10]);
    db.close();
  });

  test('signals is a curated subset of relevant (no hook/harness/mode-change)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    for (const [seq, category] of ['read', 'write', 'exec', 'mcp', 'skill', 'agent'].entries())
      step(db, 'root', seq, 'tool', {
        category,
        at: new Date(2025, 0, 1, 0, 0, seq).toISOString(),
      });
    step(db, 'root', 6, 'harness', { at: '2025-01-01T00:00:06Z' });
    step(db, 'root', 7, 'compaction', { at: '2025-01-01T00:00:07Z' });
    step(db, 'root', 8, 'model-change', { at: '2025-01-01T00:00:08Z' });
    step(db, 'root', 9, 'mode-change', { at: '2025-01-01T00:00:09Z' });
    step(db, 'root', 10, 'tool', { category: 'read', error: 1, at: '2025-01-01T00:00:10Z' });
    const relevant = readProfileMergedEvents(db, 'root', { scope: 'own', filter: 'relevant' });
    const signals = readProfileMergedEvents(db, 'root', { scope: 'own', filter: 'signals' });
    expect(relevant?.items.map((e) => e.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(signals?.items.map((e) => e.seq)).toEqual([3, 4, 5, 7, 8, 10]);
    expect(signals?.items.some((e) => e.kind === 'harness')).toBe(false);
    expect(signals?.items.some((e) => e.kind === 'mode-change')).toBe(false);
    db.close();
  });

  test('merges across sessions in true at-ASC chronological order with a (sessionId, seq) tie-break, excluding/counting null-at rows', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'agent-a', 0, 'tool', { category: 'mcp', at: '2025-01-01T00:00:01Z' });
    step(db, 'agent-a', 1, 'tool', { category: 'mcp', at: '2025-01-01T00:00:01Z' });
    step(db, 'agent-b', 0, 'tool', { category: 'skill', at: '2025-01-01T00:00:01Z' });
    step(db, 'root', 0, 'compaction', { at: '2025-01-01T00:00:02Z' });
    step(db, 'root', 1, 'tool', { category: 'read', at: '2025-01-01T00:00:03Z' });
    step(db, 'agent-a', 2, 'model-change', { at: null });
    const result = readProfileMergedEvents(db, 'root')!;
    expect(result.filter).toBe('signals');
    expect(result.items.map((e) => [e.streamId, e.seq, e.at])).toEqual([
      ['agent-a', 0, '2025-01-01T00:00:01Z'],
      ['agent-a', 1, '2025-01-01T00:00:01Z'],
      ['agent-b', 0, '2025-01-01T00:00:01Z'],
      ['root', 0, '2025-01-01T00:00:02Z'],
    ]);
    expect(result.total).toBe(4);
    expect(result.excludedNullAtCount).toBe(1);
    const all = readProfileMergedEvents(db, 'root', { filter: 'all' })!;
    expect(all.total).toBe(5); // signals' 4 plus the excluded (by signals) 'read' tool call
    expect(all.excludedNullAtCount).toBe(1);
    db.close();
  });

  test('excludes and counts null-at rows without inventing or dropping timed rows', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'agent-a', 0, 'tool', { category: 'mcp', at: '2025-01-01T00:00:01Z' });
    step(db, 'agent-b', 0, 'tool', { category: 'skill', at: '2025-01-01T00:00:02Z' });
    step(db, 'agent-b', 1, 'tool', { category: 'skill', at: null });
    step(db, 'root', 0, 'compaction', { at: '2025-01-01T00:00:03Z' });
    step(db, 'root', 1, 'tool', { category: 'read', at: '2025-01-01T00:00:04Z' });
    const merged = readProfileMergedEvents(db, 'root', { filter: 'signals' })!;
    const fromMerged = merged.items.map((e) => `${e.streamId}:${e.seq}`).sort();
    expect(fromMerged).toEqual(['agent-a:0', 'agent-b:0', 'root:0'].sort());
    expect(fromMerged).toHaveLength(3);
    expect(merged.excludedNullAtCount).toBe(1);
    db.close();
  });

  test('limit defaults to 50 clamped to [1,200] and offset to >=0, and pages through in order', () => {
    const { db } = openStore(':memory:');
    seed(db);
    for (let i = 0; i < 5; i += 1)
      step(db, 'root', i, 'tool', {
        category: 'mcp',
        at: new Date(2025, 0, 1, 0, 0, i).toISOString(),
      });
    const page1 = readProfileMergedEvents(db, 'root', { limit: 2, offset: 0 })!;
    expect(page1.items.map((e) => e.seq)).toEqual([0, 1]);
    expect(page1.limit).toBe(2);
    const page2 = readProfileMergedEvents(db, 'root', { limit: 2, offset: 2 })!;
    expect(page2.items.map((e) => e.seq)).toEqual([2, 3]);
    const page3 = readProfileMergedEvents(db, 'root', { limit: 2, offset: 4 })!;
    expect(page3.items.map((e) => e.seq)).toEqual([4]);
    expect(readProfileMergedEvents(db, 'root', { limit: 0 })!.limit).toBe(1);
    expect(readProfileMergedEvents(db, 'root', { limit: 9999 })!.limit).toBe(200);
    expect(readProfileMergedEvents(db, 'root', { offset: -5 })!.offset).toBe(0);
    expect(readProfileMergedEvents(db, 'missing')).toBeNull();
    db.close();
  });

  test('tool rows carry the source step model (value when seeded, null when absent)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', {
      category: 'read',
      name: 'Read',
      model: 'model-x',
      at: '2025-01-01T00:00:00Z',
    });
    step(db, 'root', 1, 'tool', {
      category: 'write',
      name: 'Write',
      at: '2025-01-01T00:00:01Z',
    });
    const items = readProfileMergedEvents(db, 'root', { scope: 'own', filter: 'all' })?.items ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'tool',
        category: 'read',
        toolName: 'Read',
        model: 'model-x',
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({ kind: 'tool', category: 'write', toolName: 'Write', model: null }),
    );
    db.close();
  });
});
