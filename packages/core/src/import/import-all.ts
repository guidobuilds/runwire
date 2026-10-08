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

/** Collapse whitespace and strip control characters so a hostile error
 * name/code cannot smuggle a multi-line record dump into a single log line. */
function sanitizeErrorLabel(text: string): string {
  return text.replace(/[\s\p{Cc}]+/gu, ' ').trim();
}

/**
 * A short, code-like error label: the sanitized error name plus an optional
 * Node-style string `code`. Deliberately drops `Error.message`: a throw from
 * `adapter.discover` (e.g. a `JSON.parse`/fold failure) can quote the record it
 * was reading, and both `report.error` and `ctx.log` are user-visible sinks
 * (docs/ARCHITECTURE.md §7: never log prompts/responses/code).
 */
function errorLabel(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const name = sanitizeErrorLabel(e.name) || 'Error';
  const code = (e as { code?: unknown }).code;
  const sanitizedCode = typeof code === 'string' ? sanitizeErrorLabel(code) : '';
  const suffix = sanitizedCode === '' ? '' : ` (${sanitizedCode})`;
  return `${name}${suffix}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * ARCHITECTURE §6 / plan.md §1 orchestrator pseudocode, plus the D82
 * completed-refresh marker:
 * - a mid-stream `discover()` throw keeps whatever was already persisted
 * (discovered/imported/failed so far) and sets `report.error` instead of
 * propagating and aborting every other adapter; `removed`/`skipped` are
 * only computed on the success path (the pseudocode's catch skips them,
 * matching "keep what was imported"). `linkSessions`/`recomputeRollups`
 * run once at the end, over every adapter's persisted rows.
 * - the adapter's mapping version drives an automatic historical refresh:
 * when the persisted `harnesses.imported_version` marker (read BEFORE
 * `upsertHarness` overwrites the installed `adapter_version`) is NULL or
 * differs from `adapter.adapterVersion`, the size/mtime cache is bypassed so
 * every existing source is re-parsed and re-persisted.
 * - the marker only advances after the whole stream was enumerated, every
 * bundle validated/persisted (no failed bundle, no error-level diagnostic),
 * and vanished-source cleanup completed. An incomplete run CLEARS the marker
 * instead, so the next run bypasses the cache and retries (a marker left equal
 * to the running version by an earlier success would otherwise skip the very
 * source that just failed); a warning diagnostic (a tolerated fixture) does not
 * block completion and so never causes a retry loop.
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
        // D82: read the completed-refresh marker BEFORE `upsertHarness`
        // installs the current adapter_version, then decide whether the
        // mapping changed and the size/mtime cache must be bypassed. A NULL
        // marker (a store predating this feature) forces one bounded full
        // historical refresh; once a run completes cleanly the marker catches
        // up and ordinary incremental behavior resumes.
        const importedVersion = readImportedVersion(opts.db, adapter.id);
        upsertHarness(opts.db, adapter);
        const versionRefresh = importedVersion !== adapter.adapterVersion;
        const known = loadKnown(opts.db, adapter.id, probe.roots);
        // Privacy-driven discovery bypass (D7/D71, ARCHITECTURE §7): a source the
        // size/mtime cache would skip never reaches persistBundle, so the F4
        // `titles:false` binding (which NULLs a title on every bundle it persists)
        // would never see it and a previously stored title would survive an
        // import run with `--no-titles`. So when the caller opted out of titles,
        // ignore the cache and re-discover every source; `known` stays the real
        // set for vanished-source removal and report accounting, exactly as with
        // `force`. With `titles:true` the cache is untouched.
        const discoveryKnown =
          versionRefresh || opts.force || !opts.ctx.privacy.titles ? new Map() : known;
        const emitted = new Set<string>();
        // Set false by any failed bundle or error-level diagnostic; unlike a
        // warning (a tolerated malformed-line fixture), these are real
        // incomplete imports that must retry rather than advance the marker.
        let complete = true;

        for await (const bundle of adapter.discover(opts.ctx, discoveryKnown)) {
          report.discovered++;
          // Keyed by the EFFECTIVE source id (sourceId ?? sourcePath), so a
          // DB-backed adapter that separates sourceId from sourcePath tracks
          // its emitted universe independently of the filesystem path.
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

        // Never prune on an incomplete scan. A failed bundle or an error-level
        // diagnostic means the emitted set is not a trustworthy picture of what
        // still exists, so deleting "vanished" sources could drop history a
        // later complete run would still re-read (the marker below stays
        // cleared). An adapter that finds its probed root gone throws instead,
        // which skips this block entirely via the catch.
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
          // An incomplete run must not keep a marker that a previous success
          // already set to this version, or the next same-version scan would
          // skip the cached source whose re-read just failed (D82). Clearing it
          // makes the next run bypass the size/mtime cache and retry.
          invalidateImportedVersion(opts.db, adapter.id);
        }
      }
    } catch (e) {
      // A thrown probe/discover/persist/cleanup is also incomplete: clear any
      // apparent completed-refresh marker so the next scan retries rather than
      // trusting the cache (no-op when the harness row does not exist yet).
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
