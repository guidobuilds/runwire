import type { Database } from 'bun:sqlite';
import type { AdapterContext, HarnessAdapter, ImportReport } from '@scout/core';
import { importAll, openStore } from '@scout/core';
import { createServer, DEFAULT_HOST, DEFAULT_PORT } from '@scout/server';
import { adapters as defaultAdapters } from '../adapters';
import { createContext, defaultDbPath, ensureDbDir } from '../context';

export type ServeOptions = {
  db?: string;
  host?: string;
  port?: string;
  /** Stored harness titles opt-out (`--no-titles`). The web-triggered scan
   * shares the same privacy switch as `scout import` (D7). */
  titles: boolean;
};

type MinimalServer = { port: number; stop: () => void };

/** The options `runServe` hands to `createServer`, including the scan callback
 * the web UI triggers: it runs `importAll` over the CLI adapter registry. */
type ServeServerOptions = {
  db: Database;
  host: string;
  port: number;
  scan: () => Promise<ImportReport>;
};

/**
 * Injectable seams (for tests). When omitted, the real implementations are used.
 * This keeps `runServe` free of side effects in a unit test while the production
 * path is unchanged.
 */
export type ServeDeps = {
  defaultDbPath?: () => string;
  ensureDbDir?: (path: string) => Promise<void>;
  openStore?: (path: string) => { db: Database; close: () => void };
  createServer?: (opts: ServeServerOptions) => MinimalServer;
  createContext?: (opts: { home?: string; titles: boolean }) => AdapterContext;
  /** Adapter registry override. Tests inject an empty registry so exercising the
   * scan callback does not probe the real home directory. */
  adapters?: HarnessAdapter[];
};

/**
 * Thin dispatcher (architecture §4): resolves the DB path (`defaultDbPath()`
 * when `--db` is omitted), calls `ensureDbDir` first (openStore cannot create a
 * missing parent dir), opens the store, calls `@scout/server`'s `createServer`,
 * prints the listening URL to stderr (stdout stays clean), and on SIGINT/SIGTERM
 * stops the server and closes the store. `scout serve` is the first long-running
 * process in the repo; it does not watch the DB — it reads SQLite live per
 * request (architecture §6).
 */
export async function runServe(opts: ServeOptions, deps: ServeDeps = {}): Promise<number> {
  const dbPath = opts.db ?? (deps.defaultDbPath ?? defaultDbPath)();
  await (deps.ensureDbDir ?? ensureDbDir)(dbPath);
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  const { db, close } = (deps.openStore ?? openStore)(dbPath);
  // The scan callback is built here because the adapter registry and the
  // `AdapterContext` are CLI concerns (D76); `@scout/server` only invokes it.
  // `--no-titles` must reach this context so a web scan obeys the same privacy
  // rule as `scout import` (D7): what was never written cannot leak.
  const ctx = (deps.createContext ?? createContext)({ titles: opts.titles });
  const server = (deps.createServer ?? createServer)({
    db,
    host,
    port,
    scan: () => importAll({ adapters: deps.adapters ?? defaultAdapters, db, ctx }),
  });
  console.error(`scout serve listening on http://${host}:${server.port}`);

  return await new Promise<number>((resolve) => {
    const shutdown = (): void => {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      server.stop();
      close();
      resolve(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
