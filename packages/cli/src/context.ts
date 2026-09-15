import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { AdapterContext, Logger } from '@runwire/core';
import { createBunFs } from '@runwire/core';

/** stderr-only logger: stdout is reserved for `runwire discover --json` output. */
function createStderrLogger(): Logger {
  return {
    info: (message: string) => console.error(`info: ${message}`),
    warn: (message: string) => console.error(`warn: ${message}`),
    error: (message: string) => console.error(`error: ${message}`),
  };
}

/**
 * Expands a user-supplied path before it reaches the filesystem: `:memory:`
 * stays literal, a leading `~`/`~/` resolves against the real OS home, and
 * everything else is made absolute against cwd. Without this,
 * `--db ~/.runwire/runwire.db` would `mkdir` a literal `~` directory under cwd.
 */
export function resolveUserPath(p: string): string {
  if (p === ':memory:') return p;
  if (p === '~') return resolve(homedir());
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

/**
 * Builds the `AdapterContext` every command shares. `home` is always resolved
 * to an absolute path (P3) so stored `source_path`s never depend on cwd:
 * the explicit `--home` flag when given, otherwise the real OS home
 * (`os.homedir()`, never derived from a DB path or anything else).
 */
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

/**
 * `$HOME/.runwire/runwire.db` (P3) - the real OS home via `os.homedir()`, never
 * `--home` (which points at harness data, e.g. a fixture in tests, and must
 * never receive a write). Only evaluated when `--db` is absent.
 */
export function defaultDbPath(): string {
  return resolve(homedir(), '.runwire', 'runwire.db');
}

/**
 * Creates the parent directory of `path` so `openStore` can create the DB
 * file itself - except for `:memory:`, which creates nothing on disk. When
 * `--db` is given explicitly, this is never called with the default path,
 * so nothing is created under `~/.runwire` unless the default path is in use.
 */
export async function ensureDbDir(path: string): Promise<void> {
  if (path === ':memory:') return;
  // 0o700 keeps the DB directory private (m5); mode is ignored on Windows.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
}
