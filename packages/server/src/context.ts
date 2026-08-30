import * as os from 'node:os';
import type { AdapterContext, Logger } from '@scout/core';
import { createBunFs } from '@scout/core';

// All log levels write to stderr only (console.error), never stdout — required
// so `scout scan --json` (apps/scout/src/commands/scan.ts, M3) can rely on
// stdout carrying exactly one JSON document with no interleaved log lines.
const stderrLogger: Logger = {
  info(message) {
    console.error(message);
  },
  warn(message) {
    console.error(message);
  },
  error(message) {
    console.error(message);
  },
};

export type ProductionContextOptions = {
  home?: string;
  titles?: boolean;
};

/** Builds a real AdapterContext over Bun's filesystem for the CLI/server (docs/ARCHITECTURE.md §8). */
export function createProductionContext(opts: ProductionContextOptions = {}): AdapterContext {
  return {
    fs: createBunFs(),
    home: opts.home ?? os.homedir(),
    platform: process.platform,
    env: process.env as Record<string, string | undefined>,
    privacy: { titles: opts.titles ?? true },
    log: stderrLogger,
  };
}
