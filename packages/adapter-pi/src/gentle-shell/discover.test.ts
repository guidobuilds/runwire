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

function deltaContext(files: Record<string, string>): AdapterContext {
  return { ...contextForFixture('small'), home: '/home/u', fs: createMemoryFs({ files }) };
}

const SESSIONS = '/home/u/.gentle-shell/agent/sessions/--project--';
const sessionFile = (stamp: string, uuid: string) => `${SESSIONS}/${stamp}_${uuid}.jsonl`;
const lines = (records: unknown[]) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;

describe('gentle-shell Pi 1.5.0 delta', () => {
  test('session_info and context_edit are observed as harness steps, never as unknown types', async () => {
    const path = sessionFile('2026-01-11T00-00-00-000Z', 'delta');
    const ctx = deltaContext({
      [path]: lines([
        { type: 'session', version: 3, id: 'delta', cwd: '/project' },
        {
          type: 'session_info',
          id: 'd1',
          parentId: null,
          timestamp: '2026-01-11T00:00:01.000Z',
          name: 'RUNWIRE_CANARY_NAME',
        },
        {
          type: 'context_edit',
          id: 'd2',
          parentId: 'd1',
          timestamp: '2026-01-11T00:00:02.000Z',
          targetId: 'd1',
          replacement: 'RUNWIRE_CANARY_CONTEXT',
        },
        {
          type: 'message',
          id: 'd3',
          parentId: 'd2',
          timestamp: '2026-01-11T00:00:03.000Z',
          message: { role: 'user', content: 'RUNWIRE_CANARY_PROMPT' },
        },
      ]),
    });

    const [bundle] = await collect(ctx);
    expect(bundle?.steps.map((s) => s.toolName ?? s.kind)).toEqual([
      'session-info',
      'context-edit',
      'turn',
    ]);
    expect(bundle?.diagnostics).toEqual([]);
    expect(JSON.stringify(bundle)).not.toContain('RUNWIRE_CANARY');
  });

  test('a parentSession naming an imported session yields a fork link with no parentId', async () => {
    const parent = sessionFile('2026-01-11T01-00-00-000Z', 'fork-parent');
    const fork = sessionFile('2026-01-11T02-00-00-000Z', 'fork-child');
    const ctx = deltaContext({
      [parent]: lines([
        { type: 'session', version: 3, id: 'fork-parent', cwd: '/project' },
        {
          type: 'message',
          id: 'p1',
          parentId: null,
          timestamp: '2026-01-11T01:00:01.000Z',
          message: { role: 'user' },
        },
      ]),
      [fork]: lines([
        {
          type: 'session',
          version: 3,
          id: 'fork-child',
          cwd: '/project',
          parentSession: parent,
        },
        {
          type: 'message',
          id: 'f1',
          parentId: null,
          timestamp: '2026-01-11T02:00:01.000Z',
          message: { role: 'user' },
        },
      ]),
    });

    const bundles = await collect(ctx);
    const child = bundles.find((b) => b.session.id === 'gentle-shell:fork-child');
    expect(child?.session).toMatchObject({
      relation: 'fork',
      forkedFrom: 'gentle-shell:fork-parent',
      depth: 0,
    });
    expect(child?.session.parentId).toBeUndefined();
    expect(child?.diagnostics).toEqual([]);
  });

  test('an unresolvable parentSession reports an info diagnostic instead of throwing', async () => {
    const path = sessionFile('2026-01-11T03-00-00-000Z', 'orphan-fork');
    const ctx = deltaContext({
      [path]: lines([
        {
          type: 'session',
          version: 3,
          id: 'orphan-fork',
          cwd: '/project',
          parentSession: sessionFile('2026-01-11T00-00-00-000Z', 'never-imported'),
        },
      ]),
    });

    const [bundle] = await collect(ctx);
    expect(bundle?.session.id).toBe('gentle-shell:orphan-fork');
    expect(bundle?.session.relation).toBeUndefined();
    expect(bundle?.session.forkedFrom).toBeUndefined();
    expect(bundle?.diagnostics).toMatchObject([
      { level: 'info', code: 'unresolved-parent-session', count: 1 },
    ]);
    expect(JSON.stringify(bundle)).not.toContain('never-imported');
  });
});

describe('gentle-shell 4.x extension metadata (S3b)', () => {
  const CHILDREN = '/home/u/.gentle-shell/agent/gentle-agents/sessions';
  const TASKS = '/home/u/.gentle-shell/agent/gentle-agents/tasks';
  const childFile = '2026-01-12T01-00-00-000Z_child.jsonl';
  const parentPath = sessionFile('2026-01-12T00-00-00-000Z', 'parent');

  /** One parent (records below) and the `task-9` child it spawned. */
  function spawnContext(parentRecords: unknown[]): AdapterContext {
    return deltaContext({
      [parentPath]: lines([
        { type: 'session', version: 3, id: 'parent', cwd: '/project' },
        ...parentRecords,
      ]),
      [`${CHILDREN}/${childFile}`]: lines([
        { type: 'session', version: 3, id: 'child', cwd: '/project' },
      ]),
      [`${TASKS}/task-9.json`]: JSON.stringify({
        task: {
          id: 'task-9',
          agent: 'worker',
          parentSessionId: 'parent',
          sessionPath: childFile,
        },
      }),
    });
  }

  const receipt = (id: string, data: Record<string, unknown>) => ({
    type: 'custom',
    id,
    parentId: null,
    timestamp: '2026-01-12T00:00:05.000Z',
    customType: 'gentle-pi.review-reminder-receipt/v1',
    data,
  });
  const subagentReceipt = (id: string, taskId: string, toolCallId: string) =>
    receipt(id, {
      kind: 'review',
      sessionId: 'parent',
      root: '/project',
      id: `rec-${id}`,
      source: 'subagent',
      toolName: 'subagent_run',
      toolCallId,
      taskId,
      writerModelId: 'RUNWIRE_CANARY_WRITER_MODEL',
      writerEffort: 'RUNWIRE_CANARY_WRITER_EFFORT',
    });

  test('a subagent receipt corroborates spawn linkage when no toolResult carries it', async () => {
    const bundles = await collect(spawnContext([subagentReceipt('r1', 'task-9', 'tc-receipt')]));
    const child = bundles.find((b) => b.session.id === 'gentle-shell:child');

    expect(child?.session.spawnCallId).toBe('tc-receipt');
    expect(child?.diagnostics.filter((d) => d.code === 'receipt-spawn-link')).toMatchObject([
      { level: 'info', count: 1 },
    ]);
    expect(JSON.stringify(bundles)).not.toContain('RUNWIRE_CANARY');
  });

  test('the toolResult identity stays primary over a receipt for the same task', async () => {
    const bundles = await collect(
      spawnContext([
        {
          type: 'message',
          id: 'm2',
          parentId: null,
          timestamp: '2026-01-12T00:00:04.000Z',
          message: {
            role: 'toolResult',
            toolCallId: 'tc-primary',
            details: { gentleAgents: { taskId: 'task-9' } },
          },
        },
        subagentReceipt('r1', 'task-9', 'tc-receipt'),
      ]),
    );
    const child = bundles.find((b) => b.session.id === 'gentle-shell:child');

    expect(child?.session.spawnCallId).toBe('tc-primary');
    expect(child?.diagnostics.some((d) => d.code === 'receipt-spawn-link')).toBe(false);
  });

  test('receipts that do not corroborate a subagent link never supply one', async () => {
    const bundles = await collect(
      spawnContext([
        // Not a subagent receipt.
        receipt('r1', { source: 'parent', taskId: 'task-9', toolCallId: 'tc-parent' }),
        // Missing half of the identity.
        receipt('r2', { source: 'subagent', taskId: 'task-9' }),
        receipt('r3', { source: 'subagent', toolCallId: 'tc-x' }),
        // A link for another task never fills this task's slot.
        subagentReceipt('r4', 'task-other', 'tc-other'),
      ]),
    );
    const child = bundles.find((b) => b.session.id === 'gentle-shell:child');

    expect(child?.session.spawnCallId).toBeUndefined();
    expect(child?.diagnostics.some((d) => d.code === 'receipt-spawn-link')).toBe(false);
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
