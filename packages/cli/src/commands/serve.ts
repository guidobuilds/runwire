import type { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import type { AdapterContext, HarnessAdapter, ImportReport, ModelOverride } from '@runwire/core';
import { importAll, modelsOverridesPath, openStore, readModelOverrides } from '@runwire/core';
import { createServer, DEFAULT_HOST, DEFAULT_PORT } from '@runwire/server';
import { adapters as defaultAdapters } from '../adapters';
import { createContext, defaultDbPath, ensureDbDir, resolveUserPath } from '../context';
import type { Output } from '../output';
import { consoleOutput } from '../output';

export type ServeOptions = {
  db?: string;
  host?: string;
  port?: string;
  expose?: boolean;
  titles: boolean;
  output?: Output;
};

type MinimalServer = { port: number; stop: () => void };

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

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export type ServeDeps = {
  defaultDbPath?: () => string;
  ensureDbDir?: (path: string) => Promise<void>;
  openStore?: (path: string) => { db: Database; close: () => void };
  createServer?: (opts: ServeServerOptions) => MinimalServer;
  createContext?: (opts: { home?: string; titles: boolean }) => AdapterContext;
  adapters?: HarnessAdapter[];
};

export async function runServe(opts: ServeOptions, deps: ServeDeps = {}): Promise<number> {
  const output = opts.output ?? consoleOutput;
  const dbPath = resolveUserPath(opts.db ?? (deps.defaultDbPath ?? defaultDbPath)());
  const host = opts.host ?? DEFAULT_HOST;
  const expose = opts.expose === true;
  const hostError = assertBindHost(host);
  if (hostError !== undefined && (host.trim() === '' || !expose)) {
    await output.err(hostError);
    return 2;
  }
  if (hostError !== undefined) {
    await output.err(`warn: binding ${host} — this process is reachable off loopback`);
  }
  await (deps.ensureDbDir ?? ensureDbDir)(dbPath);
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  const { db, close } = (deps.openStore ?? openStore)(dbPath);
  const ctx = (deps.createContext ?? createContext)({ titles: opts.titles });
  const overridesPath = modelsOverridesPath(ctx.home ?? homedir());
  const server = (deps.createServer ?? createServer)({
    db,
    host,
    port,
    allowNonLocal: expose,
    scan: () => importAll({ adapters: deps.adapters ?? defaultAdapters, db, ctx }),
    modelOverrides: () => readModelOverrides(overridesPath),
  });
  await output.err(`runwire serve listening on http://${formatHost(host)}:${server.port}`);

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
