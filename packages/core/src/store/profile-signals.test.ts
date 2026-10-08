import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readProfileSignals } from './profile-signals';
import { openStore } from './store';

function seed(db: Database): void {
  db.run(
    "INSERT INTO harnesses (id, display_name, adapter_version, capabilities) VALUES ('h', 'H', '1', '[]')",
  );
}
function session(db: Database, id: string, parentId: string | null = null): void {
  db.run('INSERT INTO sessions (id, harness_id, parent_id, source_path) VALUES (?, ?, ?, ?)', [
    id,
    'h',
    parentId,
    `source:${id}`,
  ]);
}
function step(
  db: Database,
  session: string,
  seq: number,
  kind: string,
  opts: {
    category?: string | null;
    toolName?: string | null;
    skillName?: string | null;
    trigger?: string | null;
    mcpServer?: string | null;
    mcpTool?: string | null;
  } = {},
): void {
  db.run(
    'INSERT INTO steps (session_id, seq, kind, tool_category, tool_name, skill_name, compaction_trigger, mcp_server, mcp_tool) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      session,
      seq,
      kind,
      opts.category ?? null,
      opts.toolName ?? null,
      opts.skillName ?? null,
      opts.trigger ?? null,
      opts.mcpServer ?? null,
      opts.mcpTool ?? null,
    ],
  );
}
function toolCount(db: Database, session: string, category: string, count: number): void {
  db.run('INSERT INTO session_tool_counts (session_id, category, count) VALUES (?, ?, ?)', [
    session,
    category,
    count,
  ]);
}

describe('readProfileSignals', () => {
  test('splits compactions by trigger, unknown covers null and unrecognized literals', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, 'compaction', { trigger: 'auto' });
    step(db, 'root', 1, 'compaction', { trigger: 'manual' });
    step(db, 'root', 2, 'compaction', { trigger: 'manual' });
    step(db, 'root', 3, 'compaction', { trigger: null });
    step(db, 'root', 4, 'compaction', { trigger: 'weird-future-literal' });
    const result = readProfileSignals(db, 'root')!;
    expect(result.compactions).toEqual({ auto: 1, manual: 2, unknown: 2 });
    db.close();
  });

  test('counts model changes, MCP calls vs total tool calls, and distinct MCP server names', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, 'model-change');
    step(db, 'root', 1, 'model-change');
    step(db, 'root', 2, 'tool', { category: 'read', toolName: 'Read' });
    step(db, 'root', 3, 'tool', {
      category: 'mcp',
      toolName: 'mcp__plugin_engram_engram__mem_save',
    });
    step(db, 'root', 4, 'tool', { category: 'mcp', toolName: 'mcp__github__list_issues' });
    step(db, 'root', 5, 'tool', {
      category: 'mcp',
      toolName: 'mcp__plugin_engram_engram__mem_search',
    });
    const result = readProfileSignals(db, 'root')!;
    expect(result.modelChanges).toBe(2);
    expect(result.toolCalls).toEqual({ total: 4, mcp: 3 });
    expect(result.mcpServers).toEqual(['github', 'plugin_engram_engram']);
    db.close();
  });

  test('counts skill calls and distinct skill names, empty scope reports zeros/empty arrays', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'no-signals', 'root');
    step(db, 'root', 0, 'tool', { category: 'skill', toolName: 'Skill', skillName: 'pdf-fill' });
    step(db, 'root', 1, 'tool', { category: 'skill', toolName: 'Skill', skillName: 'pdf-fill' });
    step(db, 'root', 2, 'tool', {
      category: 'skill',
      toolName: 'Skill',
      skillName: 'commit-helper',
    });
    step(db, 'no-signals', 0, 'tool', { category: 'read', toolName: 'Read' });
    const result = readProfileSignals(db, 'root')!;
    expect(result.skillCalls).toBe(3);
    expect(result.skillNames).toEqual(['commit-helper', 'pdf-fill']);
    expect(result.mcpServers).toEqual([]);
    const own = readProfileSignals(db, 'no-signals', { scope: 'own' })!;
    expect(own).toMatchObject({
      compactions: { auto: 0, manual: 0, unknown: 0 },
      modelChanges: 0,
      toolCalls: { total: 1, mcp: 0 },
      mcpServers: [],
      skillCalls: 0,
      skillNames: [],
    });
    db.close();
  });

  test('own excludes descendants, tree aggregates the whole scope, and readProfileSignals is null for a missing root', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'child', 'root');
    step(db, 'root', 0, 'tool', { category: 'mcp', toolName: 'mcp__a__x' });
    step(db, 'child', 0, 'tool', { category: 'mcp', toolName: 'mcp__b__y' });
    const own = readProfileSignals(db, 'root', { scope: 'own' })!;
    expect(own.toolCalls).toEqual({ total: 1, mcp: 1 });
    expect(own.mcpServers).toEqual(['a']);
    const tree = readProfileSignals(db, 'root')!;
    expect(tree.toolCalls).toEqual({ total: 2, mcp: 2 });
    expect(tree.mcpServers).toEqual(['a', 'b']);
    expect(readProfileSignals(db, 'missing')).toBeNull();
    db.close();
  });

  test('distinct MCP servers come from the authoritative stored pair, not the raw name', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    step(db, 'root', 0, 'tool', {
      category: 'mcp',
      toolName: 'mcp__raw__thing',
      mcpServer: 'stored-server',
      mcpTool: 'stored_tool',
    });
    step(db, 'root', 1, 'tool', {
      category: 'mcp',
      toolName: 'mcp__plugin_engram_engram__mem_save',
    });
    const result = readProfileSignals(db, 'root')!;
    expect(result.toolCalls).toEqual({ total: 2, mcp: 2 });
    expect(result.mcpServers).toEqual(['plugin_engram_engram', 'stored-server']);
    db.close();
  });

  test('legacy NULL pair falls back to the strict parse; malformed/partial stored pairs stay unknown', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    // Legacy row: no stored identity, canonical Claude name.
    step(db, 'root', 0, 'tool', { category: 'mcp', toolName: 'mcp__legacy__call' });
    // Malformed raw name: still an MCP call, but no fabricated server.
    step(db, 'root', 1, 'tool', { category: 'mcp', toolName: 'mcp__a__b__c' });
    // Partial stored pair never combines with the parsed raw pair.
    step(db, 'root', 2, 'tool', {
      category: 'mcp',
      toolName: 'mcp__raw__thing',
      mcpServer: 'stored-only',
    });
    // Non-MCP category is never classified from a raw mcp-looking name.
    step(db, 'root', 3, 'tool', { category: 'read', toolName: 'mcp__sneaky__tool' });
    const result = readProfileSignals(db, 'root')!;
    expect(result.toolCalls).toEqual({ total: 4, mcp: 3 });
    expect(result.mcpServers).toEqual(['legacy']);
    db.close();
  });

  test('own/tree dedup stored identities without changing the tool/mcp counts', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'child', 'root');
    step(db, 'root', 0, 'tool', {
      category: 'mcp',
      toolName: 'mcp__raw__a',
      mcpServer: 'shared',
      mcpTool: 'a',
    });
    step(db, 'child', 0, 'tool', {
      category: 'mcp',
      toolName: 'mcp__raw__b',
      mcpServer: 'shared',
      mcpTool: 'b',
    });
    step(db, 'child', 1, 'tool', {
      category: 'mcp',
      toolName: 'mcp__raw__c',
      mcpServer: 'child-only',
      mcpTool: 'c',
    });
    const own = readProfileSignals(db, 'root', { scope: 'own' })!;
    expect(own.toolCalls).toEqual({ total: 1, mcp: 1 });
    expect(own.mcpServers).toEqual(['shared']);
    const tree = readProfileSignals(db, 'root')!;
    expect(tree.toolCalls).toEqual({ total: 3, mcp: 3 });
    expect(tree.mcpServers).toEqual(['child-only', 'shared']);
    db.close();
  });

  test('toolCalls.total/.mcp agree with summed session_tool_counts across a multi-session tree (control)', () => {
    const { db } = openStore(':memory:');
    seed(db);
    session(db, 'root');
    session(db, 'child-a', 'root');
    session(db, 'child-b', 'root');
    // Every tool step below carries a category, matching replaceToolCounts'
    // real persist-time derivation (kind='tool' with a defined category).
    step(db, 'root', 0, 'tool', { category: 'read', toolName: 'Read' });
    step(db, 'root', 1, 'tool', { category: 'mcp', toolName: 'mcp__a__x' });
    step(db, 'child-a', 0, 'tool', { category: 'skill', toolName: 'Skill', skillName: 's' });
    step(db, 'child-a', 1, 'tool', { category: 'mcp', toolName: 'mcp__b__y' });
    step(db, 'child-b', 0, 'tool', { category: 'write', toolName: 'Write' });
    toolCount(db, 'root', 'read', 1);
    toolCount(db, 'root', 'mcp', 1);
    toolCount(db, 'child-a', 'skill', 1);
    toolCount(db, 'child-a', 'mcp', 1);
    toolCount(db, 'child-b', 'write', 1);

    const result = readProfileSignals(db, 'root')!;
    const countedTotal = db
      .query('SELECT COALESCE(SUM(count), 0) AS n FROM session_tool_counts')
      .get() as { n: number };
    const countedMcp = db
      .query("SELECT COALESCE(SUM(count), 0) AS n FROM session_tool_counts WHERE category = 'mcp'")
      .get() as { n: number };
    expect(result.toolCalls.total).toBe(countedTotal.n);
    expect(result.toolCalls.mcp).toBe(countedMcp.n);
    expect(result.toolCalls).toEqual({ total: 5, mcp: 2 });
    db.close();
  });
});
