import type { Database } from 'bun:sqlite';
import type { AdapterContext } from '../adapter/types';
import type { HarnessAdapter } from '../contract/adapter';
import { validateBundle } from '../contract/schema';
import { linkSessions } from '../store/link';
import {
  effectiveSourceId,
  loadKnown,
  persistBundle,
  persistInvalidBundle,
  removeVanished,
  upsertHarness,
} from '../store/persist';
import { recomputeRollups } from '../store/rollups';

export type AdapterReport = {
  discovered: number;
  imported: number;
  skipped: number;
  removed: number;
  failed: number;
  error?: string;
  notes?: string[];
};

export type ImportReport = {
  perAdapter: Record<string, AdapterReport>;
  durationMs: number;
};

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * ARCHITECTURE §6 / plan.md §1 orchestrator pseudocode, followed exactly:
 * one try/catch per adapter wrapping probe through the skipped calculation
 * - a mid-stream `discover()` throw keeps whatever was already persisted
 * (discovered/imported/failed so far) and sets `report.error` instead of
 * propagating and aborting every other adapter; `removed`/`skipped` are
 * only computed on the success path (the pseudocode's catch skips them,
 * matching "keep what was imported"). `linkSessions`/`recomputeRollups`
 * run once at the end, over every adapter's persisted rows.
 */
export async function importAll(opts: {
  adapters: HarnessAdapter[];
  db: Database;
  ctx: AdapterContext;
  /** Re-read every discovered source instead of passing the persisted
   * size/mtime cache to adapters. The real known set is still retained for
   * vanished-source removal and report accounting. */
  force?: boolean;
}): Promise<ImportReport> {
  const start = Date.now();
  const perAdapter: Record<string, AdapterReport> = {};

  for (const adapter of opts.adapters) {
    const report: AdapterReport = { discovered: 0, imported: 0, skipped: 0, removed: 0, failed: 0 };
    try {
      const probe = await adapter.probe(opts.ctx);
      if (!probe.installed) {
        report.notes = probe.notes;
      } else {
        upsertHarness(opts.db, adapter);
        const known = loadKnown(opts.db, adapter.id, probe.roots);
        const discoveryKnown = opts.force ? new Map() : known;
        const emitted = new Set<string>();

        for await (const bundle of adapter.discover(opts.ctx, discoveryKnown)) {
          report.discovered++;
          // Keyed by the EFFECTIVE source id (sourceId ?? sourcePath), so a
          // DB-backed adapter that separates sourceId from sourcePath tracks
          // its emitted universe independently of the filesystem path.
          emitted.add(effectiveSourceId(bundle.session));
          const result = validateBundle(bundle);
          if (result.ok) {
            persistBundle(opts.db, result.bundle);
            report.imported++;
          } else {
            persistInvalidBundle(opts.db, adapter.id, bundle, result.issues);
            report.failed++;
          }
        }

        report.removed = await removeVanished(opts.db, adapter.id, known, emitted, opts.ctx.fs, {
          sourceExists: adapter.sourceExists,
          ctx: opts.ctx,
        });
        const knownNotEmitted = [...known.keys()].filter((p) => !emitted.has(p)).length;
        report.skipped = knownNotEmitted - report.removed;
      }
    } catch (e) {
      report.error = messageOf(e).slice(0, 200);
      opts.ctx.log.error(`importAll: adapter "${adapter.id}" failed: ${report.error}`);
    }
    perAdapter[adapter.id] = report;
  }

  linkSessions(opts.db);
  recomputeRollups(opts.db);

  return { perAdapter, durationMs: Date.now() - start };
}
