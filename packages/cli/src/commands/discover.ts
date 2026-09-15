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

/**
 * Streams the named adapter's bundles. With `--json`, one `SessionBundle`
 * per line (NDJSON) on stdout and nothing else on stdout (all logs/errors go
 * to stderr, so `runwire discover --json > out.json` is clean). Without
 * `--json`, one terse human line per bundle on stdout instead. `known` is
 * always empty here (`new Map()`): `discover` is a read-only listing of
 * whatever the adapter currently sees, never gated by what's already in a
 * store.
 *
 * Every bundle crosses the strict `validateBundle` gate (same contract as
 * `import`), and the schema's parsed output is what gets printed: a raw
 * adapter object with unrecognized keys never reaches stdout. An invalid
 * bundle is reported to stderr (code + key names, never values) and skipped;
 * the command exits 1 if any bundle failed, keeping the valid lines it
 * already emitted.
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
  let failed = false;
  for await (const bundle of adapter.discover(ctx, new Map())) {
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
