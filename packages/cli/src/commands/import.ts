import type { HarnessAdapter } from '@runwire/core';
import { importAll, openStore } from '@runwire/core';
import { createContext, defaultDbPath, ensureDbDir, resolveUserPath } from '../context';
import { formatReport } from '../report';

export type ImportOptions = {
  adapters: HarnessAdapter[];
  adapterId?: string;
  home?: string;
  db?: string;
  titles: boolean;
  force?: boolean;
};

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

  const dbPath = resolveUserPath(opts.db ?? defaultDbPath());
  await ensureDbDir(dbPath);
  const ctx = createContext({ home: opts.home, titles: opts.titles });
  const { db, close } = openStore(dbPath);
  try {
    const report = await importAll({ adapters: selected, db, ctx, force: opts.force });
    console.error(formatReport(report));
    const failed = Object.values(report.perAdapter).some(
      (r) => r.error !== undefined || r.failed > 0,
    );
    return failed ? 1 : 0;
  } finally {
    close();
  }
}
