import type { HarnessAdapter } from '@runwire/core';
import { validateBundle } from '@runwire/core';
import { createContext } from '../context';

export type DiscoverOptions = {
  adapters: HarnessAdapter[];
  adapterId?: string;
  home?: string;
  json: boolean;
  titles: boolean;
};

export async function runDiscover(opts: DiscoverOptions): Promise<number> {
  if (opts.adapterId === undefined) {
    const known = opts.adapters.map((a) => a.id).join(', ');
    console.error(`error: --adapter is required (known: ${known})`);
    return 1;
  }
  const adapter = opts.adapters.find((a) => a.id === opts.adapterId);
  if (!adapter) {
    const known = opts.adapters.map((a) => a.id).join(', ');
    console.error(`error: unknown adapter "${opts.adapterId}" (known: ${known})`);
    return 1;
  }

  const ctx = createContext({ home: opts.home, titles: opts.titles });
  let failed = false;
  for await (const bundle of adapter.discover(ctx, new Map())) {
    if (process.env.RUNWIRE_DEBUG === '1') {
      console.error('DEBUG-BUNDLE', bundle.session.id);
    }
    const result = validateBundle(bundle);
    if (!result.ok) {
      console.error(
        `error: adapter "${adapter.id}" emitted an invalid bundle (${result.issues.join('; ')})`,
      );
      failed = true;
      continue;
    }
    const s = result.bundle.session;
    if (opts.json) {
      console.log(JSON.stringify(result.bundle));
    } else {
      console.log(
        `${s.id}  ${result.bundle.project.key}  steps=${result.bundle.steps.length}  output=${s.output ?? 0}`,
      );
    }
  }
  return failed ? 1 : 0;
}
