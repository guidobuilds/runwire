import type { HarnessAdapter } from '@scout/core';
import { importAll, openStore } from '@scout/core';
import { createContext, defaultDbPath, ensureDbDir } from '../context';
import { formatReport } from '../report';

export type ImportOptions = {
  adapters: HarnessAdapter[];
  adapterId?: string;
  home?: string;
  db?: string;
  titles: boolean;
};

/**
 * Runs the real import orchestrator over the (optionally filtered) registry
 * and prints the `ImportReport` to stderr as human-readable text. Returns
 * the process exit code: 1 if any adapter's import failed (an `error`, or
 * `failed > 0`), else 0. Never writes anything to stdout.
 */
export async function runImport(opts: ImportOptions): Promise<number> {
  let selected = opts.adapters;
  if (opts.adapterId !== undefined) {
    const match = opts.adapters.find((a) => a.id === opts.adapterId);
    if (!match) {
      const known = opts.adapters.map((a) => a.id).join(', ');
      console.error(`error: unknown adapter "${opts.adapterId}" (known: ${known})`);
      return 1;
    }
    selected = [match];
  }

  const dbPath = opts.db ?? defaultDbPath();
  await ensureDbDir(dbPath);
  const ctx = createContext({ home: opts.home, titles: opts.titles });
  const { db, close } = openStore(dbPath);
  try {
    const report = await importAll({ adapters: selected, db, ctx });
    console.error(formatReport(report));
    const failed = Object.values(report.perAdapter).some(
      (r) => r.error !== undefined || r.failed > 0,
    );
    return failed ? 1 : 0;
  } finally {
    close();
  }
}
