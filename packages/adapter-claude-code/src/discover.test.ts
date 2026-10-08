import { describe, expect, test } from 'bun:test';
import type { AdapterContext, Known, RunwireFs } from '@runwire/core';
import { createMemoryFs } from '@runwire/core';
import { discover } from './discover';

function line(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-01-01T00:00:00.000Z',
    cwd: '/home/u/proj',
    message: { content: [] },
    ...overrides,
  });
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

const ROOT_CONTENT = `${line()}\n`;
const CHILD_A1_CONTENT = `${line({ uuid: 'a1' })}\n`;
const CHILD_A2_CONTENT = `${line({ uuid: 'a2' })}\n`;
const META_A1 = JSON.stringify({ agentType: 'explorer', spawnDepth: 1, toolUseId: 'c1' });
const META_A2 = JSON.stringify({ agentType: 'explorer', spawnDepth: 1, toolUseId: 'c2' });

const ROOT_PATH = '/home/u/.claude/projects/proj/s1.jsonl';
const CHILD_A1_PATH = '/home/u/.claude/projects/proj/s1/subagents/agent-a1.jsonl';
const CHILD_A1_META_PATH = '/home/u/.claude/projects/proj/s1/subagents/agent-a1.meta.json';
const CHILD_A2_PATH = '/home/u/.claude/projects/proj/s1/subagents/agent-a2.jsonl';
const CHILD_A2_META_PATH = '/home/u/.claude/projects/proj/s1/subagents/agent-a2.meta.json';

function ctxWithFiles(
  files: Record<string, { content: string; mtimeMs?: number }>,
): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs({ files }),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

function ctxWithFs(fs: RunwireFs): AdapterContext {
  return { ...ctxWithFiles({}), fs };
}

function fsError(code: string): Error {
  return Object.assign(new Error(`${code} synthetic`), { code });
}

async function collect(ctx: AdapterContext, known: Known = new Map()) {
  const out = [];
  for await (const b of discover(ctx, known)) out.push(b);
  return out;
}

describe('discover: the P10 known rule', () => {
  test('unchanged root and unchanged children are all skipped', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: META_A1 },
    });
    const known: Known = new Map([
      [ROOT_PATH, { size: byteLen(ROOT_CONTENT), mtime: 1000 }],
      [CHILD_A1_PATH, { size: byteLen(CHILD_A1_CONTENT), mtime: 2000 }],
    ]);
    const bundles = await collect(ctx, known);
    expect(bundles).toHaveLength(0);
  });

  test('a changed child re-emits the root and every child, not just the changed one', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: META_A1 },
      [CHILD_A2_PATH]: { content: CHILD_A2_CONTENT, mtimeMs: 3000 },
      [CHILD_A2_META_PATH]: { content: META_A2 },
    });
    const known: Known = new Map([
      [ROOT_PATH, { size: byteLen(ROOT_CONTENT), mtime: 1000 }],
      [CHILD_A1_PATH, { size: byteLen(CHILD_A1_CONTENT), mtime: 2000 }],
      // child2's mtime in `known` does not match disk (3000) - it "changed".
      [CHILD_A2_PATH, { size: byteLen(CHILD_A2_CONTENT), mtime: 1 }],
    ]);
    const bundles = await collect(ctx, known);
    const ids = bundles.map((b) => b.session.id).sort();
    expect(ids).toEqual(['claude-code:s1', 'claude-code:s1/a1', 'claude-code:s1/a2']);
  });

  test('a brand-new child file (absent from known) re-emits the whole family', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: META_A1 },
    });
    const known: Known = new Map([[ROOT_PATH, { size: byteLen(ROOT_CONTENT), mtime: 1000 }]]);
    const bundles = await collect(ctx, known);
    expect(bundles.map((b) => b.session.id).sort()).toEqual([
      'claude-code:s1',
      'claude-code:s1/a1',
    ]);
  });

  test('a child vanished from disk (still in known) does not prevent skipping the unchanged root+survivors', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: META_A1 },
    });
    // known also has a2, which no longer exists on disk - removal is core's
    // job (removeVanished), not discover()'s; it must not force a re-emit.
    const known: Known = new Map([
      [ROOT_PATH, { size: byteLen(ROOT_CONTENT), mtime: 1000 }],
      [CHILD_A1_PATH, { size: byteLen(CHILD_A1_CONTENT), mtime: 2000 }],
      [CHILD_A2_PATH, { size: byteLen(CHILD_A2_CONTENT), mtime: 3000 }],
    ]);
    const bundles = await collect(ctx, known);
    expect(bundles).toHaveLength(0);
  });

  test('a subagents dir with no root .jsonl still emits its children per their own known state', async () => {
    const ctx = ctxWithFiles({
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: META_A1 },
    });
    const bundles = await collect(ctx, new Map());
    expect(bundles.map((b) => b.session.id)).toEqual(['claude-code:s1/a1']);
    expect(bundles[0]?.session.parentId).toBe('claude-code:s1');
  });
});

describe('discover: incomplete enumeration is rejected, not masked', () => {
  const ROOT = '/home/u/.claude/projects';
  const PROJECT = '/home/u/.claude/projects/proj';

  function baseFs(): RunwireFs {
    return createMemoryFs({
      files: {
        [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
        [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
        [CHILD_A1_META_PATH]: { content: META_A1 },
      },
    });
  }

  test('a project dir listed by the parent but vanished before its listing rejects, and a retry succeeds', async () => {
    const real = baseFs();
    const vanished: RunwireFs = {
      ...real,
      async stat(path) {
        return path === PROJECT ? undefined : real.stat(path);
      },
    };
    await expect(collect(ctxWithFs(vanished))).rejects.toThrow();

    // The same fs restored is readable: the rejection was not a permanent loss.
    const bundles = await collect(ctxWithFs(real));
    expect(bundles.map((b) => b.session.id)).toEqual(['claude-code:s1', 'claude-code:s1/a1']);
  });

  test('a project dir listed by the parent but unreadable (EACCES) before its listing rejects', async () => {
    const real = baseFs();
    const denied: RunwireFs = {
      ...real,
      async readdir(path) {
        if (path === PROJECT) throw fsError('EACCES');
        return real.readdir(path);
      },
    };
    await expect(collect(ctxWithFs(denied))).rejects.toMatchObject({ code: 'EACCES' });
  });

  test('the probed root vanishing makes discover reject instead of yielding an empty walk', async () => {
    const real = baseFs();
    const gone: RunwireFs = {
      ...real,
      async readdir(path) {
        return path === ROOT ? [] : real.readdir(path);
      },
      async stat(path) {
        return path === ROOT ? undefined : real.stat(path);
      },
    };
    await expect(collect(ctxWithFs(gone))).rejects.toThrow();
  });

  test('an absent optional subagents dir is tolerated: the root still emits with no children', async () => {
    const bundles = await collect(ctxWithFiles({ [ROOT_PATH]: { content: ROOT_CONTENT } }));
    expect(bundles.map((b) => b.session.id)).toEqual(['claude-code:s1']);
  });
});

describe('discover: link fields from .meta.json', () => {
  test('a child carries parentId, relation, agentType, depth and spawnCallId', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: META_A1 },
    });
    const bundles = await collect(ctx);
    const child = bundles.find((b) => b.session.id === 'claude-code:s1/a1');
    expect(child?.session.parentId).toBe('claude-code:s1');
    expect(child?.session.relation).toBe('subagent');
    expect(child?.session.agentType).toBe('explorer');
    expect(child?.session.depth).toBe(1);
    expect(child?.session.spawnCallId).toBe('c1');
  });

  test('a missing .meta.json still yields a bundle, with a missing-agent-meta diagnostic', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
    });
    const bundles = await collect(ctx);
    const child = bundles.find((b) => b.session.id === 'claude-code:s1/a1');
    expect(child).toBeDefined();
    expect(child?.session.parentId).toBe('claude-code:s1');
    expect(child?.diagnostics.some((d) => d.code === 'missing-agent-meta')).toBe(true);
  });

  test('an invalid .meta.json still yields a bundle, with an invalid-agent-meta diagnostic', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: 'not json at all {' },
    });
    const bundles = await collect(ctx);
    const child = bundles.find((b) => b.session.id === 'claude-code:s1/a1');
    expect(child).toBeDefined();
    expect(child?.diagnostics.some((d) => d.code === 'invalid-agent-meta')).toBe(true);
  });
});

describe('discover: deterministic order', () => {
  test('two runs over the same fs yield the same session id order', async () => {
    const ctx = ctxWithFiles({
      [ROOT_PATH]: { content: ROOT_CONTENT, mtimeMs: 1000 },
      [CHILD_A1_PATH]: { content: CHILD_A1_CONTENT, mtimeMs: 2000 },
      [CHILD_A1_META_PATH]: { content: META_A1 },
      [CHILD_A2_PATH]: { content: CHILD_A2_CONTENT, mtimeMs: 3000 },
      [CHILD_A2_META_PATH]: { content: META_A2 },
    });
    const first = (await collect(ctx)).map((b) => b.session.id);
    const second = (await collect(ctx)).map((b) => b.session.id);
    expect(second).toEqual(first);
    expect(first).toEqual(['claude-code:s1', 'claude-code:s1/a1', 'claude-code:s1/a2']);
  });
});
