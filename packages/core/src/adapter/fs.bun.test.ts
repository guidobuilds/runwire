import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BunFsIo } from './fs.bun';
import { createBunFs } from './fs.bun';

/** A synthetic Node-style error with a `code`, as node:fs/Bun raise them. */
function fsError(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code} synthetic`), { code });
}

/** The observed error `code`, or undefined if the promise resolved. */
async function rejectCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
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

  test('a non-absence stat/readdir error (ENAMETOOLONG) is rethrown, not masked', async () => {
    const fs = createBunFs();
    const tooLong = join(dir, 'a'.repeat(5000));
    expect(await rejectCode(fs.stat(tooLong))).toBe('ENAMETOOLONG');
    expect(await rejectCode(fs.readdir(tooLong))).toBe('ENAMETOOLONG');
  });

  test('a non-absence readFile error (EISDIR) is rethrown, not masked', async () => {
    const fs = createBunFs();
    expect(await rejectCode(fs.readFile(dir))).toBe('EISDIR');
  });

  // Injected so the assertion does not depend on filesystem permissions, which
  // a privileged (root) CI user bypasses. The classifier is code-based.
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
