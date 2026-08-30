import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBunFs } from './fs.bun';
import { createMemoryFs } from './fs.memory';

describe('createBunFs', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scout-fs-test-'));
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'a.txt'), 'hello\nworld\n');
    await writeFile(join(dir, 'sub', 'b.txt'), 'nested');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('stat reports size and directory-ness', async () => {
    const fs = createBunFs();
    const file = await fs.stat(join(dir, 'a.txt'));
    expect(file?.isDirectory).toBe(false);
    expect(file?.sizeBytes).toBe(12);
    const folder = await fs.stat(dir);
    expect(folder?.isDirectory).toBe(true);
  });

  test('stat on a missing path returns undefined, not a throw', async () => {
    const fs = createBunFs();
    expect(await fs.stat(join(dir, 'missing'))).toBeUndefined();
  });

  test('readdir lists entries; missing dir returns empty array', async () => {
    const fs = createBunFs();
    expect(await fs.readdir(dir)).toEqual(expect.arrayContaining(['a.txt', 'sub']));
    expect(await fs.readdir(join(dir, 'missing'))).toEqual([]);
  });

  test('readFile returns content; missing file returns undefined', async () => {
    const fs = createBunFs();
    expect(await fs.readFile(join(dir, 'a.txt'))).toBe('hello\nworld\n');
    expect(await fs.readFile(join(dir, 'missing'))).toBeUndefined();
  });

  test('openStream yields the file bytes', async () => {
    const fs = createBunFs();
    const chunks: Uint8Array[] = [];
    for await (const chunk of fs.openStream(
      join(dir, 'a.txt'),
    ) as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.byteLength;
    }
    const text = new TextDecoder().decode(combined);
    expect(text).toBe('hello\nworld\n');
  });

  test('openSqliteReadonly can query a real database', async () => {
    const dbPath = join(dir, 'test.sqlite');
    const setup = new Database(dbPath);
    setup.run('CREATE TABLE t (id INTEGER, name TEXT)');
    setup.run('INSERT INTO t (id, name) VALUES (1, ?)', ['alice']);
    setup.close();

    const fs = createBunFs();
    const reader = fs.openSqliteReadonly(dbPath);
    const rows = reader.all<{ id: number; name: string }>(
      'SELECT id, name FROM t WHERE id = ?',
      [1],
    );
    expect(rows).toEqual([{ id: 1, name: 'alice' }]);
    reader.close();
  });
});

describe('createMemoryFs', () => {
  test('stat, readdir, readFile and openStream over in-memory files', async () => {
    const fs = createMemoryFs({
      files: {
        '/home/u/proj/a.txt': 'one\ntwo\n',
        '/home/u/proj/sub/b.txt': 'nested',
      },
    });

    const file = await fs.stat('/home/u/proj/a.txt');
    expect(file?.isDirectory).toBe(false);
    expect(file?.sizeBytes).toBe(8);

    const dir = await fs.stat('/home/u/proj');
    expect(dir?.isDirectory).toBe(true);

    expect(await fs.stat('/nope')).toBeUndefined();

    expect(await fs.readdir('/home/u/proj')).toEqual(expect.arrayContaining(['a.txt', 'sub']));
    expect(await fs.readFile('/home/u/proj/a.txt')).toBe('one\ntwo\n');
    expect(await fs.readFile('/nope')).toBeUndefined();

    const reader = fs.openStream('/home/u/proj/a.txt').getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe('one\ntwo\n');
  });

  test('openSqliteReadonly throws clearly since it is unused in M1', () => {
    const fs = createMemoryFs();
    expect(() => fs.openSqliteReadonly('/x')).toThrow();
  });
});
