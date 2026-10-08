import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AdapterContext, Known, RunwireFs, SessionBundle } from '@runwire/core';
import { createBunFs, createMemoryFs } from '@runwire/core';
import { discover, probe } from './discover';

const FIXTURES_ROOT = join(import.meta.dir, '..', '..', '..', 'fixtures', 'pi');
const SMALL_UUID = 'a1000000-0000-7000-8000-000000000001';

function ctxFor(name: string, overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    home: join(FIXTURES_ROOT, name, 'home'),
    platform: 'darwin',
    env: {},
    fs: createBunFs(),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
}

async function collect(ctx: AdapterContext, known: Known = new Map()): Promise<SessionBundle[]> {
  const out: SessionBundle[] = [];
  for await (const b of discover(ctx, known)) out.push(b);
  return out;
}

describe('pi discover: probe', () => {
  test('empty home reports not installed', async () => {
    const ctx: AdapterContext = {
      home: '/does/not/exist/at/all',
      platform: 'darwin',
      env: {},
      fs: createBunFs(),
      privacy: { titles: true },
      log: { info() {}, warn() {}, error() {} },
    };
    const result = await probe(ctx);
    expect(result.installed).toBe(false);
    expect(result.roots).toEqual([]);
  });

  test('fixture home reports installed with the sessions root', async () => {
    const result = await probe(ctxFor('small'));
    expect(result.installed).toBe(true);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toContain('.pi/agent/sessions');
  });
});

describe('pi discover: walk', () => {
  test('yields exactly one root bundle with the filename uuid', async () => {
    const bundles = await collect(ctxFor('small'));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.session.id).toBe(`pi:${SMALL_UUID}`);
    expect(bundles[0]?.session.depth).toBe(0);
  });

  test('feeding the discovered (sourcePath, size, mtime) back yields zero bundles', async () => {
    const ctx = ctxFor('small');
    const first = await collect(ctx);
    const known: Known = new Map();
    for (const b of first) {
      known.set(b.session.sourceId ?? b.session.sourcePath, {
        size: b.session.sourceSize,
        mtime: b.session.sourceMtime,
      });
    }
    expect(await collect(ctx, known)).toHaveLength(0);
  });

  test('PI_CODING_AGENT_SESSION_DIR redirects discovery', async () => {
    const sessionsDir = join(FIXTURES_ROOT, 'small', 'home', '.pi', 'agent', 'sessions');
    const ctx = ctxFor('nope', { env: { PI_CODING_AGENT_SESSION_DIR: sessionsDir } });
    const bundles = await collect(ctx);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.session.id).toBe(`pi:${SMALL_UUID}`);
  });
});

describe('pi discover: incomplete enumeration is rejected, not masked', () => {
  const ROOT = '/home/u/.pi/agent/sessions';
  const PROJECT = '/home/u/.pi/agent/sessions/proj';
  const FILE = `${PROJECT}/2026-01-01T00-00-00-000Z_${SMALL_UUID}.jsonl`;
  const HEADER = JSON.stringify({
    type: 'session',
    version: 3,
    id: SMALL_UUID,
    timestamp: '2026-01-01T00:00:00.000Z',
    cwd: '/home/u/pi',
  });
  const USER = JSON.stringify({
    type: 'message',
    id: 'e1',
    parentId: null,
    timestamp: '2026-01-01T00:00:01.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  });

  function baseFs(): RunwireFs {
    return createMemoryFs({ files: { [FILE]: `${HEADER}\n${USER}\n` } });
  }

  function ctxWithFs(fs: RunwireFs): AdapterContext {
    return {
      home: '/home/u',
      platform: 'linux',
      env: {},
      fs,
      privacy: { titles: true },
      log: { info() {}, warn() {}, error() {} },
    };
  }

  function fsError(code: string): Error {
    return Object.assign(new Error(`${code} synthetic`), { code });
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

    const bundles = await collect(ctxWithFs(real));
    expect(bundles.map((b) => b.session.id)).toEqual([`pi:${SMALL_UUID}`]);
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
});
