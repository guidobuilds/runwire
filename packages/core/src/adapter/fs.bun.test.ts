import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BunFsIo } from './fs.bun';
import { createBunFs } from './fs.bun';

function fsError(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code} synthetic`), { code });
}

async function rejectCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

async function rejectError(p: Promise<unknown>): Promise<Error | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

function throwingIo(code: string): BunFsIo {
  return {
    stat: async () => {
      throw fsError(code);
    },
    readdir: async () => {
      throw fsError(code);
    },
    readFileText: async () => {
      throw fsError(code);
    },
  };
}

describe('createBunFs: absence vs real failure', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'runwire-fsbun-test-'));
    await mkdir(join(dir, 'folder'));
    await writeFile(join(dir, 'file.txt'), 'x');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('ENOENT is absence: undefined/[]/undefined, never a throw', async () => {
    const fs = createBunFs();
    const missing = join(dir, 'missing');
    expect(await fs.stat(missing)).toBeUndefined();
    expect(await fs.readdir(missing)).toEqual([]);
    expect(await fs.readFile(missing)).toBeUndefined();
  });

  test('ENOTDIR is absence: a path under a file stats undefined and a file readdirs empty', async () => {
    const fs = createBunFs();
    expect(await fs.stat(join(dir, 'file.txt', 'child'))).toBeUndefined();
    expect(await fs.readdir(join(dir, 'file.txt'))).toEqual([]);
  });

  test('a real non-absence stat/readdir error is rethrown, not masked', async () => {
    const fs = createBunFs();
    const tooLong = join(dir, 'a'.repeat(5000));
    const statError = await rejectError(fs.stat(tooLong));
    const readdirError = await rejectError(fs.readdir(tooLong));
    expect(statError).toBeInstanceOf(Error);
    expect(readdirError).toBeInstanceOf(Error);
    expect((statError as { code?: string } | undefined)?.code).not.toBe('ENOENT');
    expect((statError as { code?: string } | undefined)?.code).not.toBe('ENOTDIR');
    expect((readdirError as { code?: string } | undefined)?.code).not.toBe('ENOENT');
    expect((readdirError as { code?: string } | undefined)?.code).not.toBe('ENOTDIR');
  });

  test('a non-absence readFile error (EISDIR) is rethrown, not masked', async () => {
    const fs = createBunFs();
    expect(await rejectCode(fs.readFile(dir))).toBe('EISDIR');
  });

  test('EACCES is rethrown from stat, readdir and readFile', async () => {
    const fs = createBunFs(throwingIo('EACCES'));
    expect(await rejectCode(fs.stat('/x'))).toBe('EACCES');
    expect(await rejectCode(fs.readdir('/x'))).toBe('EACCES');
    expect(await rejectCode(fs.readFile('/x'))).toBe('EACCES');
  });

  test('EIO is rethrown from stat, readdir and readFile', async () => {
    const fs = createBunFs(throwingIo('EIO'));
    expect(await rejectCode(fs.stat('/x'))).toBe('EIO');
    expect(await rejectCode(fs.readdir('/x'))).toBe('EIO');
    expect(await rejectCode(fs.readFile('/x'))).toBe('EIO');
  });

  test('injected ENOENT still maps to absence (classification is by code, not source)', async () => {
    const io = throwingIo('ENOENT');
    const fs = createBunFs(io);
    expect(await fs.stat('/x')).toBeUndefined();
    expect(await fs.readdir('/x')).toEqual([]);
    expect(await fs.readFile('/x')).toBeUndefined();
  });
});
