import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterContext, SessionBundle } from '@runwire/core';
import { createBunFs, createMemoryFs, validateBundle } from '@runwire/core';
import { createGentleShellAdapter } from './index';
import { gentleToolCategory } from './tool-category';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', '..', 'fixtures', 'gentle-shell');

function contextForFixture(name: string): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function collect(ctx: AdapterContext, known = new Map()): Promise<SessionBundle[]> {
  const adapter = createGentleShellAdapter();
  const out: SessionBundle[] = [];
  for await (const bundle of adapter.discover(ctx, known)) out.push(bundle);
  return out;
}

function memoryContext(piParent = false): AdapterContext {
  const root = '/home/u/.gentle-shell/agent';
  const parentRoot = piParent ? '/home/u/.pi/agent' : root;
  const file = (uuid: string) => `2026-01-01T00-00-00-000Z_${uuid}.jsonl`;
  const session = (id: string) =>
    `${JSON.stringify({ type: 'session', version: 3, id, cwd: '/project' })}\n`;
  const files: Record<string, string> = {
    [`${parentRoot}/sessions/--project--/${file('parent')}`]: session('parent'),
    [`${root}/gentle-agents/sessions/${file('child')}`]: session('child'),
    [`${root}/gentle-agents/sessions/${file('grandchild')}`]: session('grandchild'),
    [`${root}/gentle-agents/tasks/one.json`]: JSON.stringify({
      task: {
        id: 'one',
        agent: 'worker',
        parentSessionId: 'parent',
        sessionPath: file('child'),
        tokens: 999999,
        cost: 999999,
        turns: 999999,
        toolCalls: 999999,
      },
    }),
    [`${root}/gentle-agents/tasks/two.json`]: JSON.stringify({
      task: {
        id: 'two',
        agent: 'verify',
        parentSessionId: 'child',
        sessionPath: file('grandchild'),
      },
    }),
    [`${root}/gentle-agents/tasks/bad.json`]: '{',
  };
  const ctx = contextForFixture('small');
  return { ...ctx, home: '/home/u', fs: createMemoryFs({ files }) };
}

describe('gentle-shell compute and linkage', () => {
  test('tool categories extend the exact Pi map without diagnosing unknown names', () => {
    for (const [name, category] of Object.entries({
      subagent_run: 'agent',
      codemode: 'exec',
      mem_search: 'search',
      unknown: 'other',
      powershell: 'exec',
      read: 'read',
      mcp: 'mcp',
      web_search: 'web',
    } as const))
      expect(gentleToolCategory(name)).toBe(category);
  });
  test('transitive ledger depth and invalid files are surfaced once without ledger spend', async () => {
    const bundles = await collect(memoryContext());
    expect(bundles.find((b) => b.session.id === 'gentle-shell:child')?.session).toMatchObject({
      parentId: 'gentle-shell:parent',
      depth: 1,
    });
    const grandchild = bundles.find((b) => b.session.id === 'gentle-shell:grandchild');
    expect(grandchild?.session).toMatchObject({ parentId: 'gentle-shell:child', depth: 2 });
    expect(grandchild?.diagnostics.some((d) => d.code === 'orphan-parent')).toBe(false);
    expect(
      bundles.flatMap((b) => b.diagnostics).filter((d) => d.code === 'ledger-invalid'),
    ).toMatchObject([{ level: 'info', count: 1 }]);
    expect(bundles[0]?.diagnostics.some((d) => d.code === 'ledger-invalid')).toBe(true);
    expect(
      bundles.every((b) => b.session.costUsd === undefined && b.session.apiCalls === undefined),
    ).toBe(true);
  });

  test('Pi parents are linked by filename without any content read', async () => {
    const ctx = memoryContext(true);
    const reads: string[] = [];
    const fs = ctx.fs;
    const guard = (path: string) => {
      reads.push(path);
      if (path.includes('/.pi/agent/sessions/')) throw new Error('cross-read');
    };
    ctx.fs = {
      ...fs,
      readFile: async (path) => {
        guard(path);
        return fs.readFile(path);
      },
      openStream: (path) => {
        guard(path);
        return fs.openStream(path);
      },
    };
    const bundles = await collect(ctx);
    const child = bundles.find((b) => b.session.id === 'gentle-shell:child');
    expect(child?.session.parentId).toBe('pi:parent');
    expect(child?.session.spawnCallId).toBeUndefined();
    expect(reads.some((p) => p.includes('/.pi/agent/sessions/'))).toBe(false);
    expect(
      bundles.flatMap((b) => b.diagnostics).some((d) => d.code === 'session-read-failed'),
    ).toBe(false);
  });

  test('Pi 1.2 usage, system, context edit, durations, effort and nested calls fold as metadata', async () => {
    const ctx = memoryContext();
    const path =
      '/home/u/.gentle-shell/agent/sessions/--project--/2026-01-01T00-00-00-000Z_format.jsonl';
    const records = [
      { type: 'session', version: 3, id: 'format', cwd: '/project' },
      { type: 'message', message: { role: 'system' } },
      { type: 'usage', provider: 'vendor', modelId: 'warm-model', usage: { input: 7 } },
      { type: 'context_edit', replacement: 'RUNWIRE_CANARY_CONTEXT' },
      {
        type: 'message',
        message: {
          role: 'assistant',
          thinkingLevel: 'high',
          timestamp: 10,
          nestedCalls: { calls: [{ name: 'read' }] },
          content: [{ type: 'toolCall', name: 'codemode', id: 'tool' }],
        },
      },
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'tool',
          timestamp: 100,
          durationMs: 12,
          nestedCalls: { calls: [{ name: 'read' }, { name: 'bash' }] },
        },
      },
    ];
    ctx.fs = createMemoryFs({
      files: { [path]: `${records.map((r) => JSON.stringify(r)).join('\n')}\n` },
    });
    const [bundle] = await collect(ctx);
    expect(bundle?.session).toMatchObject({
      apiCalls: 1,
      uncachedInput: 7,
      effort: 'high',
      toolCalls: 1,
    });
    expect(bundle?.steps.filter((s) => s.kind === 'call')).toMatchObject([
      { model: 'warm-model', modelProvider: 'vendor', uncachedInput: 7 },
    ]);
    expect(bundle?.steps.find((s) => s.kind === 'tool')).toMatchObject({
      durationMs: 12,
      toolCategory: 'exec',
    });
    expect(bundle?.steps.some((s) => s.toolName === 'context-edit')).toBe(true);
    expect(bundle?.diagnostics.filter((d) => d.code === 'nested-tool-calls')).toMatchObject([
      { level: 'info', count: 3 },
    ]);
    expect(bundle?.diagnostics.find((d) => d.code === 'usage-on-non-assistant')?.count).toBe(1);
    expect(bundle?.diagnostics.some((d) => d.code.startsWith('unknown-'))).toBe(false);
    expect(JSON.stringify(bundle)).not.toContain('RUNWIRE_CANARY');
  });
});

describe('gentle-shell discovery', () => {
  test('probe returns every candidate root, even the missing ones', async () => {
    const ctx = contextForFixture('small');
    const probe = await createGentleShellAdapter().probe(ctx);
    expect(probe.installed).toBe(true);
    expect(probe.roots).toHaveLength(3);
    expect(probe.roots.some((r) => r.endsWith('/.gentle-shell/agent/sessions'))).toBe(true);
    expect(probe.roots.some((r) => r.endsWith('/.gentle-shell/agent/gentle-agents/sessions'))).toBe(
      true,
    );
    expect(probe.roots.some((r) => r.endsWith('/.pi/agent/gentle-agents/sessions'))).toBe(true);
  });

  test('small: one parent and one linked child with exact ids', async () => {
    const ctx = contextForFixture('small');
    const bundles = await collect(ctx);
    const ids = bundles.map((b) => b.session.id).sort();
    expect(ids).toEqual([
      'gentle-shell:b0000000-0000-7000-8000-000000000001',
      'gentle-shell:b0000000-0000-7000-8000-0000000000b0',
    ]);
    expect(bundles.every((b) => b.session.harnessId === 'gentle-shell')).toBe(true);
    const child = bundles.find((b) => b.session.id.endsWith('b0'));
    expect(child?.diagnostics.some((d) => d.code === 'unlinked-subagent')).toBe(false);
    expect(child?.diagnostics.some((d) => d.code === 'orphan-parent')).toBe(false);
    expect(child?.session).toMatchObject({
      parentId: 'gentle-shell:b0000000-0000-7000-8000-000000000001',
      relation: 'subagent',
      agentType: 'gentle-ai-explore',
      depth: 1,
      spawnCallId: 'tc1',
      initiatorKind: 'machine',
      initiatorAutomation: 'subagent-dispatch',
    });
    expect(bundles[0]?.session.depth).toBe(0);
    expect(bundles[0]?.session.initiatorKind).toBeUndefined();
    expect(bundles[0]?.session.initiatorSurface).toBeUndefined();
    expect(bundles[0]?.session.initiatorAutomation).toBeUndefined();
    for (const bundle of bundles) expect(validateBundle(bundle).ok).toBe(true);
  });

  test('a second discover with the known map skips every source', async () => {
    const ctx = contextForFixture('small');
    const first = await collect(ctx);
    const known = new Map();
    for (const bundle of first) {
      known.set(bundle.session.sourcePath, {
        size: bundle.session.sourceSize,
        mtime: bundle.session.sourceMtime,
      });
    }
    const second = await collect(ctx, known);
    expect(second).toHaveLength(0);
  });

  test('unlinked: a child without a ledger task imports as a root with the diagnostic', async () => {
    const ctx = contextForFixture('unlinked');
    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.session.id).toBe('gentle-shell:b0000000-0000-7000-8000-0000000000b1');
    expect(bundles[0]?.diagnostics.some((d) => d.code === 'unlinked-subagent')).toBe(true);
  });

  test('duplicate: the same child uuid under two homes emits one bundle with more usage records', async () => {
    const ctx = contextForFixture('duplicate');
    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0] as SessionBundle;
    expect(bundle.session.id).toBe('gentle-shell:b0000000-0000-7000-8000-0000000000b2');
    expect(bundle.session.sourcePath?.includes('.gentle-shell/agent/gentle-agents/')).toBe(true);
    expect(bundle.diagnostics.some((d) => d.code === 'duplicate-child')).toBe(true);
  });

  test('a root that vanishes mid-stream throws instead of pruning history', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'runwire-gs-vanish-'));
    try {
      cpSync(join(FIXTURES_ROOT, 'small', 'home'), join(tmp, 'home'), { recursive: true });
      const ctx: AdapterContext = {
        home: join(tmp, 'home'),
        platform: 'darwin',
        env: {},
        fs: createBunFs(),
        privacy: { titles: true },
        log: { info() {}, warn() {}, error() {} },
      };
      const adapter = createGentleShellAdapter();
      const iterator = adapter.discover(ctx, new Map())[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      rmSync(join(tmp, 'home'), { recursive: true, force: true });
      await expect(iterator.next()).rejects.toThrow('enumerated directory vanished');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
