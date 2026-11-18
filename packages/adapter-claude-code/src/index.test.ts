import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, SessionBundle } from '@runwire/core';
import { createBunFs } from '@runwire/core';
import { adapterContract } from '@runwire/core/test-kit';
import { createClaudeCodeAdapter } from './index';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'claude-code');

function contextForFixture(name: string, titles = true): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function collect(ctx: AdapterContext): Promise<SessionBundle[]> {
  const adapter = createClaudeCodeAdapter();
  const out: SessionBundle[] = [];
  for await (const bundle of adapter.discover(ctx, new Map())) out.push(bundle);
  return out;
}

async function bundleFor(ctx: AdapterContext, sessionId: string): Promise<SessionBundle> {
  const bundles = await collect(ctx);
  const found = bundles.find((b) => b.session.id === sessionId);
  if (!found)
    throw new Error(
      `bundle not found: ${sessionId} (have: ${bundles.map((b) => b.session.id).join(', ')})`,
    );
  return found;
}

adapterContract({
  adapter: createClaudeCodeAdapter(),
  ctx: contextForFixture('all'),
  malformedSessionId: 'claude-code:malformed-session',
  canarySentinel: 'RUNWIRE_CANARY_',
});

describe('claude-code adapter: small fixture', () => {
  test('discovers exactly one root session with no diagnostics', async () => {
    const ctx = contextForFixture('small');
    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0];
    expect(bundle?.session.id).toBe('claude-code:ce93c1a2-540a-4692-b016-a452c55ae0de');
    expect(bundle?.session.depth).toBe(0);
    expect(bundle?.diagnostics).toEqual([]);
  });
});

describe('claude-code adapter: medium fixture (the dedupe regression)', () => {
  test('deduped output matches the known-good value, not the naive sum', async () => {
    const ctx = contextForFixture('medium');
    const bundle = await bundleFor(ctx, 'claude-code:3666e64a-bdeb-4ffb-82d4-ad06666a67a8');
    expect(bundle.session.output).toBe(438_086);
    expect(bundle.session.apiCalls).toBe(386);
    expect(bundle.session.compactions).toBeGreaterThanOrEqual(1);
    expect(bundle.session.harnessVersionFirst).not.toBe(bundle.session.harnessVersionLast);
  });
});

describe('claude-code adapter: subagents fixture', () => {
  test('both children link to the root with parentId, agentType, depth and spawnCallId', async () => {
    const ctx = contextForFixture('subagents');
    const rootId = 'claude-code:5db79557-f2ad-489d-81ee-607606b3a6ef';
    const bundles = await collect(ctx);
    const children = bundles.filter((b) => b.session.parentId === rootId);
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.session.relation).toBe('subagent');
      expect(child.session.agentType).toBeTruthy();
      expect(child.session.depth).toBeGreaterThanOrEqual(1);
      expect(child.session.spawnCallId).toBeTruthy();
    }
  });

  test('the root has a compaction, a version change and a model change', async () => {
    const ctx = contextForFixture('subagents');
    const bundle = await bundleFor(ctx, 'claude-code:5db79557-f2ad-489d-81ee-607606b3a6ef');
    expect(bundle.session.compactions).toBeGreaterThanOrEqual(1);
    expect(bundle.session.harnessVersionFirst).not.toBe(bundle.session.harnessVersionLast);
    expect(bundle.session.modelChanges).toBeGreaterThanOrEqual(1);
  });
});

describe('claude-code adapter: old-version fixture', () => {
  test('has no cost and still derives turns from user-message heuristics', async () => {
    const ctx = contextForFixture('old-version');
    const bundle = await bundleFor(ctx, 'claude-code:bdbb0e1e-36e5-4571-bb82-a9b39ba1edec');
    expect(bundle.session.costUsd).toBeUndefined();
    expect(bundle.session.turns).toBeGreaterThan(0);
    expect(bundle.steps.some((s) => s.kind === 'turn')).toBe(true);
  });
});

describe('claude-code adapter: malformed fixture (beyond the generic contract check)', () => {
  test('marks the source truncated and reports specific diagnostic codes', async () => {
    const ctx = contextForFixture('malformed');
    const bundle = await bundleFor(ctx, 'claude-code:malformed-session');
    const codes = bundle.diagnostics.map((d) => d.code);
    expect(codes).toContain('source-truncated');
    expect(codes).toContain('malformed-json-line');
    expect(codes).toContain('unknown-record-type');
    expect(bundle.steps.some((s) => s.kind === 'call')).toBe(true);
  });
});

describe('claude-code adapter: dispatch fixture', () => {
  test('a dispatched cli root is classified machine via the agent-setting marker', async () => {
    const ctx = contextForFixture('dispatch');
    const bundle = await bundleFor(ctx, 'claude-code:edd8b2ff-23be-43e1-85b2-3ae4ff03791a');
    expect(bundle.session.initiatorKind).toBe('machine');
    expect(bundle.session.initiatorSurface).toBe('cli');
    expect(bundle.session.initiatorAutomation).toBe('subagent-dispatch');
  });
});

describe('claude-code adapter: canary fixture (title privacy)', () => {
  test('title is present only when ctx.privacy.titles is on', async () => {
    const on = await bundleFor(contextForFixture('canary', true), 'claude-code:canary-session');
    expect(on.session.title).toBe('TITLE_ALLOWED_BY_D7_EXCEPTION');
    const off = await bundleFor(contextForFixture('canary', false), 'claude-code:canary-session');
    expect(off.session.title).toBeUndefined();
  });

  test('a proven MCP name gets identity, an ambiguous one does not, and no input sentinel leaks', async () => {
    const bundle = await bundleFor(contextForFixture('canary', true), 'claude-code:canary-session');
    const mcpTools = bundle.steps.filter((s) => s.kind === 'tool' && s.toolCategory === 'mcp');
    expect(mcpTools).toHaveLength(2);

    const proven = mcpTools.find((s) => s.toolName === 'mcp__canary_server__canary_tool');
    expect(proven).toMatchObject({ mcpServer: 'canary_server', mcpTool: 'canary_tool' });

    const ambiguous = mcpTools.find((s) => s.toolName === 'mcp__canary_server__canary_tool__extra');
    expect(ambiguous?.mcpServer).toBeUndefined();
    expect(ambiguous?.mcpTool).toBeUndefined();

    expect(JSON.stringify(bundle)).not.toContain('RUNWIRE_CANARY_');
  });
});

describe('claude-code adapter: MCP identity from proven mcp__server__tool names', () => {
  test('the medium fixture emits identity for real MCP tools and keeps every raw toolName', async () => {
    const ctx = contextForFixture('medium');
    const bundle = await bundleFor(ctx, 'claude-code:3666e64a-bdeb-4ffb-82d4-ad06666a67a8');
    const mcpTools = bundle.steps.filter((s) => s.kind === 'tool' && s.toolCategory === 'mcp');
    expect(mcpTools.length).toBeGreaterThan(0);

    const memSave = mcpTools.find((s) => s.toolName === 'mcp__plugin_engram_engram__mem_save');
    expect(memSave).toMatchObject({
      mcpServer: 'plugin_engram_engram',
      mcpTool: 'mem_save',
      toolName: 'mcp__plugin_engram_engram__mem_save',
    });
    expect(mcpTools.some((s) => s.mcpServer === 'chrome-devtools')).toBe(true);

    for (const step of mcpTools) {
      if (step.mcpServer === undefined && step.mcpTool === undefined) continue;
      expect(step.toolName).toBe(`mcp__${step.mcpServer}__${step.mcpTool}`);
    }

    const toolSteps = bundle.steps.filter((s) => s.kind === 'tool');
    expect(bundle.session.toolCalls).toBe(toolSteps.length);
  });

  test('a non-MCP tool in a fixture never gains identity', async () => {
    const ctx = contextForFixture('small');
    const bundles = await collect(ctx);
    const tools = bundles.flatMap((b) => b.steps).filter((s) => s.kind === 'tool');
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.mcpServer).toBeUndefined();
      expect(tool.mcpTool).toBeUndefined();
    }
  });
});

describe('claude-code adapter: metadata', () => {
  test('adapterVersion reflects the MCP-identity output change', () => {
    expect(createClaudeCodeAdapter().adapterVersion).toBe('2.1.0');
  });
});

describe('claude-code adapter: probe', () => {
  test('reports not installed when ~/.claude/projects does not exist', async () => {
    const ctx: AdapterContext = {
      home: '/does/not/exist/at/all',
      platform: 'darwin',
      env: {},
      fs: createBunFs(),
      privacy: { titles: true },
      log: { info() {}, warn() {}, error() {} },
    };
    const adapter = createClaudeCodeAdapter();
    const result = await adapter.probe(ctx);
    expect(result.installed).toBe(false);
    expect(result.roots).toEqual([]);
  });

  test('reports installed with the projects root when the fixture home exists', async () => {
    const ctx = contextForFixture('small');
    const adapter = createClaudeCodeAdapter();
    const result = await adapter.probe(ctx);
    expect(result.installed).toBe(true);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toContain('.claude/projects');
  });
});
