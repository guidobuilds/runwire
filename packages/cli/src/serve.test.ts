import type { Database } from 'bun:sqlite';
import { describe, expect, mock, test } from 'bun:test';
import { resolve } from 'node:path';

// Proves `runServe`'s flag parsing and DB resolution by injecting fakes for the
// seams it depends on (no real server, no ~/.scout side effect). Each test
// triggers shutdown via `process.emit('SIGINT')` and asserts the fake server was
// stopped (no leaked server). `runServe` removes its signal handlers on
// shutdown, so handlers do not accumulate across tests.

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const CLI_SCRIPT = 'packages/cli/src/index.ts';

function makeServerMock(captured: { db: unknown; host: string; port: number }[]) {
  const stopMock = mock(() => {});
  const createServerMock = mock((opts: { db: unknown; host: string; port: number }) => {
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
    const captured: { db: unknown; host: string; port: number }[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');
    const p = runServe(
      { db: ':memory:', host: '127.0.0.1', port: '0' },
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
    const captured: { db: unknown; host: string; port: number }[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');
    const p = runServe({ db: ':memory:' }, { createServer: createServerMock });
    await tick();
    process.emit('SIGINT');
    const code = await p;

    expect(code).toBe(0);
    expect(captured[0]?.host).toBe('127.0.0.1');
    expect(captured[0]?.port).toBe(8787);
    expect(stopMock).toHaveBeenCalled();
  });

  test('DB path falls back to defaultDbPath() when --db is omitted; ensureDbDir is called', async () => {
    const captured: { db: unknown; host: string; port: number }[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const ensureDbDir = mock(async () => {});
    const openStore = mock(() => ({ db: {} as unknown as Database, close: () => {} }));
    const { runServe } = await import('./commands/serve');
    const p = runServe(
      {},
      {
        defaultDbPath: () => '/fake/home/.scout/scout.db',
        ensureDbDir,
        openStore,
        createServer: createServerMock,
      },
    );
    await tick();
    process.emit('SIGINT');
    const code = await p;

    expect(code).toBe(0);
    expect(ensureDbDir).toHaveBeenCalledWith('/fake/home/.scout/scout.db');
    expect(openStore).toHaveBeenCalledWith('/fake/home/.scout/scout.db');
    expect(captured[0]?.host).toBe('127.0.0.1');
    expect(captured[0]?.port).toBe(8787);
    expect(stopMock).toHaveBeenCalled();
  });
});

describe('scout serve (cli entry)', () => {
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
});
