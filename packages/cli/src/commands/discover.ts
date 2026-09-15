import type { HarnessAdapter } from '@runwire/core';
import { createContext } from '../context';

export type DiscoverOptions = {
  adapters: HarnessAdapter[];
  adapterId?: string;
  home?: string;
  json: boolean;
  titles: boolean;
};

/**
 * Streams the named adapter's bundles. With `--json`, one `SessionBundle`
 * per line (NDJSON) on stdout and nothing else on stdout (all logs/errors go
 * to stderr, so `runwire discover --json > out.json` is clean). Without
 * `--json`, one terse human line per bundle on stdout instead. `known` is
 * always empty here (`new Map()`): `discover` is a read-only listing of
 * whatever the adapter currently sees, never gated by what's already in a
 * store.
 */
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
  for await (const bundle of adapter.discover(ctx, new Map())) {
    if (opts.json) {
      console.log(JSON.stringify(bundle));
    } else {
      const s = bundle.session;
      console.log(
        `${s.id}  ${bundle.project.key}  steps=${bundle.steps.length}  output=${s.output ?? 0}`,
      );
    }
  }
  return 0;
}
