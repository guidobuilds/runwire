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
function modelId(db: Database, name: string): number {
  db.run('INSERT INTO models (name) VALUES (?) ON CONFLICT DO NOTHING', [name]);
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
    mcpServer?: string | null;
    mcpTool?: string | null;
  } = {},
): void {
  db.run(
    'INSERT INTO steps (session_id, seq, kind, tool_category, at, error, model_id, tool_name, duration_ms, compaction_trigger, from_value, to_value, mcp_server, mcp_tool) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      opts.mcpServer ?? null,
      opts.mcpTool ?? null,
    ],
  );
}

describe('readProfileMergedEvents', () => {
  test('emits every variant with a stable action token and metadata-only subject', () => {
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
    const items = readProfileMergedEvents(db, 'root', { scope: 'own' })?.items ?? [];
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
      expect.objectContaining({
        kind: 'call',
        model: 'm',
        error: null,
        action: 'call',
        subject: 'm',
      }),
      expect.objectContaining({
        kind: 'tool',
        category: 'read',
        toolName: 'Read',
        error: true,
        action: 'read',
        subject: 'Read',
      }),
      expect.objectContaining({ kind: 'turn', durationMs: 3, action: 'turn', subject: null }),
      expect.objectContaining({
        kind: 'harness',
        toolName: 'PreToolUse:Bash',
        action: 'harness',
        subject: 'PreToolUse:Bash',
      }),
      expect.objectContaining({
        kind: 'compaction',
        trigger: 'auto',
        action: 'compaction',
        subject: 'auto',
      }),
      expect.objectContaining({
        kind: 'model-change',
        from: 'a',
        to: 'b',
        action: 'model-change',
        subject: 'a → b',
      }),
      expect.objectContaining({
        kind: 'mode-change',
        from: 'x',
        to: 'y',
        action: 'mode-change',
        subject: 'x → y',
      }),
    ]);
    db.close();
  });

  test('a tool step with no category falls back to the tool action token', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', { name: 'Mystery', at: '2025-01-01T00:00:00Z' });
    const [item] = readProfileMergedEvents(db, 'root', { scope: 'own' })?.items ?? [];
    expect(item).toEqual(
      expect.objectContaining({ kind: 'tool', category: null, action: 'tool', subject: 'Mystery' }),
    );
    db.close();
  });

  test('kind and action filters are CSV-style allow-lists and AND together', () => {
    const { db } = openStore(':memory:');
    seed(db);
    for (const [seq, category] of ['read', 'write', 'exec', 'mcp', 'skill', 'agent'].entries())
      step(db, 'root', seq, 'tool', {
        category,
        at: new Date(2025, 0, 1, 0, 0, seq).toISOString(),
      });
    step(db, 'root', 6, 'compaction', { at: '2025-01-01T00:00:06Z' });
    step(db, 'root', 7, 'model-change', { at: '2025-01-01T00:00:07Z' });

    const tools = readProfileMergedEvents(db, 'root', { kind: ['tool'] });
    expect(tools?.items.map((e) => e.action)).toEqual([
      'read',
      'write',
      'exec',
      'mcp',
      'skill',
      'agent',
    ]);
    const actions = readProfileMergedEvents(db, 'root', {
      action: ['mcp', 'agent', 'compaction'],
    });
    expect(actions?.items.map((e) => e.action)).toEqual(['mcp', 'agent', 'compaction']);
    expect(actions?.total).toBe(3);
    db.close();
  });

  test('status ok treats null/0 as OK and error matches only error = 1', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', { category: 'read', error: 0, at: '2025-01-01T00:00:00Z' });
    step(db, 'root', 1, 'tool', { category: 'read', at: '2025-01-01T00:00:01Z' });
    step(db, 'root', 2, 'tool', { category: 'read', error: 1, at: '2025-01-01T00:00:02Z' });
    expect(readProfileMergedEvents(db, 'root', { status: 'ok' })?.items.map((e) => e.seq)).toEqual([
      0, 1,
    ]);
    expect(
      readProfileMergedEvents(db, 'root', { status: 'error' })?.items.map((e) => e.seq),
    ).toEqual([2]);
    db.close();
  });

  test('model filters to an exact model name on call/tool rows only', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'call', { model: 'model-a', at: '2025-01-01T00:00:00Z' });
    step(db, 'root', 1, 'call', { model: 'model-b', at: '2025-01-01T00:00:01Z' });
    step(db, 'root', 2, 'compaction', { trigger: 'auto', at: '2025-01-01T00:00:02Z' });
    const filtered = readProfileMergedEvents(db, 'root', { model: 'model-a' });
    expect(filtered?.items.map((e) => e.seq)).toEqual([0]);
    db.close();
  });

  test('q searches action, subject and model metadata and escapes LIKE wildcards', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', {
      category: 'read',
      name: 'Needle%A',
      at: '2025-01-01T00:00:00Z',
    });
    step(db, 'root', 1, 'tool', { category: 'exec', name: 'bash', at: '2025-01-01T00:00:01Z' });
    step(db, 'root', 2, 'call', { model: 'model-x', at: '2025-01-01T00:00:02Z' });
    expect(readProfileMergedEvents(db, 'root', { q: 'Needle%A' })?.items.map((e) => e.seq)).toEqual(
      [0],
    );
    expect(readProfileMergedEvents(db, 'root', { q: '%' })?.items.map((e) => e.seq)).toEqual([0]);
    expect(readProfileMergedEvents(db, 'root', { q: 'model-x' })?.items.map((e) => e.seq)).toEqual([
      2,
    ]);
    expect(readProfileMergedEvents(db, 'root', { q: 'exec' })?.items.map((e) => e.seq)).toEqual([
      1,
    ]);
    db.close();
  });

  test('sorts by a whitelisted field and direction with a stable tie-break', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'agent-b', 0, 'tool', { category: 'mcp', at: '2025-01-01T00:00:01Z' });
    step(db, 'agent-a', 0, 'tool', { category: 'read', at: '2025-01-01T00:00:01Z' });
    step(db, 'root', 0, 'compaction', { trigger: 'manual', at: '2025-01-01T00:00:03Z' });
    step(db, 'root', 1, 'tool', { category: 'read', error: 1, at: '2025-01-01T00:00:02Z' });

    const timeAsc = readProfileMergedEvents(db, 'root')!;
    expect(timeAsc.sort).toBe('time');
    expect(timeAsc.dir).toBe('asc');
    expect(timeAsc.items.map((e) => [e.streamId, e.seq])).toEqual([
      ['agent-a', 0],
      ['agent-b', 0],
      ['root', 1],
      ['root', 0],
    ]);

    const timeDesc = readProfileMergedEvents(db, 'root', { sort: 'time', dir: 'desc' })!;
    expect(timeDesc.items.map((e) => e.seq)).toEqual([0, 1, 0, 0]);

    const byAction = readProfileMergedEvents(db, 'root', { sort: 'action' })!;
    expect(byAction.items.map((e) => e.action)).toEqual(['compaction', 'mcp', 'read', 'read']);

    const byStatus = readProfileMergedEvents(db, 'root', { sort: 'status', dir: 'desc' })!;
    expect(byStatus.items[0]?.error).toBe(true);
    db.close();
  });

  test('sorts by subject across kinds (null turn subject first ASC)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'turn', { at: '2025-01-01T00:00:00Z' });
    step(db, 'root', 1, 'tool', { category: 'read', name: 'alpha', at: '2025-01-01T00:00:01Z' });
    step(db, 'root', 2, 'compaction', { trigger: 'beta', at: '2025-01-01T00:00:02Z' });
    const asc = readProfileMergedEvents(db, 'root', { sort: 'subject' })!;
    expect(asc.items.map((e) => e.subject)).toEqual([null, 'alpha', 'beta']);
    const desc = readProfileMergedEvents(db, 'root', { sort: 'subject', dir: 'desc' })!;
    expect(desc.items.map((e) => e.subject)).toEqual(['beta', 'alpha', null]);
    db.close();
  });

  test('merges across sessions and excludes/counts null-at rows without dropping timed rows', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'agent-a', 0, 'tool', { category: 'mcp', at: '2025-01-01T00:00:01Z' });
    step(db, 'agent-a', 1, 'tool', { category: 'mcp', at: '2025-01-01T00:00:01Z' });
    step(db, 'agent-b', 0, 'tool', { category: 'skill', at: '2025-01-01T00:00:01Z' });
    step(db, 'root', 0, 'compaction', { at: '2025-01-01T00:00:02Z' });
    step(db, 'agent-a', 2, 'model-change', { at: null });
    const result = readProfileMergedEvents(db, 'root')!;
    expect(result.items.map((e) => [e.streamId, e.seq, e.at])).toEqual([
      ['agent-a', 0, '2025-01-01T00:00:01Z'],
      ['agent-a', 1, '2025-01-01T00:00:01Z'],
      ['agent-b', 0, '2025-01-01T00:00:01Z'],
      ['root', 0, '2025-01-01T00:00:02Z'],
    ]);
    expect(result.total).toBe(4);
    expect(result.excludedNullAtCount).toBe(1);
    db.close();
  });

  test('tool events expose the nullable stored mcpServer/mcpTool and keep raw toolName/subject', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', {
      category: 'mcp',
      name: 'mcp__raw__thing',
      mcpServer: 'stored-server',
      mcpTool: 'stored_tool',
      at: '2025-01-01T00:00:00Z',
    });
    step(db, 'root', 1, 'tool', {
      category: 'read',
      name: 'Read',
      at: '2025-01-01T00:00:01Z',
    });
    const items = readProfileMergedEvents(db, 'root', { scope: 'own' })?.items ?? [];
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'tool',
        category: 'mcp',
        toolName: 'mcp__raw__thing',
        subject: 'mcp__raw__thing',
        mcpServer: 'stored-server',
        mcpTool: 'stored_tool',
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        kind: 'tool',
        category: 'read',
        toolName: 'Read',
        subject: 'Read',
        mcpServer: null,
        mcpTool: null,
      }),
    );
    db.close();
  });

  test('legacy NULL pair resolves strictly; malformed/partial pairs stay null', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', {
      category: 'mcp',
      name: 'mcp__legacy__call',
      at: '2025-01-01T00:00:00Z',
    });
    step(db, 'root', 1, 'tool', {
      category: 'mcp',
      name: 'mcp__a__b__c',
      at: '2025-01-01T00:00:01Z',
    });
    step(db, 'root', 2, 'tool', {
      category: 'mcp',
      name: 'mcp__raw__thing',
      mcpServer: 'stored-only',
      at: '2025-01-01T00:00:02Z',
    });
    const items = readProfileMergedEvents(db, 'root', { scope: 'own' })?.items ?? [];
    expect(items.map((event) => event.kind === 'tool' && event.mcpServer)).toEqual([
      'legacy',
      null,
      null,
    ]);
    expect(items[0]).toEqual(
      expect.objectContaining({ mcpTool: 'call', toolName: 'mcp__legacy__call' }),
    );
    db.close();
  });

  test('q matches the stored server/tool in SQL before LIMIT/OFFSET, alongside the raw subject', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', {
      category: 'mcp',
      name: 'mcp__raw__alpha',
      mcpServer: 'stored-a',
      mcpTool: 'run',
      at: '2025-01-01T00:00:00Z',
    });
    step(db, 'root', 1, 'tool', {
      category: 'mcp',
      name: 'mcp__raw__beta',
      mcpServer: 'stored-b',
      mcpTool: 'run',
      at: '2025-01-01T00:00:01Z',
    });
    step(db, 'root', 2, 'tool', {
      category: 'mcp',
      name: 'mcp__raw__gamma',
      mcpServer: 'stored-a',
      mcpTool: 'stop',
      at: '2025-01-01T00:00:02Z',
    });

    const byServer = readProfileMergedEvents(db, 'root', { q: 'stored-a' })!;
    expect(byServer.total).toBe(2);
    expect(byServer.items.map((e) => e.seq)).toEqual([0, 2]);

    expect(readProfileMergedEvents(db, 'root', { q: 'run' })!.items.map((e) => e.seq)).toEqual([
      0, 1,
    ]);

    const page1 = readProfileMergedEvents(db, 'root', { q: 'stored-a', limit: 1, offset: 0 })!;
    const page2 = readProfileMergedEvents(db, 'root', { q: 'stored-a', limit: 1, offset: 1 })!;
    expect(page1.total).toBe(2);
    expect(page1.items.map((e) => e.seq)).toEqual([0]);
    expect(page2.total).toBe(2);
    expect(page2.items.map((e) => e.seq)).toEqual([2]);

    expect(
      readProfileMergedEvents(db, 'root', { q: 'raw__beta' })!.items.map((e) => e.seq),
    ).toEqual([1]);
    db.close();
  });

  test('limit defaults to 50 clamped to [1,200] and offset to >=0, and pages in order', () => {
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
    expect(
      readProfileMergedEvents(db, 'root', { limit: 2, offset: 2 })!.items.map((e) => e.seq),
    ).toEqual([2, 3]);
    expect(
      readProfileMergedEvents(db, 'root', { limit: 2, offset: 4 })!.items.map((e) => e.seq),
    ).toEqual([4]);
    expect(readProfileMergedEvents(db, 'root', { limit: 0 })!.limit).toBe(1);
    expect(readProfileMergedEvents(db, 'root', { limit: 9999 })!.limit).toBe(200);
    expect(readProfileMergedEvents(db, 'root', { offset: -5 })!.offset).toBe(0);
    expect(readProfileMergedEvents(db, 'missing')).toBeNull();
    db.close();
  });

  test('scope own isolates the root, tree covers descendants', () => {
    const { db } = openStore(':memory:');
    seed(db);
    step(db, 'root', 0, 'tool', { category: 'mcp', at: '2025-01-01T00:00:01Z' });
    step(db, 'agent-a', 0, 'tool', { category: 'mcp', at: '2025-01-01T00:00:02Z' });
    step(db, 'outside', 0, 'tool', { category: 'mcp', at: '2025-01-01T00:00:03Z' });
    expect(
      readProfileMergedEvents(db, 'root', { scope: 'own' })?.items.map((e) => e.streamId),
    ).toEqual(['root']);
    expect(
      readProfileMergedEvents(db, 'root', { scope: 'tree' })?.items.map((e) => e.streamId),
    ).toEqual(['root', 'agent-a']);
    db.close();
  });
});
