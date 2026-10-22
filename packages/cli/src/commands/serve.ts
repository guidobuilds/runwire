import type { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import type { AdapterContext, HarnessAdapter, ImportReport, ModelOverride } from '@runwire/core';
import { importAll, modelsOverridesPath, openStore, readModelOverrides } from '@runwire/core';
import { createServer, DEFAULT_HOST, DEFAULT_PORT } from '@runwire/server';
import { adapters as defaultAdapters } from '../adapters';
import { createContext, defaultDbPath, ensureDbDir, resolveUserPath } from '../context';

export type ServeOptions = {
  db?: string;
  host?: string;
  port?: string;
  expose?: boolean;
  /** Stored harness titles opt-out (`--no-titles`). The web-triggered scan
   * shares the same privacy switch as `runwire import` (D7). */
  titles: boolean;
};

type MinimalServer = { port: number; stop: () => void };

/** The options `runServe` hands to `createServer`, including the scan callback
 * the web UI triggers: it runs `importAll` over the CLI adapter registry. */
type ServeServerOptions = {
  db: Database;
  host: string;
  port: number;
  allowNonLocal?: boolean;
  scan: () => Promise<ImportReport>;
  modelOverrides: () => readonly ModelOverride[];
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function assertBindHost(host: string): string | undefined {
  const h = host.trim();
  if (h === '') return 'error: --host must be a non-empty bind address';
  if (h === '0.0.0.0' || h === '::' || h === '*' || !LOOPBACK.has(h)) {
    return `error: refusing to bind non-loopback host "${h}" (session metadata and POST /api/scan would be reachable on the network). Pass --expose to override.`;
  }
  return undefined;
}

/** Brackets an IPv6 literal so the listening URL is usable (`http://[::1]:8787`). */
function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

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
 * missing parent dir), opens the store, calls `@runwire/server`'s `createServer`,
 * prints the listening URL to stderr (stdout stays clean), and on SIGINT/SIGTERM
 * stops the server and closes the store. `runwire serve` is the first long-running
 * process in the repo; it does not watch the DB — it reads SQLite live per
 * request (architecture §6).
 */
export async function runServe(opts: ServeOptions, deps: ServeDeps = {}): Promise<number> {
  const dbPath = resolveUserPath(opts.db ?? (deps.defaultDbPath ?? defaultDbPath)());
  const host = opts.host ?? DEFAULT_HOST;
  const expose = opts.expose === true;
  const hostError = assertBindHost(host);
  if (hostError !== undefined && (host.trim() === '' || !expose)) {
    console.error(hostError);
    return 2;
  }
  if (hostError !== undefined) {
    console.error(`warn: binding ${host} — this process is reachable off loopback`);
  }
  await (deps.ensureDbDir ?? ensureDbDir)(dbPath);
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  const { db, close } = (deps.openStore ?? openStore)(dbPath);
  // The scan callback is built here because the adapter registry and the
  // `AdapterContext` are CLI concerns (D76); `@runwire/server` only invokes it.
  // `--no-titles` must reach this context so a web scan obeys the same privacy
  // rule as `runwire import` (D7): what was never written cannot leak.
  const ctx = (deps.createContext ?? createContext)({ titles: opts.titles });
  // Model overrides are re-read per request: the loader closure only
  // resolves the path; the file read happens when the server handles a request.
  const overridesPath = modelsOverridesPath(ctx.home ?? homedir());
  const server = (deps.createServer ?? createServer)({
    db,
    host,
    port,
    allowNonLocal: expose,
    scan: () => importAll({ adapters: deps.adapters ?? defaultAdapters, db, ctx }),
    modelOverrides: () => readModelOverrides(overridesPath),
  });
  console.error(`runwire serve listening on http://${formatHost(host)}:${server.port}`);

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
