import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readProfileLanes } from './profile-lanes';
import { openStore } from './store';

let db: Database;
const AT = '2026-01-01T00:00:00.000Z';
const TRAILING_COMPACTION = {
  kind: 'compaction',
  trigger: null,
  preTokens: null,
  postTokens: null,
  after: true,
} as const;

function session(
  id: string,
  parent: string | null = null,
  started: string | null = null,
  spawn: string | null = null,
): void {
  db.run(
    `INSERT INTO sessions
      (id, harness_id, parent_id, started_at, spawn_call_id, agent_type, source_path, title)
     VALUES (?, 'h', ?, ?, ?, 'worker', ?, 'SECRET_TITLE')`,
    [id, parent, started, spawn, `SECRET_PATH:${id}`],
  );
}

function step(seq: number, kind: string, fields: Record<string, SQLQueryBindings> = {}): void {
  const values = { session_id: 'root', seq, kind, at: AT, ...fields };
  db.run(
    `INSERT INTO steps (${Object.keys(values).join(', ')})
     VALUES (${Object.keys(values)
       .map(() => '?')
       .join(', ')})`,
    Object.values(values),
  );
}

function read(scope: 'own' | 'tree' = 'tree') {
  const response = readProfileLanes(db, 'root', { scope });
  if (response === null) throw new Error('expected lanes');
  return response;
}

function calls() {
  const agent = read().agents[0];
  if (agent === undefined) throw new Error('expected root agent');
  return agent.calls;
}

beforeEach(() => {
  db = openStore(':memory:').db;
  db.run(`INSERT INTO harnesses VALUES ('h', 'Harness', '1', '[]', NULL)`);
  session('root');
});
afterEach(() => db.close());

describe('readProfileLanes', () => {
  test('attaches tools by previous seq within each agent and applies kind priority', () => {
    step(0, 'tool', { tool_category: 'write' });
    step(10, 'call', { output: 1 });
    step(11, 'tool', { tool_category: 'read' });
    step(12, 'tool', { tool_category: 'search', error: 1 });
    step(13, 'tool', { tool_category: 'exec' });
    step(20, 'call', { output: 2 });
    for (const [index, category] of ['other', 'read', 'exec', 'write', 'mcp', 'agent'].entries()) {
      step(21 + index, 'tool', { tool_category: category });
    }
    step(27, 'tool', { tool_category: 'skill', error: 1 });
    step(30, 'call', { output: 3 });
    session('child', 'root');
    step(1, 'call', { session_id: 'child', output: 1 });
    step(2, 'tool', { session_id: 'child', tool_category: 'write' });
    const c = calls();
    expect(c.seq).toEqual([10, 20, 30]);
    expect(c.kind).toEqual(['exec', 'agent', 'reply']);
    expect(c.tools).toEqual([3, 7, 0]);
    expect(c.mechanical).toEqual([true, false, false]);
    expect(c.failed).toEqual([1, 1, 0]);
    expect(c.mcp).toEqual([0, 1, 0]);
    expect(c.skill).toEqual([0, 1, 0]);
    expect(read().agents[1]?.calls.tools).toEqual([1]);
  });

  test('classifies every category, missing and malformed categories without leaking names', () => {
    const categories = [
      'agent',
      'mcp',
      'write',
      'exec',
      'read',
      'search',
      'plan',
      'web',
      'skill',
      'other',
      null,
      'malformed',
    ];
    for (const [index, category] of categories.entries()) {
      step(index * 2, 'call', { output: 0 });
      step(index * 2 + 1, 'tool', { tool_category: category });
    }
    expect(calls().kind).toEqual([
      'agent',
      'mcp',
      'write',
      'exec',
      'look',
      'look',
      'other',
      'other',
      'other',
      'other',
      'other',
      'other',
    ]);
    expect(calls().mechanical).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test('attaches events to the next call and trailing events to the last with after', () => {
    step(0, 'compaction', { compaction_trigger: 'auto', pre_tokens: 100, post_tokens: 25 });
    step(1, 'model-change', { from_value: 'old', to_value: 'new' });
    step(2, 'call', { output: 1 });
    step(3, 'compaction', { compaction_trigger: 'manual' });
    step(4, 'call', { output: 2 });
    step(5, 'model-change', { from_value: 'new', to_value: 'last' });
    step(6, 'compaction');
    step(7, 'turn');
    step(8, 'harness');
    step(9, 'mode-change', { from_value: 'SECRET_MODE' });
    expect(calls().events).toEqual([
      [
        { kind: 'compaction', trigger: 'auto', preTokens: 100, postTokens: 25 },
        { kind: 'model-change', from: 'old', to: 'new' },
      ],
      [
        { kind: 'compaction', trigger: 'manual', preTokens: null, postTokens: null },
        { kind: 'model-change', from: 'new', to: 'last', after: true },
        TRAILING_COMPACTION,
      ],
    ]);
  });

  test('drops echoes and null-at calls, preserves zero versus missing tokens and column lengths', () => {
    step(0, 'call');
    step(1, 'call', { at: null, output: 9 });
    step(2, 'call', { at: null });
    step(3, 'call', { uncached_input: 0 });
    step(4, 'call', { cached_input: 20, cache_write: 5, uncached_input: 10 });
    step(5, 'call', { output: 0 });
    step(6, 'call');
    step(7, 'tool', { tool_category: 'write' });
    step(8, 'compaction');
    const res = read();
    const c = calls();
    expect(res.callCount).toBe(3);
    expect(res.excludedNullAtCount).toBe(2);
    expect(c.seq).toEqual([3, 4, 5]);
    expect(c.at).toEqual([AT, AT, AT]);
    expect(c.promptInput).toEqual([0, 35, null]);
    expect(c.output).toEqual([null, null, 0]);
    // The discarded echo remains a seq boundary: its tools do not migrate backwards.
    expect(c.tools).toEqual([0, 0, 0]);
    expect(c.events[2]).toEqual([TRAILING_COMPACTION]);
    for (const column of Object.values(c)) expect(column).toHaveLength(3);
  });

  test('orders a three-level tree DFS with null-first startedAt and id ties, own stays own', () => {
    session('late', 'root', '2026-02-01', 'spawn-late');
    session('b', 'root', AT, 'spawn-b');
    session('a', 'root', AT, 'spawn-a');
    session('null', 'root');
    session('grand', 'a', null, 'spawn-grand');
    session('outside');
    step(0, 'call', { output: 1 });
    step(1, 'tool', { tool_category: 'agent', call_id: 'spawn-a' });
    step(2, 'tool', { tool_category: 'agent', call_id: 'spawn-b' });
    step(0, 'call', { session_id: 'a', output: 2 });
    step(1, 'tool', { session_id: 'a', tool_category: 'agent', call_id: 'spawn-grand' });
    step(0, 'call', { session_id: 'outside', output: 999 });
    expect(
      read().agents.map(({ id, parentId, depth, spawnCallId }) => ({
        id,
        parentId,
        depth,
        spawnCallId,
      })),
    ).toEqual([
      { id: 'root', parentId: null, depth: 0, spawnCallId: null },
      { id: 'null', parentId: 'root', depth: 1, spawnCallId: null },
      { id: 'a', parentId: 'root', depth: 1, spawnCallId: 'spawn-a' },
      { id: 'grand', parentId: 'a', depth: 2, spawnCallId: 'spawn-grand' },
      { id: 'b', parentId: 'root', depth: 1, spawnCallId: 'spawn-b' },
      { id: 'late', parentId: 'root', depth: 1, spawnCallId: 'spawn-late' },
    ]);
    expect(calls().spawns).toEqual([['a', 'b']]);
    expect(read().agents.find((a) => a.id === 'a')?.calls.spawns).toEqual([['grand']]);
    expect(read('own').agents.map((a) => a.id)).toEqual(['root']);
    expect(read('own').agents[0]?.calls.spawns).toEqual([['a', 'b']]);
    expect(read('own').callCount).toBe(1);
    expect(read().callCount).toBe(2);
  });

  test('indexes models once with catalog metadata and uses -1 for absent models', () => {
    db.run(`INSERT INTO models (id, name) VALUES (1, 'claude-opus-4'), (2, 'unlisted')`);
    step(0, 'call', { output: 1, model_id: 1 });
    step(1, 'call', { output: 1, model_id: 2 });
    step(2, 'call', { output: 1 });
    step(3, 'call', { output: 1, model_id: 1 });
    expect(calls().model).toEqual([0, 1, -1, 0]);
    expect(read().models).toEqual([
      { name: 'claude-opus-4', contextWindow: 500_000, tier: 'high' },
      { name: 'unlisted', contextWindow: null, tier: null },
    ]);
  });

  test('resolves the window per (provider, name) with overrides at request time', () => {
    // Same model name through two providers: two rows since .
    db.run(
      `INSERT INTO models (id, provider, name) VALUES (1, 'openai', 'gpt-6.1-sol'), (2, 'openai-codex', 'gpt-6.1-sol')`,
    );
    step(0, 'call', { output: 1, model_id: 1 });
    step(1, 'call', { output: 1, model_id: 2 });
    const response = readProfileLanes(db, 'root', { scope: 'tree' }, [
      { provider: 'openai', model: 'gpt-6.1-sol', contextWindow: 500_000 },
    ]);
    if (response === null) throw new Error('expected lanes');
    // Exact provider/model override wins for openai; the codex row falls to the
    // exact-name built-in (1,050,000) — both dedup into distinct LaneModel rows.
    expect(response.models).toEqual([
      { name: 'gpt-6.1-sol', contextWindow: 500_000, tier: 'high' },
      { name: 'gpt-6.1-sol', contextWindow: 1_050_000, tier: 'high' },
    ]);
    expect(response.agents[0]?.calls.model).toEqual([0, 1]);
  });

  test('without overrides the built-in cascade resolves both provider rows to the same window', () => {
    db.run(
      `INSERT INTO models (id, provider, name) VALUES (1, 'openai', 'gpt-6.1-sol'), (2, 'openai-codex', 'gpt-6.1-sol')`,
    );
    step(0, 'call', { output: 1, model_id: 1 });
    step(1, 'call', { output: 1, model_id: 2 });
    expect(read().models).toEqual([
      { name: 'gpt-6.1-sol', contextWindow: 1_050_000, tier: 'high' },
      { name: 'gpt-6.1-sol', contextWindow: 1_050_000, tier: 'high' },
    ]);
  });

  test('returns only the metadata allowlist, never tool, MCP, skill, path or title values', () => {
    step(0, 'call', { output: 1 });
    step(1, 'tool', {
      tool_category: 'mcp',
      tool_name: 'SECRET_TOOL',
      mcp_server: 'SECRET_MCP',
      mcp_tool: 'SECRET_MCP_TOOL',
      skill_name: 'SECRET_SKILL',
    });
    const res = read();
    expect(JSON.stringify(res)).not.toContain('SECRET');
    expect(Object.keys(res).sort()).toEqual([
      'agents',
      'callCount',
      'excludedNullAtCount',
      'models',
      'scope',
      'sessionId',
    ]);
    expect(Object.keys(res.agents[0] ?? {}).sort()).toEqual([
      'agentType',
      'calls',
      'depth',
      'id',
      'parentId',
      'spawnCallId',
    ]);
    expect(Object.keys(calls()).sort()).toEqual([
      'at',
      'events',
      'failed',
      'kind',
      'mcp',
      'mechanical',
      'model',
      'output',
      'promptInput',
      'seq',
      'skill',
      'spawns',
      'tools',
    ]);
  });

  test('distinguishes empty existing sessions from missing ones and terminates parent cycles', () => {
    expect(read().agents).toHaveLength(1);
    expect(read().callCount).toBe(0);
    expect(read().models).toEqual([]);
    expect(readProfileLanes(db, 'missing', { scope: 'tree' })).toBeNull();
    session('child', 'root');
    db.run(`UPDATE sessions SET parent_id = 'child' WHERE id = 'root'`);
    expect(read().agents.map((a) => a.id)).toEqual(['root', 'child']);
  });
});
