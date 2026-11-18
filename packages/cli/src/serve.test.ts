import type { Database } from 'bun:sqlite';
import { describe, expect, mock, test } from 'bun:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { AdapterContext, ImportReport } from '@runwire/core';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const CLI_SCRIPT = 'packages/cli/src/index.ts';

type CapturedServerOpts = {
  db: unknown;
  host: string;
  port: number;
  allowNonLocal?: boolean;
  scan: () => Promise<ImportReport>;
};

function makeServerMock(captured: CapturedServerOpts[]) {
  const stopMock = mock(() => {});
  const createServerMock = mock((opts: CapturedServerOpts) => {
    captured.push(opts);
    return { port: opts.port, hostname: opts.host, stop: stopMock };
  });
  return { stopMock, createServerMock };
}

async function tick(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('runServe', () => {
  test('--db/--host/--port resolve into createServer options', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');
    const p = runServe(
      { db: ':memory:', host: '127.0.0.1', port: '0', titles: true },
      { createServer: createServerMock },
    );
    await tick();
    process.emit('SIGINT');
    const code = await p;

    expect(code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.host).toBe('127.0.0.1');
    expect(captured[0]?.port).toBe(0);
    expect(captured[0]?.db).toBeDefined();
    expect(stopMock).toHaveBeenCalled();
  });

  test('defaults: host 127.0.0.1 and port 8787 when --host/--port omitted', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');
    const p = runServe({ db: ':memory:', titles: true }, { createServer: createServerMock });
    await tick();
    process.emit('SIGINT');
    const code = await p;

    expect(code).toBe(0);
    expect(captured[0]?.host).toBe('127.0.0.1');
    expect(captured[0]?.port).toBe(8787);
    expect(stopMock).toHaveBeenCalled();
  });

  test('DB path falls back to defaultDbPath() when --db is omitted; ensureDbDir is called', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const ensureDbDir = mock(async () => {});
    const openStore = mock(() => ({ db: {} as unknown as Database, close: () => {} }));
    const { runServe } = await import('./commands/serve');
    const p = runServe(
      { titles: true },
      {
        defaultDbPath: () => '/fake/home/.runwire/runwire.db',
        ensureDbDir,
        openStore,
        createServer: createServerMock,
      },
    );
    await tick();
    process.emit('SIGINT');
    const code = await p;

    expect(code).toBe(0);
    const expectedDb = resolve('/fake/home/.runwire/runwire.db');
    expect(ensureDbDir).toHaveBeenCalledWith(expectedDb);
    expect(openStore).toHaveBeenCalledWith(expectedDb);
    expect(captured[0]?.host).toBe('127.0.0.1');
    expect(captured[0]?.port).toBe(8787);
    expect(stopMock).toHaveBeenCalled();
  });

  test('--db ~ expands to <os.homedir()> before ensureDbDir/openStore', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const ensureDbDir = mock(async () => {});
    const openStore = mock(() => ({ db: {} as unknown as Database, close: () => {} }));
    const expected = resolve(homedir(), '.runwire', 'runwire.db');
    const { runServe } = await import('./commands/serve');
    const p = runServe(
      { db: '~/.runwire/runwire.db', titles: true },
      { ensureDbDir, openStore, createServer: createServerMock },
    );
    await tick();
    process.emit('SIGINT');
    const code = await p;

    expect(code).toBe(0);
    expect(ensureDbDir).toHaveBeenCalledWith(expected);
    expect(openStore).toHaveBeenCalledWith(expected);
    expect(expected).not.toBe(resolve('~/.runwire/runwire.db'));
    expect(stopMock).toHaveBeenCalled();
  });

  test('passes a scan callback that runs importAll over the injected adapter registry', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');
    const p = runServe(
      { db: ':memory:', titles: true },
      { createServer: createServerMock, adapters: [] },
    );
    await tick();

    const scan = captured[0]?.scan;
    expect(typeof scan).toBe('function');
    const report = await scan?.();
    expect(report).toEqual({ perAdapter: {}, durationMs: expect.any(Number) });

    process.emit('SIGINT');
    const code = await p;
    expect(code).toBe(0);
    expect(stopMock).toHaveBeenCalled();
  });

  test('threads --no-titles into the scan context (privacy.titles=false)', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const createContextMock = mock(
      (_opts: { home?: string; titles: boolean }) => ({}) as AdapterContext,
    );
    const { runServe } = await import('./commands/serve');
    const p = runServe(
      { db: ':memory:', titles: false },
      { createServer: createServerMock, createContext: createContextMock, adapters: [] },
    );
    await tick();

    expect(createContextMock).toHaveBeenCalledWith({ titles: false });

    process.emit('SIGINT');
    const code = await p;
    expect(code).toBe(0);
    expect(stopMock).toHaveBeenCalled();
  });

  test('refuses a non-loopback --host without --expose and never calls createServer', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');
    const code = await runServe(
      { db: ':memory:', host: '0.0.0.0', titles: true },
      { createServer: createServerMock },
    );

    expect(code).toBe(2);
    expect(captured).toHaveLength(0);
    expect(stopMock).not.toHaveBeenCalled();
  });

  test('an empty --host is refused (no bind-all fallback), even with --expose', async () => {
    const captured: CapturedServerOpts[] = [];
    const { createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');

    const refused = await runServe(
      { db: ':memory:', host: '', titles: true },
      { createServer: createServerMock },
    );
    const refusedExpose = await runServe(
      { db: ':memory:', host: '', titles: true, expose: true },
      { createServer: createServerMock },
    );

    expect(refused).toBe(2);
    expect(refusedExpose).toBe(2);
    expect(captured).toHaveLength(0);
  });

  test('--expose lets a non-loopback host through, warns, and forwards allowNonLocal', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(' '));
    };
    let code: number;
    try {
      const { runServe } = await import('./commands/serve');
      const p = runServe(
        { db: ':memory:', host: '0.0.0.0', port: '0', titles: true, expose: true },
        { createServer: createServerMock },
      );
      await tick();
      process.emit('SIGINT');
      code = await p;
    } finally {
      console.error = original;
    }

    expect(code).toBe(0);
    expect(captured[0]?.host).toBe('0.0.0.0');
    expect(captured[0]?.allowNonLocal).toBe(true);
    expect(errors.some((line) => line.includes('warn:'))).toBe(true);
    expect(stopMock).toHaveBeenCalled();
  });

  test('::1 is loopback (no --expose needed) and the listening URL brackets IPv6', async () => {
    const captured: CapturedServerOpts[] = [];
    const { createServerMock } = makeServerMock(captured);
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(' '));
    };
    let code: number;
    try {
      const { runServe } = await import('./commands/serve');
      const p = runServe(
        { db: ':memory:', host: '::1', port: '0', titles: true },
        { createServer: createServerMock },
      );
      await tick();
      process.emit('SIGINT');
      code = await p;
    } finally {
      console.error = original;
    }

    expect(code).toBe(0);
    expect(captured[0]?.host).toBe('::1');
    expect(captured[0]?.allowNonLocal).toBe(false);
    expect(errors.some((line) => line.includes('http://[::1]:'))).toBe(true);
  });
});

describe('runwire serve (cli entry)', () => {
  test('an out-of-range --port exits 2 and never starts a server', async () => {
    const proc = Bun.spawn([process.execPath, CLI_SCRIPT, 'serve', '--port', '99999'], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe('');
    expect(code).toBe(2);
    expect(stderr).toContain('--port must be an integer between 0 and 65535');
  });

  test('accepts --no-titles (fails on the invalid port, not on flag parsing)', async () => {
    const proc = Bun.spawn(
      [process.execPath, CLI_SCRIPT, 'serve', '--no-titles', '--port', '99999'],
      { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe('');
    expect(code).toBe(2);
    expect(stderr).toContain('--port must be an integer between 0 and 65535');
    expect(stderr).not.toContain('Unknown option');
  });

  test('--host 0.0.0.0 without --expose exits 2, empty stdout, no listening line', async () => {
    const proc = Bun.spawn(
      [process.execPath, CLI_SCRIPT, 'serve', '--host', '0.0.0.0', '--port', '0'],
      { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe('');
    expect(code).toBe(2);
    expect(stderr).toContain('refusing to bind non-loopback host "0.0.0.0"');
    expect(stderr).not.toContain('listening');
  });

  test('an empty --host exits 2 rather than binding all interfaces', async () => {
    const proc = Bun.spawn([process.execPath, CLI_SCRIPT, 'serve', '--host', '', '--port', '0'], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe('');
    expect(code).toBe(2);
    expect(stderr).toContain('--host must be a non-empty bind address');
    expect(stderr).not.toContain('listening');
  });

  test('--host 0.0.0.0 --port 99999 fails on the port first (chosen order)', async () => {
    const proc = Bun.spawn(
      [process.execPath, CLI_SCRIPT, 'serve', '--host', '0.0.0.0', '--port', '99999'],
      { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stdout).toBe('');
    expect(code).toBe(2);
    expect(stderr).toContain('--port must be an integer between 0 and 65535');
    expect(stderr).not.toContain('refusing to bind');
  });
});
