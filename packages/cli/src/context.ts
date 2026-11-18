import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { AdapterContext, Logger } from '@runwire/core';
import { createBunFs } from '@runwire/core';

function createStderrLogger(): Logger {
  return {
    info: (message: string) => console.error(`info: ${message}`),
    warn: (message: string) => console.error(`warn: ${message}`),
    error: (message: string) => console.error(`error: ${message}`),
  };
}

export function resolveUserPath(p: string): string {
  if (p === ':memory:') return p;
  if (p === '~') return resolve(homedir());
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

export function createContext(opts: { home?: string; titles: boolean }): AdapterContext {
  return {
    home: resolveUserPath(opts.home ?? homedir()),
    platform: process.platform,
    env: process.env as Record<string, string | undefined>,
    fs: createBunFs(),
    privacy: { titles: opts.titles },
    log: createStderrLogger(),
  };
}

export function defaultDbPath(): string {
  return resolve(homedir(), '.runwire', 'runwire.db');
}

export async function ensureDbDir(path: string): Promise<void> {
  if (path === ':memory:') return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
}
