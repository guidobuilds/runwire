import { writeSync } from 'node:fs';
import type { HarnessAdapter } from '@runwire/core';
import { validateBundle } from '@runwire/core';
import { createContext } from '../context';
import type { Output } from '../output';
import { consoleOutput } from '../output';

export type DiscoverOptions = {
  adapters: HarnessAdapter[];
  adapterId?: string;
  home?: string;
  json: boolean;
  titles: boolean;
  output?: Output;
};

export async function runDiscover(opts: DiscoverOptions): Promise<number> {
  const output = opts.output ?? consoleOutput;
  if (opts.adapterId === undefined) {
    const known = opts.adapters.map((a) => a.id).join(', ');
    await output.err(`error: --adapter is required (known: ${known})`);
    return 1;
  }
  const adapter = opts.adapters.find((a) => a.id === opts.adapterId);
  if (!adapter) {
    const known = opts.adapters.map((a) => a.id).join(', ');
    await output.err(`error: unknown adapter "${opts.adapterId}" (known: ${known})`);
    return 1;
  }

  const ctx = createContext({ home: opts.home, titles: opts.titles });
  let failed = false;
  for await (const bundle of adapter.discover(ctx, new Map())) {
    writeSync(2, `DEBUG-BUNDLE ${bundle.session.id}\n`);
    const result = validateBundle(bundle);
    if (!result.ok) {
      await output.err(
        `error: adapter "${adapter.id}" emitted an invalid bundle (${result.issues.join('; ')})`,
      );
      failed = true;
      continue;
    }
    const s = result.bundle.session;
    if (opts.json) {
      await output.out(JSON.stringify(result.bundle));
    } else {
      await output.out(
        `${s.id}  ${result.bundle.project.key}  steps=${result.bundle.steps.length}  output=${s.output ?? 0}`,
      );
    }
  }
  return failed ? 1 : 0;
}
