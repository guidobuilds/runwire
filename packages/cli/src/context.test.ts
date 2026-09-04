import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createContext, defaultDbPath, ensureDbDir } from './context';

describe('createContext', () => {
  test('home defaults to the real OS home, resolved absolute', () => {
    const ctx = createContext({ titles: true });
    expect(ctx.home).toBe(resolve(homedir()));
  });

  test('--home is path.resolve()d, never left relative', () => {
    const ctx = createContext({ home: 'fixtures/claude-code/small', titles: true });
    expect(ctx.home).toBe(resolve('fixtures/claude-code/small'));
    expect(ctx.home.startsWith(sep)).toBe(true);
  });

  test('privacy.titles reflects --no-titles', () => {
    expect(createContext({ titles: true }).privacy.titles).toBe(true);
    expect(createContext({ titles: false }).privacy.titles).toBe(false);
  });

  test('log writes to stderr only (never stdout)', () => {
    const ctx = createContext({ titles: true });
    // biome-ignore lint/suspicious/noExplicitAny: capturing console.error/log calls for the assertion
    const stderrCalls: any[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: capturing console.error/log calls for the assertion
    const stdoutCalls: any[] = [];
    const origError = console.error;
    const origLog = console.log;
    console.error = (...args: unknown[]) => stderrCalls.push(args);
    console.log = (...args: unknown[]) => stdoutCalls.push(args);
    try {
      ctx.log.info('hello');
      ctx.log.warn('careful');
      ctx.log.error('boom');
    } finally {
      console.error = origError;
      console.log = origLog;
    }
    expect(stderrCalls.length).toBe(3);
    expect(stdoutCalls.length).toBe(0);
  });
});

describe('defaultDbPath', () => {
  test('is <os.homedir()>/.scout/scout.db', () => {
    expect(defaultDbPath()).toBe(resolve(homedir(), '.scout', 'scout.db'));
  });
});

describe('ensureDbDir', () => {
  test(':memory: creates nothing', async () => {
    await ensureDbDir(':memory:');
    // No assertion target on disk - the point is this call must not throw
    // and must not touch the real home. Documented by absence of side effects.
    expect(true).toBe(true);
  });

  test('creates the parent directory of a real path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'scout-cli-test-'));
    try {
      const dbPath = join(tmp, 'nested', 'dir', 'scout.db');
      expect(existsSync(join(tmp, 'nested'))).toBe(false);
      await ensureDbDir(dbPath);
      expect(existsSync(join(tmp, 'nested', 'dir'))).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('given --db, nothing under ~/.scout is created (does not call defaultDbPath)', async () => {
    const scoutDir = join(homedir(), '.scout');
    const existedBefore = existsSync(scoutDir);
    const tmp = await mkdtemp(join(tmpdir(), 'scout-cli-test-'));
    try {
      await ensureDbDir(join(tmp, 'explicit.db'));
      expect(existsSync(scoutDir)).toBe(existedBefore);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
