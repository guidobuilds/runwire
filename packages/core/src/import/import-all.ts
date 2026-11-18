import type { Database } from 'bun:sqlite';
import type { AdapterContext } from '../adapter/types';
import type { HarnessAdapter } from '../contract/adapter';
import { validateBundle } from '../contract/schema';
import { linkSessions } from '../store/link';
import {
  effectiveSourceId,
  invalidateImportedVersion,
  loadKnown,
  markImportedVersion,
  persistBundle,
  persistInvalidBundle,
  readImportedVersion,
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

const MAX_ERROR_LENGTH = 200;

function sanitizeErrorLabel(text: string): string {
  return text.replace(/[\s\p{Cc}]+/gu, ' ').trim();
}

function errorLabel(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const name = sanitizeErrorLabel(e.name) || 'Error';
  const code = (e as { code?: unknown }).code;
  const sanitizedCode = typeof code === 'string' ? sanitizeErrorLabel(code) : '';
  const suffix = sanitizedCode === '' ? '' : ` (${sanitizedCode})`;
  return `${name}${suffix}`.slice(0, MAX_ERROR_LENGTH);
}

export async function importAll(opts: {
  adapters: HarnessAdapter[];
  db: Database;
  ctx: AdapterContext;
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
        const importedVersion = readImportedVersion(opts.db, adapter.id);
        upsertHarness(opts.db, adapter);
        const versionRefresh = importedVersion !== adapter.adapterVersion;
        const known = loadKnown(opts.db, adapter.id, probe.roots);
        const discoveryKnown =
          versionRefresh || opts.force || !opts.ctx.privacy.titles ? new Map() : known;
        const emitted = new Set<string>();
        let complete = true;

        for await (const bundle of adapter.discover(opts.ctx, discoveryKnown)) {
          report.discovered++;
          emitted.add(effectiveSourceId(bundle.session));
          const result = validateBundle(bundle);
          if (result.ok) {
            persistBundle(opts.db, result.bundle, opts.ctx.privacy.titles);
            report.imported++;
            if (result.bundle.diagnostics.some((d) => d.level === 'error')) complete = false;
          } else {
            persistInvalidBundle(opts.db, adapter.id, bundle, result.issues);
            report.failed++;
            complete = false;
          }
        }

        if (complete) {
          report.removed = await removeVanished(opts.db, adapter.id, known, emitted, opts.ctx.fs, {
            sourceExists: adapter.sourceExists,
            ctx: opts.ctx,
          });
        }
        const knownNotEmitted = [...known.keys()].filter((p) => !emitted.has(p)).length;
        report.skipped = knownNotEmitted - report.removed;

        if (complete) {
          markImportedVersion(opts.db, adapter.id, adapter.adapterVersion);
        } else {
          invalidateImportedVersion(opts.db, adapter.id);
        }
      }
    } catch (e) {
      invalidateImportedVersion(opts.db, adapter.id);
      const label = errorLabel(e);
      report.error = `${adapter.id}: ${label}`.slice(0, MAX_ERROR_LENGTH);
      opts.ctx.log.error(`importAll: adapter "${adapter.id}" failed (${label})`);
    }
    perAdapter[adapter.id] = report;
  }

  linkSessions(opts.db);
  recomputeRollups(opts.db);

  return { perAdapter, durationMs: Date.now() - start };
}
