import type { Database } from 'bun:sqlite';
import { describe, expect, mock, test } from 'bun:test';
import { resolve } from 'node:path';
import type { AdapterContext, ImportReport } from '@runwire/core';

// Proves `runServe`'s flag parsing and DB resolution by injecting fakes for the
// seams it depends on (no real server, no ~/.runwire side effect). Each test
// triggers shutdown via `process.emit('SIGINT')` and asserts the fake server was
// stopped (no leaked server). `runServe` removes its signal handlers on
// shutdown, so handlers do not accumulate across tests.

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const CLI_SCRIPT = 'packages/cli/src/index.ts';

type CapturedServerOpts = {
  db: unknown;
  host: string;
  port: number;
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
    expect(ensureDbDir).toHaveBeenCalledWith('/fake/home/.runwire/runwire.db');
    expect(openStore).toHaveBeenCalledWith('/fake/home/.runwire/runwire.db');
    expect(captured[0]?.host).toBe('127.0.0.1');
    expect(captured[0]?.port).toBe(8787);
    expect(stopMock).toHaveBeenCalled();
  });

  test('passes a scan callback that runs importAll over the injected adapter registry', async () => {
    const captured: CapturedServerOpts[] = [];
    const { stopMock, createServerMock } = makeServerMock(captured);
    const { runServe } = await import('./commands/serve');
    // An empty registry keeps importAll on the in-memory store, so the scan
    // callback can be exercised without probing the real home directory.
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
    // An empty registry keeps `importAll` off the context, so a bare stub is
    // enough; the assertion is what `runServe` passes to `createContext`.
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
    // Reaching the port validation proves the strict parser accepted
    // `--no-titles`; an unknown flag would have failed with a usage error first.
    expect(stderr).toContain('--port must be an integer between 0 and 65535');
    expect(stderr).not.toContain('Unknown option');
  });
});
